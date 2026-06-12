# Logging & Code Quality Guide

## ✅ Implementado

### 1. **Pino Logger** 🪵
Logger estruturado de alto desempenho para a aplicação com:
- ✅ Console output rápido e estruturado em formato JSON para produção (compatível com 12-factor apps)
- ✅ Prettifier colorido (`pino-pretty`) no ambiente de desenvolvimento
- ✅ Timestamps automáticos e desativação de metadados redundantes (`pid`, `hostname`) para reduzir ruído
- ✅ Níveis de log configuráveis dinamicamente

### 2. **Prettier** 💅
Formatação de código automática com:
- ✅ Linha máxima de 100 caracteres
- ✅ Single quotes
- ✅ Trailing commas (ES5)
- ✅ Semicolons obrigatórios
- ✅ Espaçamento consistente

---

## 🚀 Usando o Logger

### Exemplo Básico

```typescript
import { logger } from '@/infrastructure/logger';

// Log de informação
logger.info('Iniciando operação');

// Log de aviso
logger.warn('Atenção: operação demorada');

// Log de erro
logger.error({ err }, 'Erro ao conectar ao banco');

// Log com metadados estruturados
logger.info({ userId: '123', email: 'user@example.com' }, 'Usuário autenticado');
```

### Níveis de Log

```
FATAL:  Erros críticos que causam a parada do sistema
ERROR:  Erros operacionais e exceções
WARN:   Avisos e possíveis problemas
INFO:   Informações gerais de execução (padrão)
DEBUG:  Dados detalhados para debug local
```

### Configuração

Via `.env`:
```env
LOG_LEVEL=info              # Nível mínimo de log
NODE_ENV=production        # Ambiente
```

---

## 🔄 Fluxo de Logging

```
Request
  ↓
[requestLogger / express routing]
  ├─ Log: método, URL
  ↓
Controller → Use Case → Repository
  ↓
logger.info() / logger.warn()
  ↓
[errorHandler middleware]
  ├─ Captura erros operacionais (AppError, NotFoundError, BusinessError)
  ├─ Log estruturado do erro com stack trace em desenvolvimento
  └─ Retorna resposta JSON padronizada
  ↓
Stdout / Stderr (Docker logs)
```

---

## ✨ Boas Práticas

### ✅ Fazer

```typescript
// Log estruturado com metadados primeiro
logger.info({ patientId: patient.id, email: patient.email }, 'Paciente criado');

// Log de erro passando o erro como objeto
logger.error({ err: error.message, stack: error.stack }, 'Falha ao processar pagamento');
```

### ❌ Evitar

```typescript
// Não use console.log
console.log('Debug:', data);  // ← Use logger.debug

// Não logue informações sensíveis
logger.info({ password }, 'Nova senha cadastrada');  // ❌ Vazamento de credenciais
```

---

**Status:** ✅ Pronto para produção com Pino!
