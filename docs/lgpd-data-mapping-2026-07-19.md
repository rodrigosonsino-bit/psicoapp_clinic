# Mapeamento de dados sensíveis (LGPD) — 2026-07-19

Levantamento técnico de onde estão os dados sensíveis no schema do PsicoApp,
feito como primeiro passo do gap "LGPD / dado sensível de saúde" identificado
na avaliação de maturidade SaaS. **Escopo: mapeamento e achados técnicos —
não é implementação, e não substitui validação jurídica.**

Baseado em revisão de todas as 94 migrations em `backend/migrations/` e do
código de repositório correspondente.

## Dado de saúde (LGPD art. 11 — categoria mais sensível)

| Tabela | Campos | Observação |
|---|---|---|
| `psychotherapy_clinical_notes` | `content`, `tags[]` | Prontuário/evolução clínica, texto livre |
| `psychotherapy_anamnesis` | `chief_complaint`, `medications`, `family_history`, `relevant_history`, `previous_treatment`, **`cid_codes[]`** | Anamnese completa + **códigos de diagnóstico CID** — o dado mais crítico do sistema |
| `psychotherapy_treatment_plans` | `goals[]`, `approach`, `notes` | Plano terapêutico |
| `psychotherapy_sessions` | `notes` | Nota por sessão |
| `psychotherapy_patients` | `notes` | Campo livre — pode conter qualquer coisa, inclusive clínico |
| `psychotherapy_whatsapp_messages` | `body` | Histórico de conversa paciente↔terapeuta, pode conter relato de crise/sintoma |
| `sarah_patient_profiles` | `referral`, `notes` | Perfis de prospecção via bot WhatsApp |

## PII (identificação/contato)

- `psychotherapy_patients`: `name`, `full_name`, `phone`, `email`, `document` (CPF)
- `tenants`: `document` (CPF/CNPJ), `address`, `professional_id` (CRP)
- `psychotherapy_receipts`: nomes/CPFs de responsável e beneficiário em
  snapshot imutável (`provider_document`, `beneficiary_document`,
  `responsible_document`, etc. — migration `043_expand_receipts.sql`)
- `psychotherapy_bank_statement_transactions`: `payer_name_guess`

## Credenciais/segredos

Não é dado do paciente, mas alto risco de account takeover se vazar:

| Tabela | Campo | Status de criptografia |
|---|---|---|
| `whatsapp_auth` | `value` (JSONB, chaves de sessão Baileys) | **Não criptografado** |
| `google_oauth_tokens` | `access_token`, `refresh_token` | Criptografado (`cryptoHelper`, AES-256-GCM) |
| `gmail_oauth_tokens` | `encrypted_access_token`, `encrypted_refresh_token` | Criptografado (mesmo helper) |
| `tenants` | `totp_secret` | Criptografado (`cryptoHelper`) |
| `tenants` | `totp_backup_codes` | Hash bcrypt (padrão correto, como senha) |
| `tenants` | `password_hash` | Hash bcrypt |

## Achados técnicos concretos (sem depender de decisão jurídica)

### 1. Falha crítica na criptografia em repouso

`backend/src/infrastructure/auth/cryptoHelper.ts:3`:

```ts
const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'default-secret-key-must-be-32-bytes!';
```

Fallback hardcoded, público no código-fonte. Se `MASTER_ENCRYPTION_KEY` não
estiver configurada no Railway, todo token OAuth (Google Calendar, Gmail) e
segredo TOTP "criptografado" no banco é trivialmente decifrável por qualquer
um que leia o repositório. A variável não está documentada em nenhum
`.env.example` do projeto.

**Pendente de verificação**: confirmar se `MASTER_ENCRYPTION_KEY` está de
fato configurada como variável de ambiente no Railway em produção — isso não
foi verificado nesta sessão (sem acesso ao painel/CLI do Railway) e muda a
severidade real do achado.

### 2. "Exclusão" de paciente é só soft-delete

`PostgresPatientRepository.deletePatient()` executa:

```sql
UPDATE psychotherapy_patients SET deleted_at = NOW(), updated_at = NOW()
WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL;
```

Nunca um `DELETE` real. Resultado: prontuário, anamnese (com CID), plano
terapêutico, histórico de WhatsApp e recibos de um paciente "excluído"
continuam **para sempre** no banco — só ficam invisíveis nas listagens (todas
as queries filtram `WHERE deleted_at IS NULL`). Hoje não existe nenhum
mecanismo de apagamento real dessas tabelas relacionadas. Isso é diretamente
o direito de exclusão do art. 18 da LGPD, e é um gap técnico puro — não
precisa de validação jurídica pra confirmar que falta, só para decidir *como*
implementar (ver abaixo).

## O que precisa de validação jurídica antes de qualquer implementação

- **Política de retenção**: por quanto tempo guardar prontuário depois que o
  paciente sai — há entendimento de que registro clínico pode ter prazo
  mínimo legal antes de poder ser apagado (precisa confirmar com
  advogado/conselho profissional, ex. CFP).
- **Hard-delete vs. anonimização**: se a exclusão deve remover a linha
  inteira, ou manter dado financeiro (por obrigação fiscal) e só
  anonimizar/remover o conteúdo clínico.
- **Base legal e documentação formal**: hoje não existe política de
  privacidade publicada, DPO nomeado, nem registro da base legal para cada
  tratamento de dado (consentimento vs. execução de contrato vs. tutela da
  saúde, art. 11 §1º).

## Não implementado nesta sessão

Este documento é só o levantamento. Qualquer implementação decorrente
(rotação/validação de `MASTER_ENCRYPTION_KEY`, mecanismo real de exclusão,
criptografia do `whatsapp_auth`) precisa passar pela auditoria do Codex CLI
antes de codar, conforme a regra permanente do projeto.
