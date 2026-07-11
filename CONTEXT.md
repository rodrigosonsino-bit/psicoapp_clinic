# PsicoApp — Contexto do Repositório

Gestão clínica para psicólogos: pacientes, prontuário eletrônico, sessões,
faturamento mensal, recibos em PDF, agenda com Google Calendar, lembretes.

## Origem

Este repositório nasceu em 2026-07-11 de uma separação do antigo monorepo
`psicoapp` (que continha este produto + o "Scheduler", um agendador via
WhatsApp/IA de outro time). São produtos com bancos de dados e infra de
deploy fisicamente separados desde sempre — só o código-fonte estava
compartilhado. A separação eliminou confusão recorrente de agentes de IA
entre os dois produtos. O monorepo antigo continua arquivado no GitHub como
referência histórica (`git log`/`git blame` de antes de 2026-07-11 estão lá,
não aqui).

## Estrutura

```
/                    <- frontend (Vite + React), raiz do repo
backend/             <- API (Express + TypeScript)
packages/whatsapp-core/  <- cliente Baileys compartilhado (cópia própria
                            deste repo — o Scheduler tem a sua; não são
                            sincronizados automaticamente, ver nota abaixo)
scripts/adhoc/       <- scripts pontuais de manutenção de dados (não fazem
                         parte da aplicação em produção)
docs/                <- planos técnicos e prompts de features
```

## Rodando localmente

```
cd packages/whatsapp-core && npm install && npm run build
cd ../../backend && npm install && npm run dev
cd ..                 && npm install && npm run dev
```

`backend/package.json` depende de `whatsapp-core` via
`file:../packages/whatsapp-core` — não é um pacote npm workspace nem
publicado, é uma dependência de arquivo local. Se `packages/whatsapp-core`
mudar, rodar `npm run build` lá antes de reinstalar no backend.

## Deploy

- Frontend: Vercel (autodetecta Vite na raiz do repo).
- Backend: Railway, via `Dockerfile` na raiz deste repo (`railway.toml`
  aponta pra ele). O Dockerfile builda `packages/whatsapp-core` antes do
  backend — ver comentários no próprio arquivo.

## Acoplamento que sobrevive à separação (regra de negócio, não de código)

- **WhatsApp/Baileys**: o Scheduler é o dono do socket WhatsApp (mesmo
  número de negócio). Este backend roda com `DISABLE_WHATSAPP_BOOT=true`
  em produção — não abrir conexão Baileys daqui enquanto essa regra não
  mudar (evita o "Erro 440" de sessão duplicada).
- **`packages/whatsapp-core` é duplicado**, não compartilhado em tempo real
  com o repo do Scheduler. Se corrigir um bug do Baileys aqui, replicar
  manualmente no outro repo se aplicável.
