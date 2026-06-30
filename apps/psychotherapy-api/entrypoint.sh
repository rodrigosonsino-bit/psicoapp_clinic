#!/bin/sh
set -eu

echo "Verificando conexão com PostgreSQL..."

# Extrai host e porta do DATABASE_URL para o pg_isready
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+)[:/].*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*@[^:]+:([0-9]+)/.*|\1|')

# Porta padrão 5432 se não encontrada
if [ "$DB_PORT" = "$DATABASE_URL" ] || [ -z "$DB_PORT" ]; then
  DB_PORT="5432"
fi

echo "Aguardando PostgreSQL em $DB_HOST:$DB_PORT..."

MAX_RETRIES=30
RETRY=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "Erro: Timeout aguardando PostgreSQL. Encerrando."
    exit 1
  fi
  echo "Aguardando PostgreSQL... ($RETRY/$MAX_RETRIES)"
  sleep 2
done

echo "Executando migrations..."
node dist/runMigrations.js

echo "Iniciando aplicação..."
exec node dist/server.js
