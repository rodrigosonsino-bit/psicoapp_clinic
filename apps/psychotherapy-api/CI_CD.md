# GitHub Actions CI/CD Setup

## ✅ Workflows Criados

### 1. **CI/CD Pipeline** (`.github/workflows/ci.yml`)

Executa automaticamente a cada push ou pull request:

- ✅ **Testes Unitários** - Jest com cobertura
- ✅ **Build** - Compilação TypeScript
- ✅ **Type Checking** - Validação de tipos
- ✅ **Security Audit** - npm audit
- ✅ **Upload Coverage** - Codecov integration
- ✅ **PR Comments** - Feedback automático em pull requests

**Testa em:**
- Node.js 18.x
- Node.js 20.x

### 2. **Lint & Format** (`.github/workflows/lint.yml`)

Valida código e dependências:

- ✅ **ESLint** - Linting (quando configurado)
- ✅ **Prettier** - Formatação (quando configurado)
- ✅ **Outdated Check** - Dependências desatualizadas
- ✅ **Vulnerability Check** - npm audit

---

## 🎯 Fluxo de Trabalho

```
Push to main/develop
        ↓
┌─────────────────────────────────┐
│  CI/CD Pipeline (ci.yml)        │
├─────────────────────────────────┤
│ ✅ Test (Node 18.x)             │
│ ✅ Test (Node 20.x)             │
│ ✅ Build                         │
│ ✅ Type Check                    │
│ ✅ Security Audit               │
└─────────────────────────────────┘
        ↓
┌─────────────────────────────────┐
│  Lint & Format (lint.yml)       │
├─────────────────────────────────┤
│ ✅ ESLint                        │
│ ✅ Prettier                      │
│ ✅ Dependency Check              │
└─────────────────────────────────┘
        ↓
✅ Merge to main (se tudo passar)
```

---

## 📊 Artifacts Gerados

- `coverage/` - Relatório de cobertura de testes
- `npm-audit` - Relatório de vulnerabilidades
- Codecov badge no README

---

## 🚀 Próximas Configurações Recomendadas

### 1. **ESLint + Prettier** (Code Quality)
```bash
npm install --save-dev eslint @typescript-eslint/eslint-plugin prettier
```

### 2. **Codecov Integration**
- Adicionar badge ao README
- Configurar limites de cobertura

### 3. **Branch Protection Rules**
No GitHub, configure:
- Require CI/CD workflow to pass before merge
- Require pull request reviews
- Dismiss stale pull request approvals
- Require branches to be up to date before merging

### 4. **Deploy Automation** (Opcional)
Adicionar workflow de deploy automático após merge para main

---

## 📝 Badge de Status

Adicione ao seu README.md:

```markdown
[![CI/CD Pipeline](https://github.com/rodrigosonsino-bit/psychotherapy-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/rodrigosonsino-bit/psychotherapy-backend/actions)

[![Lint & Format](https://github.com/rodrigosonsino-bit/psychotherapy-backend/actions/workflows/lint.yml/badge.svg)](https://github.com/rodrigosonsino-bit/psychotherapy-backend/actions)
```

---

## ✨ Features

- ✅ Testes em múltiplas versões do Node.js
- ✅ Coverage reporting com Codecov
- ✅ Type safety com TypeScript compiler
- ✅ Security scanning
- ✅ Automated PR feedback
- ✅ Dependency management
- ✅ Code quality checks

**Status:** Pronto para uso! 🎉
