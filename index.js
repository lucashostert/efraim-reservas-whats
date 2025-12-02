require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
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
let isStarting = false;

// Configurações
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const PORT = process.env.PORT || 3000;

console.log('🔧 Configurações:');
console.log('   PORT:', PORT);
console.log('   BACKEND_URL:', BACKEND_URL);
console.log('   FRONTEND_URL:', process.env.FRONTEND_URL || '*');
console.log('');

// ========== INICIAR WHATSAPP CLIENT ==========
async function startBot() {
  if (isStarting) {
    console.log('⏳ Bot já está sendo iniciado...');
    return;
  }
  
  if (client) {
    console.log('✅ Bot já está rodando.');
    return;
  }
  
  isStarting = true;
  console.log('🚀 Iniciando WhatsApp Web.js...');
  connectionStatus = 'connecting';
  io.emit('status', { status: 'connecting' });
  
  try {
    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './tokens'
      }),
      puppeteer: {
        executablePath: '/usr/bin/chromium',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      }
    });

    // QR Code gerado
    client.on('qr', async (qr) => {
      console.log('');
      console.log('='.repeat(60));
      console.log('📱 QR CODE GERADO!');
      console.log('='.repeat(60));
      qrcodeTerminal.generate(qr, { small: true });
      console.log('='.repeat(60));
      console.log('');
      
      // Converter QR string para base64
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        qrCodeData = qrBase64;
        connectionStatus = 'qr_ready';
        
        console.log('📤 Emitindo QR via WebSocket (base64)...');
        io.emit('qrcode', { qr: qrBase64 });
        io.emit('status', { status: 'qr_ready' });
        console.log('✅ QR emitido em formato base64!');
      } catch (err) {
        console.error('❌ Erro ao converter QR para base64:', err.message);
        // Fallback: enviar string
        qrCodeData = qr;
        io.emit('qrcode', { qr: qr });
        io.emit('status', { status: 'qr_ready' });
      }
    });

    // Cliente pronto
    client.on('ready', () => {
      console.log('✅ WhatsApp conectado com sucesso!');
      connectionStatus = 'connected';
      qrCodeData = null;
      io.emit('status', { status: 'connected' });
      io.emit('connected', { message: 'WhatsApp conectado!' });
    });

    // Autenticação
    client.on('authenticated', () => {
      console.log('✅ Autenticado!');
      connectionStatus = 'connected';
    });

    // Falha de autenticação
    client.on('auth_failure', (msg) => {
      console.error('❌ Falha na autenticação:', msg);
      connectionStatus = 'error';
      io.emit('status', { status: 'error', error: msg });
    });

    // Desconectado
    client.on('disconnected', (reason) => {
      console.log('⚠️  Desconectado:', reason);
      connectionStatus = 'disconnected';
      io.emit('status', { status: 'disconnected' });
      client = null;
      isStarting = false;
    });

    // Mensagem recebida
    client.on('message', async (message) => {
      // Ignorar mensagens especiais do WhatsApp
      if (message.from === 'status@broadcast' || 
          message.broadcast || 
          message.from.includes('@lid') ||
          message.isStatus) {
        return;
      }
      
      console.log('📨 Mensagem recebida:', message.from, message.body);
      
      try {
        const chat = await message.getChat();
        
        // Tentar buscar contato com segurança
        let contact = null;
        let contactName = message.from;
        
        try {
          contact = await message.getContact();
          contactName = contact.pushname || contact.name || message.from;
        } catch (err) {
          console.warn('⚠️  Não foi possível buscar contato:', err.message);
        }
        
        const messageData = {
          id: message.id._serialized,
          from: message.from,
          to: message.to,
          body: message.body,
          timestamp: message.timestamp,
          hasMedia: message.hasMedia,
          type: message.type,
          isGroup: message.from.includes('@g.us'),
          chatName: chat.name || contactName,
          contactName: contactName
        };
        
        // Emitir mensagem para frontend via WebSocket
        io.emit('message', messageData);
        console.log('📤 Mensagem emitida via WebSocket');
      } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error.message);
      }
    });

    console.log('🔄 Inicializando cliente...');
    await client.initialize();
    
  } catch (error) {
    console.error('❌ Erro ao iniciar WhatsApp:', error);
    connectionStatus = 'error';
    io.emit('status', { status: 'error', error: error.message });
    isStarting = false;
  }
}

// ========== WEBSOCKET ==========
io.on('connection', (socket) => {
  console.log('🔌 Frontend conectado via WebSocket:', socket.id);
  
  // Enviar status atual
  socket.emit('status', { status: connectionStatus });
  
  if (qrCodeData) {
    socket.emit('qrcode', { qr: qrCodeData });
  }
  
  socket.on('disconnect', () => {
    console.log('🔌 Frontend desconectado:', socket.id);
  });
});

// ========== ROTAS HTTP ==========

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/status', (req, res) => {
  if (!client) {
    console.log('⚠️  Bot não iniciado, iniciando automaticamente...');
    startBot().catch(err => {
      console.error('❌ Erro ao auto-iniciar:', err.message);
    });
    
    return res.json({
      connected: false,
      status: 'starting',
      message: 'Iniciando... Aguarde.'
    });
  }
  
  res.json({
    connected: connectionStatus === 'connected',
    status: connectionStatus,
    hasQR: !!qrCodeData
  });
});

app.get('/qrcode', (req, res) => {
  if (qrCodeData) {
    res.json({ qr: qrCodeData });
  } else {
    res.status(404).json({ error: 'QR Code não disponível' });
  }
});

app.post('/connect', async (req, res) => {
  if (client && connectionStatus === 'connected') {
    return res.json({ message: 'Já conectado' });
  }
  
  startBot().catch(err => console.error('Erro:', err.message));
  res.json({ message: 'Conectando...' });
});

app.post('/disconnect', async (req, res) => {
  if (client) {
    await client.destroy();
    client = null;
    connectionStatus = 'disconnected';
    qrCodeData = null;
    isStarting = false;
    io.emit('status', { status: 'disconnected' });
    res.json({ message: 'Desconectado' });
  } else {
    res.json({ message: 'Já desconectado' });
  }
});

// Listar todos os chats
app.get('/chats', async (req, res) => {
  if (!client || connectionStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  
  try {
    console.log('🔍 Buscando chats...');
    const chats = await client.getChats();
    console.log(`📊 Total de chats encontrados: ${chats.length}`);
    
    const chatList = await Promise.all(chats.map(async (chat) => {
      try {
        // Validar se o chat tem as propriedades necessárias
        if (!chat || !chat.id) {
          console.warn('⚠️  Chat inválido encontrado, pulando...');
          return null;
        }
        
        // Ignorar chats especiais (status, broadcast, linked devices)
        if (chat.id._serialized === 'status@broadcast' || 
            chat.id._serialized.includes('@lid')) {
          return null;
        }
        
        let contact = null;
        let contactName = 'Desconhecido';
        
        // Tentar buscar contato com segurança
        try {
          contact = await chat.getContact();
          contactName = contact?.pushname || contact?.name || contact?.number || chat.name || 'Desconhecido';
        } catch (err) {
          console.warn(`⚠️  Erro ao buscar contato para ${chat.id._serialized}:`, err.message);
          contactName = chat.name || 'Desconhecido';
        }
        
        const lastMessage = chat.lastMessage;
        
        // Tentar buscar foto de perfil
        let profilePicUrl = null;
        try {
          profilePicUrl = await chat.getProfilePicUrl();
        } catch (err) {
          // Foto não disponível, usar null (normal para muitos contatos)
        }
        
        return {
          id: chat.id._serialized,
          name: contactName,
          isGroup: chat.isGroup || false,
          unreadCount: chat.unreadCount || 0,
          timestamp: chat.timestamp || Date.now(),
          lastMessage: lastMessage ? {
            body: lastMessage.body || '',
            timestamp: lastMessage.timestamp || Date.now(),
            fromMe: lastMessage.fromMe || false
          } : null,
          profilePicUrl: profilePicUrl
        };
      } catch (err) {
        console.error('❌ Erro ao processar chat:', err.message);
        return null;
      }
    }));
    
    // Filtrar chats nulos e ordenar por timestamp (mais recente primeiro)
    const validChats = chatList.filter(chat => chat !== null);
    validChats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    console.log(`✅ Retornando ${validChats.length} chats válidos`);
    res.json(validChats);
  } catch (error) {
    console.error('❌ Erro ao buscar chats:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: 'Erro ao processar lista de chats. Verifique os logs do servidor.'
    });
  }
});

// Buscar mensagens de um chat específico
app.get('/chats/:chatId/messages', async (req, res) => {
  const { chatId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  
  if (!client || connectionStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  
  try {
    console.log(`🔍 Buscando mensagens para chat: ${chatId}`);
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });
    console.log(`📊 Total de mensagens encontradas: ${messages.length}`);
    
    const messageList = await Promise.all(messages.map(async (msg) => {
      try {
        let mediaData = null;
        
        if (msg.hasMedia) {
          try {
            const media = await msg.downloadMedia();
            mediaData = {
              mimetype: media.mimetype,
              data: media.data,
              filename: media.filename
            };
          } catch (err) {
            console.error('⚠️  Erro ao baixar mídia:', err.message);
          }
        }
        
        return {
          id: msg.id?._serialized || `temp-${Date.now()}`,
          body: msg.body || '',
          from: msg.from || '',
          to: msg.to || '',
          timestamp: msg.timestamp || Date.now(),
          fromMe: msg.fromMe || false,
          hasMedia: msg.hasMedia || false,
          mediaData: mediaData,
          type: msg.type || 'chat',
          ack: msg.ack || 0
        };
      } catch (err) {
        console.error('❌ Erro ao processar mensagem:', err.message);
        return null;
      }
    }));
    
    // Filtrar mensagens nulas
    const validMessages = messageList.filter(msg => msg !== null);
    console.log(`✅ Retornando ${validMessages.length} mensagens válidas`);
    
    res.json(validMessages);
  } catch (error) {
    console.error('❌ Erro ao buscar mensagens:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ 
      error: error.message,
      details: 'Erro ao buscar mensagens. Verifique os logs do servidor.'
    });
  }
});

// Enviar mensagem (texto ou mídia)
app.post('/send', async (req, res) => {
  const { to, message, mediaData } = req.body;
  
  if (!client || connectionStatus !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado' });
  }
  
  try {
    const chatId = to.includes('@') ? to : `${to}@c.us`;
    
    if (mediaData) {
      // Enviar mídia
      const { MessageMedia } = require('whatsapp-web.js');
      const media = new MessageMedia(
        mediaData.mimetype,
        mediaData.data,
        mediaData.filename
      );
      await client.sendMessage(chatId, media, { caption: message || '' });
    } else {
      // Enviar texto
      await client.sendMessage(chatId, message);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== INICIAR SERVIDOR ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('='.repeat(50));
  console.log(`🌐 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Health: http://0.0.0.0:${PORT}/health`);
  console.log(`📍 Status: http://0.0.0.0:${PORT}/status`);
  console.log(`🔌 WebSocket: ws://0.0.0.0:${PORT}`);
  console.log('='.repeat(50));
  console.log('');
  
  // Iniciar bot automaticamente
  console.log('⚠️  Iniciando WhatsApp automaticamente...');
  startBot().catch(err => {
    console.error('❌ Falha ao iniciar:', err.message);
  });
});
