# --- Build Stage ---
FROM node:20-alpine AS builder
WORKDIR /app

# 1. Copiar arquivos estruturais do monorepo
COPY package*.json ./
COPY packages/whatsapp-core/package*.json ./packages/whatsapp-core/
COPY apps/scheduler-api/package*.json ./apps/scheduler-api/

# 2. Instalar dependências usando o package-lock.json da raiz (monorepo)
RUN npm ci --ignore-scripts

# 3. Copiar o código fonte do core e da api
COPY packages/whatsapp-core ./packages/whatsapp-core
COPY apps/scheduler-api ./apps/scheduler-api

# 4. Compilar pacotes via workspaces
RUN npm run build --workspace=packages/whatsapp-core
RUN npm run build --workspace=apps/scheduler-api

# --- Production Stage ---
FROM node:20-alpine
WORKDIR /app

# 1. Copiar estrutura do monorepo novamente para produção
COPY package*.json ./
COPY packages/whatsapp-core/package*.json ./packages/whatsapp-core/
COPY apps/scheduler-api/package*.json ./apps/scheduler-api/

# 2. Instalar apenas dependências de produção
RUN npm ci --omit=dev --ignore-scripts

# 3. Copiar builds e recursos necessários
COPY --from=builder /app/packages/whatsapp-core/dist ./packages/whatsapp-core/dist
COPY --from=builder /app/apps/scheduler-api/dist ./apps/scheduler-api/dist
COPY --from=builder /app/apps/scheduler-api/public ./apps/scheduler-api/public
COPY --from=builder /app/apps/scheduler-api/migrations ./apps/scheduler-api/migrations
COPY --from=builder /app/apps/scheduler-api/.env* ./apps/scheduler-api/

# 4. Definir contexto e iniciar a aplicação
WORKDIR /app/apps/scheduler-api
EXPOSE 3000
CMD ["npm", "start"]
