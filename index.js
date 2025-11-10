const venom = require('venom-bot');
const axios = require('axios');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

// CORS para requisições HTTP
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

let client = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let isStarting = false; // Guard para prevenir múltiplas chamadas simultâneas

// Configurações
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const WEBHOOK_ENDPOINT = `${BACKEND_URL}/api/whatsapp/webhook`;
const PORT = process.env.PORT || 3000;
const SESSION_NAME = 'efraim-whatsapp';

// Debug: mostrar configurações ao iniciar
console.log('🔧 Configurações:');
console.log('   PORT:', PORT);
console.log('   BACKEND_URL:', BACKEND_URL);
console.log('   FRONTEND_URL:', process.env.FRONTEND_URL || 'não configurado');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('');

// ========== INICIAR VENOM-BOT ==========
async function startBot() {
  // Prevenir múltiplas inicializações simultâneas
  if (isStarting) {
    console.log('⏳ Bot já está sendo iniciado... aguarde.');
    return;
  }
  
  if (client) {
    console.log('✅ Bot já está rodando.');
    return;
  }
  
  isStarting = true;
  console.log('🚀 Iniciando Venom-Bot...');
  connectionStatus = 'connecting';
  io.emit('status', { status: 'connecting' });
  
  // Limpar TODOS os diretórios de tokens possíveis
  const fs = require('fs');
  const path = require('path');
  
  // Tentar limpar todos os paths possíveis
  const possiblePaths = [
    path.join(__dirname, 'tokens', SESSION_NAME),
    path.join(__dirname, SESSION_NAME),
    path.join(__dirname, 'tokens'),
    path.join('/app', SESSION_NAME),
    path.join('/app', 'tokens', SESSION_NAME)
  ];
  
  console.log('🗑️  Limpando TODAS as sessões antigas possíveis...');
  
  for (const dirPath of possiblePaths) {
    try {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        console.log(`   → Removendo: ${dirPath}`);
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.log(`   ⚠️  Não foi possível remover ${dirPath}:`, err.message);
    }
  }
  
  // Criar diretório limpo
  const tokensDir = path.join(__dirname, 'tokens', SESSION_NAME);
  try {
    fs.mkdirSync(tokensDir, { recursive: true });
    console.log('✅ Diretório limpo criado:', tokensDir);
  } catch (err) {
    console.log('⚠️  Erro ao criar diretório:', err.message);
  }
  
  try {
    client = await venom.create(
      SESSION_NAME,
      (base64Qr, asciiQR, attempts, urlCode) => {
        console.log('📱 QR CODE gerado!');
        console.log(asciiQR); // QR code em ASCII para terminal
        console.log('🔗 Ou escaneie este link:', urlCode);
        console.log(`Tentativa ${attempts} de 4`);
        
        // Armazenar QR code e emitir para frontend
        qrCodeData = base64Qr;
        connectionStatus = 'qr_ready';
        io.emit('qrcode', { qr: base64Qr, attempts });
        io.emit('status', { status: 'qr_ready', attempts });
      },
      (statusSession, session) => {
        console.log('📊 Status da sessão:', statusSession);
        connectionStatus = statusSession;
        io.emit('status', { status: statusSession });
      },
      {
        headless: true, // true para produção (Railway)
        useChrome: false,
        debug: false,
        logQR: true,
        executablePath: '/usr/bin/chromium', // Chromium instalado via APT
        folderNameToken: SESSION_NAME,
        mkdirFolderToken: 'tokens', // Pasta tokens como base
        createPathFileToken: false, // Não criar subpastas extras
        browserArgs: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process', // Importante para Railway
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-features=AudioServiceOutOfProcess',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-notifications',
          '--disable-offer-store-unmasked-wallet-cards',
          '--disable-popup-blocking',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-speech-api',
          '--disable-sync',
          '--hide-scrollbars',
          '--ignore-gpu-blacklist',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-pings',
          '--password-store=basic',
          '--use-gl=swiftshader',
          '--use-mock-keychain',
          // Crítico para resolver SingletonLock
          '--disable-features=ProcessSingletonOnLinux'
        ],
        autoClose: 60000,
        disableWelcome: true,
        updatesLog: false,
        deleteToken: true, // FORÇAR deletar token ao conectar
        catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
          // Callback duplicado para garantir captura
          console.log('📱 [catchQR] QR CODE capturado!');
          qrCodeData = base64Qr;
          connectionStatus = 'qr_ready';
          io.emit('qrcode', { qr: base64Qr, attempts });
          io.emit('status', { status: 'qr_ready', attempts });
        },
        waitForLogin: true, // Aguardar login via QR
        timeoutQR: 600000 // 10 minutos para escanear QR
      }
    );

    console.log('✅ Venom-Bot conectado com sucesso!');
    console.log('📱 WhatsApp está pronto para receber mensagens');
    
    connectionStatus = 'connected';
    qrCodeData = null;
    io.emit('status', { status: 'connected' });
    io.emit('connected', { message: 'WhatsApp conectado com sucesso!' });

    // ========== RECEBER MENSAGENS ==========
    client.onMessage(async (message) => {
      try {
        // Ignorar mensagens de grupos e status
        if (message.isGroupMsg || message.from === 'status@broadcast') {
          return;
        }

        console.log('📩 Nova mensagem recebida:', {
          from: message.from,
          sender: message.sender.name || message.sender.pushname,
          body: message.body
        });

        // Enviar para webhook do backend
        const webhookData = {
          from: message.from, // Ex: 5542999426960@c.us
          body: message.body,
          name: message.sender.name || message.sender.pushname || 'Cliente',
          timestamp: message.timestamp,
          type: message.type
        };

        await axios.post(WEBHOOK_ENDPOINT, webhookData);
        console.log('✅ Mensagem enviada para o backend');
        
        // Emitir mensagem para frontend via WebSocket
        io.emit('message', webhookData);

      } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error.message);
      }
    });

    // ========== EVENTOS ==========
    client.onStateChange((state) => {
      console.log('🔄 Estado do WhatsApp mudou:', state);
      
      // Mapear status do Venom para status padronizados
      let mappedStatus = 'disconnected';
      
      if (state === 'CONNECTED' || state === 'isLogged' || state === 'successPageWhatsapp') {
        mappedStatus = 'connected';
      } else if (state === 'qrReadSuccess' || state === 'qrRead') {
        mappedStatus = 'connecting';
      } else if (state === 'browserClose' || state === 'desconnectedMobile' || state === 'CONFLICT' || state === 'UNLAUNCHED') {
        mappedStatus = 'disconnected';
      }
      
      connectionStatus = mappedStatus;
      io.emit('status', { status: mappedStatus, rawStatus: state });
      console.log(`📊 Status mapeado: ${state} → ${mappedStatus}`);
      
      if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
        console.log('⚠️ Sessão desconectada, reiniciando...');
        client.useHere();
      }
    });

  } catch (error) {
    console.error('❌ Erro ao iniciar Venom-Bot:', error);
    console.error('Stack:', error.stack);
    connectionStatus = 'error';
    io.emit('status', { status: 'error', error: error.message });
    
    // NÃO fazer process.exit() para o servidor continuar rodando
    console.log('⚠️  Venom-Bot falhou ao iniciar, mas servidor HTTP continua ativo');
    console.log('⚠️  Você pode tentar reconectar via POST /connect');
  } finally {
    isStarting = false; // Resetar guard
  }
}

// ========== API REST PARA ENVIAR MENSAGENS ==========

// ========== WEBSOCKET CONNECTIONS ==========
io.on('connection', (socket) => {
  console.log('🔌 Frontend conectado via WebSocket:', socket.id);
  
  // Enviar status atual
  socket.emit('status', { status: connectionStatus });
  
  // Se tem QR code disponível, enviar
  if (qrCodeData) {
    socket.emit('qrcode', { qr: qrCodeData });
  }
  
  socket.on('disconnect', () => {
    console.log('🔌 Frontend desconectado:', socket.id);
  });
});

// ========== API REST ==========

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: connectionStatus,
    hasClient: client !== null,
    session: SESSION_NAME,
    timestamp: new Date().toISOString()
  });
});

// Status da conexão
app.get('/status', async (req, res) => {
  try {
    if (!client) {
      // Se bot não está rodando, tentar iniciar automaticamente
      console.log('⚠️  Bot não iniciado, iniciando automaticamente...');
      
      // Iniciar em background
      startBot().catch(err => {
        console.error('❌ Erro ao auto-iniciar bot:', err.message);
      });
      
      return res.json({ 
        connected: false, 
        status: 'starting',
        message: 'Iniciando bot... Aguarde alguns segundos e atualize novamente.' 
      });
    }

    const state = await client.getConnectionState();
    res.json({
      connected: state === 'CONNECTED',
      status: state,
      session: SESSION_NAME
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obter QR Code atual
app.get('/qrcode', (req, res) => {
  if (qrCodeData) {
    res.json({ 
      qr: qrCodeData,
      status: connectionStatus 
    });
  } else if (connectionStatus === 'connected') {
    res.json({ 
      connected: true,
      message: 'WhatsApp já está conectado' 
    });
  } else {
    res.status(404).json({ 
      error: 'QR Code não disponível',
      status: connectionStatus,
      message: 'Aguarde ou inicie nova conexão' 
    });
  }
});

// Iniciar nova conexão
app.post('/connect', async (req, res) => {
  try {
    if (client && connectionStatus === 'connected') {
      return res.json({ 
        message: 'WhatsApp já está conectado',
        status: connectionStatus 
      });
    }
    
    if (connectionStatus === 'connecting' || connectionStatus === 'qr_ready') {
      return res.json({ 
        message: 'Conexão em andamento',
        status: connectionStatus 
      });
    }
    
    // Iniciar bot em background
    startBot().catch(err => {
      console.error('Erro ao iniciar bot:', err);
      connectionStatus = 'error';
      io.emit('status', { status: 'error', error: err.message });
    });
    
    res.json({ 
      message: 'Iniciando conexão com WhatsApp',
      status: 'connecting' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Enviar mensagem
app.post('/send', async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({ error: 'Bot não está conectado' });
    }

    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone e message são obrigatórios' });
    }

    // Formatar número: remover caracteres especiais e adicionar @c.us
    let formattedPhone = phone.replace(/\D/g, '');
    
    // Se não tem código do país, adicionar 55 (Brasil)
    if (formattedPhone.length === 11) {
      formattedPhone = '55' + formattedPhone;
    }
    
    const chatId = formattedPhone + '@c.us';

    // Enviar mensagem
    await client.sendText(chatId, message);
    
    console.log('✅ Mensagem enviada:', { phone: formattedPhone, message });
    
    res.json({
      success: true,
      phone: formattedPhone,
      message: 'Mensagem enviada com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ error: error.message });
  }
});

// Desconectar (para manutenção)
app.post('/disconnect', async (req, res) => {
  try {
    if (client) {
      await client.close();
      client = null;
      res.json({ message: 'Bot desconectado' });
    } else {
      res.json({ message: 'Bot já estava desconectado' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== INICIAR SERVIDOR ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('='.repeat(50));
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`📍 Status: http://0.0.0.0:${PORT}/status`);
  console.log(`📍 QR Code: http://0.0.0.0:${PORT}/qrcode`);
  console.log(`🔌 WebSocket: ws://0.0.0.0:${PORT}`);
  console.log('='.repeat(50));
  console.log('');
  console.log('⚠️  Iniciando Venom-Bot automaticamente...');
  console.log('');
  
  // Iniciar bot automaticamente (não bloquear servidor se falhar)
  startBot().catch(err => {
    console.error('❌ Falha ao iniciar bot automaticamente:', err.message);
  });
});

// Garantir que servidor escuta em todas as interfaces
server.on('error', (error) => {
  console.error('❌ Erro no servidor:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso!`);
  }
});

// Tratar erros não capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando bot...');
  if (client) {
    await client.close();
  }
  process.exit(0);
});
