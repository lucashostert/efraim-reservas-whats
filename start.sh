#!/bin/bash
echo "🗑️  Limpando tokens antes de iniciar..."
rm -rf /app/tokens/*
rm -rf ./tokens/*
echo "✅ Tokens limpos!"
echo "🚀 Iniciando servidor..."
node index.js
