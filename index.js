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
  console.log('🚀 Iniciando Venom-Bot...');
  connectionStatus = 'connecting';
  io.emit('status', { status: 'connecting' });
  
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
        browserArgs: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        autoClose: 60000,
        disableWelcome: true,
        updatesLog: false
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
      return res.json({ 
        connected: false, 
        status: connectionStatus,
        message: 'Bot não iniciado' 
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
