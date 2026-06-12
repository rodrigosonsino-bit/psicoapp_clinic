# Testing Implementation Guide

## ✅ Estrutura de Testes Completa

O projeto possui uma suíte de testes robusta combinando testes unitários, testes de caso de uso e testes de integração de API utilizando Jest, Supertest e mocks via tsyringe.

---

## 🧪 Testes Disponíveis

### 1. Testes de Integração de API (`src/__tests__/e2e/api.e2e.test.ts`)
Cobre todas as rotas críticas usando `supertest` e mockando os repositórios (`IPsychotherapyRepository`, `IAuthRepository`) diretamente no container de Injeção de Dependências.
- **Auth:** Cadastro, Login (com hash compare) e Refresh Token
- **Pacientes:** Listagem paginada, cadastro e deleção
- **Registros Mensais:** Geração e consulta de faturamento mensal
- **Recibos:** Emissão de recibo com controle transacional e faturamento automático
- **Sessões:** Agendamento, listagem com filtros e deleção de sessões
- **Despesas & Analytics:** Lançamento de despesas e dashboard financeiro consolidado

### 2. Testes de Casos de Uso (`src/application/useCases/__tests__/*`)
Testes isolados de regras de negócio para cada UseCase (Listar pacientes, gerar mês, emitir recibo, login, etc.).

### 3. Testes Unitários de Infraestrutura & Erros (`src/domain/errors/__tests__/*`, `src/infrastructure/*`)
Verificação da geração e manipulação de erros operacionais (`AppError`) e segurança de criptografia (`JwtService`).

---

## 📝 Comandos Disponíveis

```bash
# Executar todos os testes
npm test

# Executar todos os testes sequencialmente (evita conflitos de concorrência)
npm test -- --runInBand

# Executar cobertura de testes
npm run test:coverage -- --runInBand
```

---

## 🔒 Técnica de Mocking de Banco (Sem Banco Real em Testes)

Para evitar conexões reais e vazamento de portas de rede no Jest, o database pool (`Pool`) **não** executa conexão ao ser importado. Durante testes de API, nós substituímos as instâncias de repositórios reais no container DI por mocks usando `jest-mock-extended`:

```typescript
import { container } from '../../container';
import { mock } from 'jest-mock-extended';
import { IPsychotherapyRepository } from '../../domain/repositories/IPsychotherapyRepository';

const mockRepo = mock<IPsychotherapyRepository>();

// Registra o mock no container ANTES de importar o app Express
container.registerInstance('IPsychotherapyRepository', mockRepo);

import app from '../../server';
```

Isso garante que toda a pipeline do Express (rotas, validação de schemas, middlewares de autenticação e controllers) seja testada sem efeitos colaterais.

---

## 📊 Cobertura Mínima Configurada
A cobertura mínima exigida pelo pipeline Jest (`coverageThreshold`) é de **70%** em Statements, Branches, Functions e Lines.
