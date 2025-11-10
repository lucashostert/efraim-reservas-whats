# Imagem base otimizada para Puppeteer/Venom-Bot
FROM node:20-slim

# Variáveis de ambiente para otimizar instalação
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Instalar dependências do Chromium em uma única camada
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Criar diretório de trabalho
WORKDIR /app

# Copiar apenas package files primeiro (para cache de camadas)
COPY package*.json ./

# Instalar dependências (sem puppeteer baixar chromium)
RUN npm ci --only=production --no-audit --no-fund

# Copiar código
COPY . .

# Dar permissão de execução ao script de start
RUN chmod +x start.sh

# Criar diretório para tokens/sessões
RUN mkdir -p /app/tokens && chmod 777 /app/tokens

# Expor porta
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Iniciar aplicação usando npm start (que executa start.sh)
CMD ["npm", "start"]
