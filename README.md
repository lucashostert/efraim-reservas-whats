# 📱 Efraim WhatsApp Bot - Venom-Bot Integration

Serviço Node.js para integração do WhatsApp com o sistema Efraim Reservas usando Venom-Bot.

## 🎯 O que Este Serviço Faz

- ✅ Conecta ao WhatsApp Web via QR Code
- ✅ Recebe mensagens dos clientes automaticamente
- ✅ Envia webhooks para o backend FastAPI
- ✅ Permite envio de mensagens via API REST
- ✅ Mantém sessão persistente (não precisa escanear QR toda vez)

## 🏗️ Arquitetura

```
Cliente WhatsApp
      ↓
WhatsApp Web
      ↓
Venom-Bot Service (Este serviço)
      ↓ webhooks
Backend FastAPI → MongoDB
      ↓
Frontend React
```

## 🚀 Deploy no Railway

### Passo 1: Criar Novo Serviço

```bash
# Na raiz do projeto
cd whatsapp-bot

# Criar .env baseado no exemplo
cp .env.example .env

# Editar .env
BACKEND_URL=https://efraim-reservas-back-production.up.railway.app
PORT=3000
```

### Passo 2: Fazer Push do Código

```bash
# Se ainda não está no git, adicionar
git add .
git commit -m "Add WhatsApp bot service"
git push origin main
```

### Passo 3: Criar Projeto no Railway

1. Acessar https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. Selecionar o repositório
4. **Settings** → **Root Directory**: `whatsapp-bot`
5. Railway detectará o `Dockerfile` automaticamente

### Passo 4: Configurar Variáveis de Ambiente

No Railway, adicionar variáveis:

```
BACKEND_URL=https://efraim-reservas-back-production.up.railway.app
PORT=3000
```

### Passo 5: Deploy e Conectar WhatsApp

1. Aguardar deploy (5-7 minutos na primeira vez)
2. Ir em **Deployments** → Ver logs
3. Procurar pelo **QR CODE em ASCII** nos logs
4. Escanear com WhatsApp no celular:
   - Abrir WhatsApp → ⋮ → Aparelhos conectados → Conectar aparelho
   - Escanear o QR code que apareceu nos logs
5. Aguardar confirmação: `✅ Venom-Bot conectado com sucesso!`

### Passo 6: Obter URL e Conectar ao Backend

1. Railway → Settings → Networking → **Generate Domain**
2. Copiar URL gerada (ex: `efraim-whatsapp-bot.up.railway.app`)
3. Ir no serviço **backend** no Railway
4. Variables → Adicionar:
   ```
   VENOM_BOT_URL=https://efraim-whatsapp-bot.up.railway.app
   ```
5. Backend fará redeploy automático

## 📡 Endpoints da API

### Health Check
```bash
GET /health
```

**Resposta:**
```json
{
  "status": "online",
  "session": "efraim-whatsapp",
  "timestamp": "2025-11-10T18:00:00.000Z"
}
```

### Status da Conexão
```bash
GET /status
```

**Resposta:**
```json
{
  "connected": true,
  "state": "CONNECTED",
  "session": "efraim-whatsapp"
}
```

### Enviar Mensagem
```bash
POST /send
Content-Type: application/json

{
  "phone": "42999426960",
  "message": "Olá! Sua reserva foi confirmada."
}
```

**Resposta:**
```json
{
  "success": true,
  "phone": "5542999426960",
  "message": "Mensagem enviada com sucesso"
}
```

### Desconectar (Manutenção)
```bash
POST /disconnect
```

## 🧪 Testar Localmente

### Requisitos
- Node.js 18+
- Chrome/Chromium instalado

### Executar

```bash
# Instalar dependências
npm install

# Configurar .env
BACKEND_URL=http://localhost:8000
PORT=3000

# Rodar
npm start
```

### Escanear QR Code
O QR code aparecerá no terminal. Escaneie com WhatsApp.

### Testar Envio
```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"42999426960","message":"Teste"}'
```

## 📋 Fluxo de Mensagens

### Receber (Cliente → Sistema)
```
1. Cliente envia mensagem no WhatsApp
2. Venom-Bot recebe a mensagem
3. Bot envia POST para /api/whatsapp/webhook no backend
4. Backend salva mensagem no MongoDB
5. Frontend atualiza interface
```

### Enviar (Sistema → Cliente)
```
1. Atendente digita mensagem no frontend
2. Frontend envia POST para /api/whatsapp/enviar
3. Backend salva no MongoDB
4. Backend envia POST para /send no Venom-Bot
5. Venom-Bot envia mensagem via WhatsApp Web
6. Cliente recebe no WhatsApp
```

## 🔒 Persistência de Sessão

O Venom-Bot cria uma pasta `tokens/` com os dados da sessão. 

**⚠️ IMPORTANTE no Railway:**
- Railway usa **storage efêmero** (dados são apagados ao redeploy)
- Solução: Usar **Railway Volumes** para persistir `tokens/`

### Configurar Volume no Railway:

1. Settings → Variables → Add Volume
2. Mount Path: `/app/tokens`
3. Isso mantém a sessão mesmo após redeploys

Se não configurar volume, precisará escanear QR code novamente após cada deploy.

## 🆘 Troubleshooting

### ❌ Bot não conecta
- Verificar logs: `Railway → Deployments → Logs`
- Chromium pode demorar 2-3 minutos para iniciar
- Verificar se Railway tem recursos suficientes

### ❌ QR Code não aparece
- Logs devem mostrar ASCII art do QR
- Se não aparecer, verificar: `headless: true` em `index.js`
- Pode mudar para `headless: false` para debug (não recomendado em produção)

### ❌ Sessão desconecta constantemente
- Configurar Volume no Railway (ver acima)
- Verificar se WhatsApp não foi desconectado manualmente no celular

### ❌ Mensagens não chegam no backend
- Verificar `BACKEND_URL` nas variáveis do Railway
- Testar webhook manualmente:
  ```bash
  curl -X POST https://seu-backend.up.railway.app/api/whatsapp/webhook \
    -H "Content-Type: application/json" \
    -d '{"from":"5542999426960@c.us","body":"teste","name":"Teste"}'
  ```

### ❌ Erro ao enviar mensagem
- Verificar se bot está conectado: `GET /status`
- Verificar formato do telefone (deve ter DDD + número)
- Verificar logs do bot no Railway

## 💰 Custos

Railway cobra por:
- **CPU/RAM** usado
- **Storage** (se usar Volumes)

**Estimativa:**
- Venom-Bot: ~$2-5/mês
- Com Volume (1GB): ~$1/mês extra

**Total estimado:** $3-6/mês

Plano grátis do Railway ($5 crédito/mês) cobre o uso normal.

## 📊 Monitoramento

### Ver Logs em Tempo Real
```bash
Railway → Deployments → View Logs
```

### Mensagens Importantes nos Logs:
- `✅ Venom-Bot conectado com sucesso!` - Bot online
- `📩 Nova mensagem recebida:` - Mensagem do cliente
- `✅ Mensagem enviada:` - Mensagem enviada com sucesso
- `❌ Erro:` - Algum problema ocorreu

## 🔐 Segurança

### Recomendações:
- ✅ Usar HTTPS (Railway já fornece)
- ✅ Não expor `/send` publicamente (apenas backend deve chamar)
- ✅ Adicionar autenticação na API (futuro)
- ✅ Rate limiting (futuro)

## 📝 Notas Importantes

1. **Sessão do WhatsApp é única** - Só pode estar conectada em um lugar
2. **Não usar WhatsApp pessoal** - Criar número comercial separado
3. **WhatsApp Business API** - Para uso corporativo pesado, considerar API oficial
4. **Venom-Bot não é oficial** - Use por sua conta e risco

## 🔄 Atualizações

Para atualizar o bot:

```bash
# Fazer alterações no código
git add .
git commit -m "Update bot"
git push origin main

# Railway faz redeploy automático
# Precisará escanear QR code novamente se não tiver Volume configurado
```

## 📞 Suporte

- Documentação Venom-Bot: https://github.com/orkestral/venom
- Issues do projeto: GitHub
- Logs do Railway para debug

---

**Desenvolvido para Efraim Clube de Férias** 🏖️
