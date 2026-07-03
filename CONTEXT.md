# PsicoApp — Master Context & Handover Document

Este documento serve como guia definitivo de contexto (handover) para qualquer IA (ChatGPT, Claude, Gemini, Copilot, etc.) ou desenvolvedor que for atuar no monorepo **PsicoApp**. Leia atentamente antes de sugerir refatorações, novos deploys ou quebras de arquitetura.

---

## 0. Localização do Repositório (LEIA PRIMEIRO)

- **Caminho local (máquina do usuário, Windows)**: `C:\Users\Rodrigo\.gemini\antigravity\scratch\psicoapp`
- **Remote GitHub**: `https://github.com/rodrigosonsino-bit/psicoapp.git`
- **Branch de produção**: `master` (push nesta branch dispara deploy contínuo no Railway)

⚠️ **Atenção a diretórios "irmãos" que NÃO são o repositório de produção** — existem pastas parecidas na mesma máquina (ex: `whatsapp-scheduler-app`, `whatsapp-scheduler-backend`, cópias em `antigravity-backup/` e `antigravity-ide/`) que são scratch/backups antigos ou ambientes paralelos do Antigravity, **não o código-fonte ativo**. Sempre confirme que está em `.../scratch/psicoapp` (verifique com `git remote -v` → deve apontar para `rodrigosonsino-bit/psicoapp`) antes de editar ou comitar qualquer coisa.

---

## 1. Visão Geral do Sistema
O **PsicoApp** é um monorepo estruturado (npm workspaces / Turborepo-like) dividido em dois verticais principais de negócio, que compartilham o mesmo banco de dados multi-tenant:

1. **Scheduler (Agendador Inteligente)**: agendamento automático via IA (Sarah/Gemini), conversas automáticas no WhatsApp e integração com Google Calendar.
2. **Psychotherapy (Gestão Clínica)**: gerenciamento de pacientes, prontuários eletrônicos, emissão de recibos mensais/PDF, histórico fiscal e fluxo financeiro dos psicólogos.

---

## 2. Estrutura do Monorepo

```
psicoapp/                          ← raiz (= C:\Users\Rodrigo\.gemini\antigravity\scratch\psicoapp)
├── apps/
│   ├── scheduler-api/             ← Backend do agendador. Porta 3000 local.
│   ├── scheduler-web/             ← Frontend (Dashboard/Painel). Compilado como Desktop App (.exe).
│   ├── psychotherapy-api/         ← Backend da gestão clínica. Porta 3001 local.
│   └── psychotherapy-web/         ← Frontend da clínica (Agenda, Finanças, Prontuário). Web.
├── packages/
│   └── whatsapp-core/             ← Pacote compartilhado: conexão @whiskeysockets/baileys + sessões multi-tenant.
├── docs/                          ← Prompts e specs auxiliares.
├── Dockerfile.scheduler           ← Build do scheduler-api para Railway.
├── Dockerfile.psychotherapy       ← Build do psychotherapy-api para Railway.
└── CONTEXT.md                     ← Este arquivo.
```

| App | Caminho | Porta local | Função |
|---|---|---|---|
| scheduler-api | `apps/scheduler-api/` | 3000 | Agendador IA + WhatsApp + Google Calendar |
| scheduler-web | `apps/scheduler-web/` | — | Dashboard, build Desktop (.exe via electron-builder) |
| psychotherapy-api | `apps/psychotherapy-api/` | 3001 | Pacientes, prontuários, recibos PDF, financeiro |
| psychotherapy-web | `apps/psychotherapy-web/` | — | Agenda, Finanças, Prontuário (web) |
| whatsapp-core | `packages/whatsapp-core/` | — | Baileys + sessões multi-tenant (compartilhado) |

---

## 3. Stack Tecnológica e Hospedagem

### Frontend
- **Frameworks**: React + Vite (`psychotherapy-web`), Expo SDK + Vite (`scheduler-web`).
- **Desktop (Electron)**: `scheduler-web` gera instalador `.exe` (NSIS) via `electron-builder` (`npm run desktop:build`).
- **Hospedagem Web**: Vercel (geralmente `psychotherapy-web`).

### Backend
- **Linguagem**: TypeScript + Node.js (Express).
- **Injeção de Dependência**: `tsyringe` (exige `import 'reflect-metadata';` na raiz de cada API).
- **Hospedagem Backend**: **Railway**. Deploy contínuo via push no GitHub, branch `master`.
- **Filas & Cron Jobs**: BullMQ (Redis) ou timers nativos (`node-cron`/`setInterval`), dependendo do app.

### Banco de Dados e Cache
- **PostgreSQL**: Neon Tech. Credenciais em `DATABASE_URL`.
- **Migrations**: `node-pg-migrate`. Script padrão por API: `npm run migrate` (runner TS interno apontando pro Neon). **Nunca force sync direto; use os arquivos `.sql` locais em `migrations/`.**
- **Redis**: saúde do backend e BullMQ. Hospedado no Railway ou provedor terceiro.

---

## 4. Regras de Ouro & Pontos de Falha Críticos (⚠️ IAs, LEIAM ISSO!)

1. **Concorrência do WhatsApp (Código 440)**
   - O `WhatsappClient` (Baileys) não suporta a mesma sessão logada em dois lugares simultaneamente.
   - `scheduler-api` e `psychotherapy-api` compartilham o mesmo Postgres (que guarda a sessão) → **não podem abrir o websocket ao mesmo tempo**.
   - **`scheduler-api` é o dono** da conexão ativa do WhatsApp.
   - **`psychotherapy-api` DEVE subir com** `DISABLE_WHATSAPP_BOOT=true` (ou `ENABLE_WHATSAPP=false`) no Railway, senão dá `440 Stream Errored (conflict)` e tira a API do ar.

2. **Lembretes Automáticos Duplicados (Google Calendar) — corrigido em 2026-06-28**
   - `scheduler-api` sincroniza eventos de **qualquer** calendário Google configurado pelo tenant (`SyncGoogleCalendarUseCase.ts`) e dispara lembretes via WhatsApp.
   - `psychotherapy-api` cria/mantém seu próprio calendário **"Sessões_Terapia"** (`GoogleCalendarService.ts`, env `GOOGLE_CALENDAR_NAME`) e já envia lembretes de sessão dos pacientes via `ReminderScheduler.ts` (lendo direto da tabela `appointments`, sem depender do Google Calendar).
   - Se um tenant do scheduler apontar para esse mesmo calendário, os dois apps mandavam lembrete duplicado.
   - **Fix aplicado**: `SyncGoogleCalendarUseCase.syncUserCalendar()` agora pula (early return) calendários cujo nome seja `sessões_terapia`/`sessoes_terapia` (case-insensitive), pois esses já são responsabilidade exclusiva do `psychotherapy-api`.
   - ⚠️ Filtro é por **nome do calendário** (string), não por ID — frágil a renomeações. Melhoria futura: usar `extendedProperties`/`colorId` no evento ou armazenar o `calendarId` do psychotherapy-api para matching mais robusto.

3. **Quedas de Pool no Neon**
   - O Neon desliga conexões ociosas abruptamente. O Pool do `pg` em `server.ts` de ambas as APIs tem `dbPool.on('error', ...)` explícito. **Nunca remova isso** — senão o Node.js crasha em produção aleatoriamente.

4. **CORS Flexível**
   - `psychotherapy-api` lê `CORS_ORIGIN` do `.env` aceitando **múltiplas origens separadas por vírgula** (ex: `http://localhost:5173,https://psicoapp-lemon.vercel.app`), via `.split(',')`. Mantenha essa lógica caso o domínio mude.

5. **Tráfego de Build Desktop**
   - Em `scheduler-web`, o fluxo Desktop é preparado por `desktop-prepare.js`. O app renderiza via Expo-Web (`npx expo export --platform web`), encapsulado pelo Electron em `dist-desktop-temp`.

---

## 5. Como Saber se uma Feature é "Scheduler" ou "Psychotherapy"

Antes de tocar em qualquer arquivo, classifique a feature:

- **Pertence ao Scheduler** se envolve: Sarah/IA conversacional, agendamento genérico via WhatsApp, integração de calendário do usuário comum (não terapeuta), painel de conexões.
- **Pertence ao Psychotherapy** se envolve: pacientes, prontuário, sessões de terapia, recibos/PDF, IR, financeiro do psicólogo, calendário "Sessões_Terapia".
- Em caso de lógica repetida entre os dois, extraia para `packages/` (como já foi feito com `whatsapp-core`) em vez de duplicar.

---

## 6. Próximos Passos (Histórico de onde paramos)

- 2026-06-28: corrigido bug de lembretes duplicados de sessão (item 4.2 acima). Commit `666b228` em `master`, já em push para o Railway.
- Foco atual: validações finais de produção (Railway + Vercel) na aba **Faturamento/IR/Recibos PDF** e testes do fluxo de **Login**.

> **Para a próxima IA**: confirme primeiro que está no diretório certo (seção 0). Depois, classifique a feature pedida usando a seção 5. Evite duplicar código entre Scheduler e Psychotherapy — use `packages/` quando a lógica for compartilhada.
