# Conciliação de Extrato Bancário (CSV/OFX Nubank) → Baixa de Sessões — Plano v7 — **IMPLEMENTADO (2026-07-11)**

> **Status**: implementação completa nesta sessão (migrations 090-092
> aplicadas em produção, backend, frontend, todos testados de ponta a ponta
> numa branch Neon descartável antes de qualquer coisa tocar produção real —
> ver seção "Implementação" no final do arquivo). Deploy em produção ainda
> **não** foi feito — falta commit/push/deploy do código (não das
> migrations, já aplicadas).

> **Histórico**: v1-v4 reprovadas pelo Codex CLI. **v5 aprovada** (lógica
> financeira das seções 3-8 — schema, gates, transação atômica — congelada
> e aprovada, continua valendo). **v6 mudou pra PDF** depois que o primeiro
> extrato de exemplo (conta CNPJ, recém-criada) só tinha exportação em PDF
> disponível — **aprovado com ressalvas** após 2 rodadas de auditoria focada
> em parsing posicional de PDF.
>
> **v7 reverte a ingestão pra CSV/OFX**: o usuário conseguiu exportar um
> extrato de teste (conta pessoal, mesmo titular, mesmo banco — usada só pra
> validar formato, já que a conta CNPJ é nova e não tem histórico) nos 3
> formatos, e **confirmou que CSV/OFX também estão disponíveis pra conta
> CNPJ "se precisar"**. Achado decisivo: **CSV e OFX têm um identificador de
> transação real, estável e único** (`Identificador` no CSV = `<FITID>` no
> OFX — confirmado byte-a-byte idêntico entre os dois arquivos pra mesma
> transação) — o PDF simplesmente não exibe esse campo, mas ele existe no
> sistema. Isso elimina a maior parte da complexidade adicionada na v6
> (extração posicional de PDF, hash de dedupe com `occurrence_index`,
> hardening específico contra PDF malicioso) — volta a ser dedupe simples
> por `UNIQUE (tenant_id, fitid)`, como as versões v1-v5 originalmente
> presumiam (antes de eu ter presumido errado que só PDF estava disponível).
> Ainda não foi re-auditada nesta forma; a lógica financeira das seções 3-8
> não muda.

## Contexto e objetivo

A terapeuta recebe pagamentos de pacientes numa conta CNPJ dedicada no
Nubank (só recebe desse público — sem contas conjuntas, sem outras receitas
misturadas). Hoje, dar baixa numa sessão paga é manual (Faturamento Mensal
ou atalho em Agendamentos).

Objetivo: importar o extrato (OFX/CSV do Nubank), o app **sugere** o
casamento de cada transação recebida com um paciente **individual** e a
quantidade de sessões correspondente, terapeuta confirma com 1 clique.
**Nada é gravado sem confirmação explícita.**

## Escopo v1 (produto): SÓ pacientes individuais — grupos ficam fora, tecnicamente impostos

Decisão do usuário (2026-07-10), mantida. Matching usa **só**
`listIndividualPatientsForBilling` (`individual_therapy_enabled=TRUE`), que
naturalmente exclui membros só-de-grupo. Transação que seria de grupo não
gera sugestão — terapeuta ignora nesta ferramenta e trata pelo fluxo de
grupo existente.

**Correção da v3**: `listIndividualPatientsForBilling` **não filtra
`status != 'inactive'`** (esse filtro só é aplicado depois, em
`GeneratePsychotherapyMonthUseCase`). O motor de matching e o endpoint de
confirmação precisam aplicar esse filtro explicitamente também — ver seção
4 e 5.

## Decisões já tomadas em sessões anteriores que este plano precisa respeitar

- **Pagamento em valor não-redondo (parcial) — decisão vigente: não
  implementar.**
- **Nunca escrever em dado financeiro real sem confirmação explícita, e
  sempre via API/UseCase da aplicação — nunca UPDATE/DELETE direto em tabela
  protegida.**
- **Migrations sempre testadas antes em branch Neon descartável.**
- **`tsc -b`/build completo + `vercel ls` até `Ready` + verificação de hash
  de bundle antes de considerar mudança de frontend concluída.**

## `financial_payments` — escopo mantido, com uma trava nova (cutover)

Correção da v1: `financial_payments` **é** escrito em produção (SQL cru em
`ConfirmGroupPaymentUseCase.ts`, para grupos). O fluxo **individual**
continua sem usar o ledger — só `paid_sessions`. Esta feature mantém esse
padrão: grava só em `psychotherapy_monthly_records.paid_sessions`, não em
`financial_payments`.

**Achado novo da v2, verificado nesta sessão**: existe uma tabela
`tenant_financial_cutovers` — para tenants com cutover **aprovado**,
`syncMonthlyRecord` passa a derivar `paid_sessions`/`payment_status` **do
ledger** (`financial_payments`), sobrescrevendo qualquer valor manual no
próximo sync. Se esta feature escrevesse `paid_sessions` num mês
pós-cutover, o próximo sync apagaria a baixa silenciosamente.

**Verificado no banco de produção (Neon, 2026-07-10): `tenant_financial_cutovers`
está vazia — nenhum tenant tem cutover hoje.** O risco não está ativo, mas é
uma armadilha para o futuro. **Mitigação obrigatória, não opcional**: o
endpoint de confirmação (seção 5) consulta essa tabela dentro da própria
transação e **recusa a confirmação com 409** se o mês confirmado for
pós-cutover para o tenant, com mensagem explícita orientando a usar o fluxo
de ledger financeiro em vez desta feature. Falha de forma visível, nunca
silenciosa.

## Prevenção de double-count com Pix — fechada de verdade nesta v3

Achado da v2: a v2 só checava duplicata Pix no **momento do import**, o que
deixava uma janela (TOCTOU) entre o import e o clique de confirmar — se o
webhook Pix confirmasse o pagamento nesse meio-tempo, a checagem antiga já
tinha passado.

**Correção**: a checagem de Pix compatível (mesmo paciente, valor igual;
`pending` sempre considerado, `paid` só dentro de ±3 dias de `paid_at` — ver
regra exata e corrigida no passo 3 da seção 5) roda **duas vezes**: (1) no
import, só para gerar o aviso visual `possible_pix_duplicate` na UI; (2)
**de novo, dentro da mesma transação SQL do endpoint de confirmação** (seção
5), como último gate antes de gravar, agora com `FOR UPDATE`. Se encontrar
duplicata nesse 2º check, a transação inteira é desfeita (`ROLLBACK`) e
retorna 409 — mesmo que a checagem do import não tivesse pego nada na hora.

## Unificação do caminho de escrita em `paid_sessions` (achado mais importante da v2)

Descoberto nesta sessão: já existe um **terceiro** caminho que escreve
`paid_sessions` sem lock — `PaymentReceiptHandler.ts` (leitura de comprovante
de pagamento por foto via WhatsApp + Claude Vision, casa paciente por
telefone, calcula sessões, faz `UPDATE` direto sem transação/lock). Hoje ele
está **dormant em produção** (gated por `isWhatsappEnabled`, e o PsicoApp
roda com `DISABLE_WHATSAPP_BOOT=true` — regra de ouro documentada, o
Scheduler é dono do socket Baileys). Mas é código real, existente, que pode
voltar a ficar ativo (mudança de flag, ou uma feature futura de Cloud API
inbound equivalente).

**Correção proposta, pequena e cirúrgica (não é um refactor grande)**:
substituir o padrão "SELECT, calcula em JS, UPDATE absoluto" por um único
**UPDATE atômico** que soma direto no banco, sem round-trip JS no meio:

```sql
UPDATE psychotherapy_monthly_records
SET paid_sessions  = LEAST(
                        paid_sessions + $1::int,
                        GREATEST(expected_sessions - absences, 0)
                      ),
    payment_status = CASE
                        WHEN LEAST(paid_sessions + $1::int, GREATEST(expected_sessions - absences, 0))
                             >= GREATEST(expected_sessions - absences, 0)
                             AND GREATEST(expected_sessions - absences, 0) > 0
                          THEN 'paid'
                        WHEN LEAST(paid_sessions + $1::int, GREATEST(expected_sessions - absences, 0)) > 0
                          THEN 'partial'
                        ELSE 'pending'
                      END,
    updated_at      = NOW()
WHERE id = $2 AND tenant_id = $3
RETURNING paid_sessions, payment_status;
```

Um `UPDATE` de linha única no Postgres já é atômico por natureza — não
precisa de `SELECT ... FOR UPDATE` explícito nem de round-trip
ler-calcular-escrever em JS, que é exatamente o que causava a race entre
dois escritores concorrentes. **Esta v3 propõe extrair essa query como um
helper único** (`incrementPaidSessions(client, tenantId, recordId,
sessionsToAdd)` em algum módulo compartilhado do repositório) e:
1. Usar esse helper no novo endpoint de confirmação (seção 5).
2. **Refatorar `PaymentReceiptHandler.applyPayment` para usar o mesmo
   helper**, no mesmo PR desta feature — pequeno, mecânico, elimina a race
   de vez em vez de só evitá-la no código novo. Isso é um co-requisito deste
   plano, não um nice-to-have.

`saveMonthlyRecord`/`syncMonthlyRecord` (edição manual na tela de
Faturamento Mensal) continuam fora dessa unificação — esse caminho já é
"fonte de verdade manual" por natureza (o usuário está literalmente editando
o registro na tela), e concorrência entre "terapeuta editando a tela" e
"webhook automático confirmando ao mesmo tempo" é um risco aceito, não
resolvido por esta feature — mas com o helper atômico, pelo menos os dois
caminhos *automáticos* (bank reconciliation + WhatsApp receipt) não se
pisam mais entre si.

## Arquitetura proposta

### 1. Ingestão do arquivo — só CSV na v1 (correção pós-auditoria: contrato ambíguo)

**Achado da auditoria final (Codex CLI, 2026-07-11)**: a v7 dizia aceitar
`.csv` **ou** `.ofx` na ingestão, mas a seção 2 só desenhava o parser CSV
("não é necessário implementar os dois... só o CSV"). Contrato ambíguo —
corrigido: **a v1 aceita só `.csv`**. OFX fica documentado como formato
equivalente (mesmo FITID, mesmo texto de descrição) pra uma v2 futura, mas
o endpoint **rejeita explicitamente** um `.ofx` enviado agora:

- `POST /api/psychotherapy/bank-statements/import` (`multipart/form-data`,
  1 arquivo `.csv`).
- Se o arquivo enviado for `.ofx` (ou qualquer outra extensão): `415
  Unsupported Media Type`, mensagem clara "OFX ainda não suportado nesta
  versão — exporte em CSV". Nunca aceitar silenciosamente e tentar
  processar como CSV.
- `multer` memory storage, `limits: { fileSize: 5MB, files: 1 }` — extrato
  de 1 mês inteiro da amostra real analisada tinha ~16KB pra 96 transações;
  5MB cobre anos de histórico com folga.
- Validar conteúdo mínimo antes de processar: cabeçalho reconhecível
  (`Data,Valor,Identificador,Descrição`, tolerando BOM/variação de acento)
  — ver regras concretas de encoding na seção 2.
- Rate limit por tenant.
- Timeout de parsing (~10s) e limite de linhas (ex. 5000 transações por
  import — bem acima do que uma conta pequena geraria num ano).
- **Não persistir o arquivo bruto** — só as transações já parseadas vão pro
  banco (o arquivo contém nome completo e CPF mascarado de terceiros).
- **Sem os riscos de segurança específicos de PDF** (parser bomb via
  fontes/object streams comprimidos, PDF criptografado, etc. — não se
  aplicam a CSV, que é texto plano). Ainda assim, tratar o parsing como
  entrada não confiável: nunca `eval`/interpretar conteúdo além de
  split/regex via `csv-parse`, nunca logar o conteúdo bruto em caso de
  erro. **Novo, da auditoria**: se `raw_description` for reexportado no
  futuro (ex. relatório CSV/Excel pro usuário), neutralizar campos que
  comecem com `=`, `+`, `-`, `@` (proteção contra CSV formula
  injection/execução no Excel) — não relevante pra v1 (só grava no banco,
  não reexporta), mas documentado pra quando essa feature aparecer.

### 2. Parsing — CSV via `csv-parse`, com regras estritas (endurecido pós-auditoria)

**Regras concretas de parsing, exigidas pela auditoria final (evitar
armadilhas comuns de parsing "no chute"):**
- **Data**: parser estrito de `DD/MM/AAAA` (regex + validação de
  dia/mês/ano, ex. `date-fns/parse` com `strict: true` ou equivalente) —
  **nunca `new Date(string)`**, que aceita formatos ambíguos/inválidos
  silenciosamente e pode interpretar `DD/MM` como `MM/DD` dependendo do
  locale do processo. Data inválida → linha vai pra `skipped_line_count`.
- **Valor**: parsear o decimal como string e converter pra centavos via
  manipulação de string (`"7200.00"` → separa em `7200` e `00` → `720000`
  centavos) — **nunca `parseFloat(valor) * 100`**, que introduz erro de
  ponto flutuante (ex. `0.1 + 0.2 !== 0.3` em JS) capaz de gerar centavo
  errado num valor financeiro.
- **Encoding/header**: detectar e remover BOM UTF-8 (`﻿`) se presente
  no início do arquivo antes de parsear; normalizar quebra de linha
  (CRLF/LF); comparar o header ignorando espaços extras. Se o encoding não
  for UTF-8 (ex. Latin-1/ISO-8859-1, comum em export de banco BR), nomes
  acentuados e o caractere de máscara do CPF podem corromper — detectar e
  reportar erro claro em vez de deixar corromper silenciosamente.
- **4 colunas estritas**: `csv-parse` configurado pra rejeitar linha com
  número de colunas diferente de 4 (`columns: true` + validação de
  contagem) — linha com coluna a mais/a menos (ex. `Descrição` contendo
  vírgula não escapada, se algum dia acontecer) vira `skipped_line_count`
  em vez de corromper o parsing das colunas seguintes.
- **`skipped_line_count` visível, não enterrado**: em conciliação
  financeira, uma linha pulada pode ser um pagamento real que não vai
  aparecer pra baixa. A UI mostra esse número **em destaque** no resumo
  pós-import (não só num tooltip/log), com um link/detalhe de quais linhas
  foram puladas e por quê.
- **`fitid`**: validar não-vazio e trimado antes do insert; normalizar pra
  lowercase (o formato observado já é UUID lowercase, mas normalizar
  remove ambiguidade se o Nubank algum dia mudar capitalização).

**OFX documentado como alternativa equivalente pra v2 futura** (mesmo
FITID, mesmo texto de descrição/MEMO) — **não implementado nesta v1** (ver
correção de contrato na seção 1). Se implementado depois, usar biblioteca
de parse madura, nunca parser XML/SGML próprio com resolução de entidade
externa habilitada (proteção XXE).

**Validado com 2 extratos reais**: 1 semanal (conta CNPJ, 07/2026, só PDF
disponível — usado só pra entender a taxonomia de descrições) e 1 mensal
completo (conta pessoal do mesmo titular, 06/2026, **96 transações**, nos 3
formatos PDF/CSV/OFX — usado pra validar CSV/OFX de verdade).

**Formato CSV confirmado** (4 colunas, separador `,`, decimal com `.`,
crédito/débito só pelo sinal do valor):
```
Data,Valor,Identificador,Descrição
01/06/2026,7200.00,6a1d8e1b-b1e5-49af-8541-5d6ff3a16655,Transferência recebida pelo Pix - MINISTERIO FONTE DE VIDA - 06.044.894/0001-06 - BCO DO BRASIL S.A. (0001) Agência: 347 Conta: 101200-2
03/06/2026,-20.00,6a204245-b450-4aea-a1c6-4982281c2363,Transferência enviada pelo Pix - Ismael Zieberg - •••.106.628-•• - BCO MERCANTIL DO BRASIL S.A. (0389) Agência: 383 Conta: 1014550-6
```
- `Data`: `DD/MM/AAAA`.
- `Valor`: positivo = crédito, negativo = débito — **filtro "só crédito" é
  simplesmente `Valor > 0`**, sem heurística de texto.
- `Identificador`: **UUID único e estável por transação** (achado
  decisivo desta v7 — ver cabeçalho). Confirmado idêntico ao `<FITID>` do
  OFX pra mesma transação, no mesmo arquivo exportado.
- `Descrição`: mesmo texto livre observado no PDF (ver padrões abaixo).

**Formato OFX confirmado** (SGML, `STMTTRN` por transação):
```
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260601000000[-3:BRT]</DTPOSTED>
<TRNAMT>7200.00</TRNAMT>
<FITID>6a1d8e1b-b1e5-49af-8541-5d6ff3a16655</FITID>
<MEMO>Transferência recebida pelo Pix - MINISTERIO FONTE DE VIDA - 06.044.894/0001-06 - BCO DO BRASIL S.A. (0001) Agência: 347 Conta: 101200-2</MEMO>
</STMTTRN>
```
- `<TRNTYPE>` já vem explícito (`CREDIT`/`DEBIT`) — nem precisa checar o
  sinal do valor.
- `<FITID>` = mesmo UUID do `Identificador` do CSV.
- `<MEMO>` = mesmo texto do `Descrição`.

**Decisão de implementação**: CSV como formato primário (`csv-parse`,
biblioteca madura, 4 colunas fixas, sem ambiguidade de parsing) — mais
simples que lidar com a estrutura SGML do OFX, mesmo essa sendo regular.
OFX fica documentado como fonte alternativa igualmente válida (mesmo FITID,
mesmo texto de descrição) caso o usuário prefira exportar nesse formato;
não é necessário implementar os dois parsers na v1, só o CSV.

**Taxonomia de `Descrição`/`MEMO` confirmada em 96 transações reais**:
- Créditos candidatos a pagamento de paciente (2 padrões, mesmos já vistos
  no PDF):
  - `Transferência recebida pelo Pix - [NOME] - [CPF/CNPJ] - [BANCO] ([CÓDIGO])
    Agência: X Conta: Y` — Pix de banco externo.
  - `Transferência Recebida - [NOME] - [CPF/CNPJ] - NU PAGAMENTOS - IP (0260)
    Agência: 1 Conta: Y` — transferência interna Nubank-para-Nubank (sem
    "pelo Pix" no texto).
- **Achado novo, confirmado só com o extrato mensal completo (não aparecia
  na amostra semanal menor)**: **nem todo crédito é candidato a pagamento
  de paciente.** A amostra real tem créditos legítimos de categorias
  completamente diferentes: `Resgate RDB` (resgate de aplicação financeira,
  ex. `+10521.45`), sem nenhum nome/CPF na descrição. O parser **não trata
  isso como erro** — só não extrai `payer_name_guess` (fica `null`), então
  o motor de matching (seção 4) naturalmente não gera sugestão
  (`match_confidence='none'`) por falta de nome pra comparar. Não precisa
  de uma lista de exclusão explícita de categorias — a ausência de padrão
  reconhecido já resulta em "sem sugestão" com segurança.
- **Pagador pode ser pessoa jurídica, com CNPJ não mascarado**: ex.
  `MINISTERIO FONTE DE VIDA - 06.044.894/0001-06` (CNPJ completo, formato
  `NN.NNN.NNN/NNNN-NN`, sem máscara — diferente do CPF de pessoa física,
  que vem sempre mascarado `•••.NNN.NNN-••`). O regex de extração precisa
  aceitar os dois formatos de documento.
- **Correção da auditoria final — caractere de máscara exato**: o `•` usado
  na máscara do CPF **não é asterisco nem aproximação ASCII** — é o
  caractere Unicode `•` (BULLET, U+2022, bytes UTF-8 `E2 80 A2`),
  confirmado byte a byte no arquivo real. O regex precisa casar esse
  caractere Unicode específico (`•`), não `\*` ou `.`. Regex também
  deve ficar **ancorado nos prefixos conhecidos** (`^Transferência
  (recebida pelo Pix|Recebida) - `), não genérico demais, pra evitar match
  falso em descrições de categorias não relacionadas a Pix. Nome de pagador
  com hífen interno ou razão social contendo ` - ` pode confundir uma regex
  baseada só em separador — risco aceito como baixo (cai em "sem
  sugestão", não em sugestão errada) dado o fallback já desenhado.
- **Nome do pagador vem completo e legível** em ambos os padrões — melhor
  do que a suposição original do plano (v1-v5 assumiam extração
  "heurística e falível"). CPF mascarado pode reforçar o match (6 dígitos
  do meio comparados contra `psychotherapy_patients.document`), CNPJ
  completo permite match exato se o paciente/pagador for pessoa jurídica
  (raro no contexto de pacientes individuais, mas o parser não precisa
  descartar o caso).
- Débitos (`Valor < 0`) são excluídos pelo filtro de sinal, então nem
  chegam a ser regex-parseados pra extração de nome — irrelevante se o
  texto deles é regular ou não.

**Deduplicação — simplificada de volta, agora que FITID é real** (achado
decisivo desta v7 — a v6 tinha adicionado `dedup_hash`+`occurrence_index`
porque presumia que não existia nenhum ID estável no PDF; isso não se
aplica mais): `UNIQUE (tenant_id, fitid)` com `ON CONFLICT DO NOTHING` —
reimportar um período sobreposto não duplica transação já vista, sem
precisar de hash de alta entropia nem de índice de ocorrência. Risco
residual muito menor do que na v6: só existiria colisão se o Nubank
reaproveitasse o mesmo `Identificador`/`FITID` pra duas transações
diferentes — não observado nas 96 transações da amostra (todos únicos), e
o formato do ID (UUID) tem entropia alta o suficiente pra ser
extremamente improvável.

- Parse parcial não aborta o import inteiro — linhas que não casam com
  nenhuma das 4 colunas esperadas (linha corrompida, encoding quebrado)
  são puladas e contadas em `skipped_line_count`. Linhas de crédito sem
  padrão de nome reconhecido (ex. `Resgate RDB`) **não são erro de parse**
  — são candidatos legítimos com `payer_name_guess=null`, contabilizadas
  normalmente em `transaction_count`.
- Biblioteca: `csv-parse` (nova dependência, madura e amplamente usada —
  bem mais simples que a extração posicional de PDF cogitada na v6, que
  foi descartada).
- **Teste recomendado antes de produção**: já validado contra 1 extrato
  mensal completo real (96 transações, boa variedade de padrões). Testar
  contra pelo menos mais 1 extrato da própria conta CNPJ assim que houver
  histórico suficiente, pra confirmar que o formato de export é idêntico
  entre contas PF e PJ do Nubank (esperado que seja, já que é o mesmo motor
  de geração de extrato, mas não formalmente confirmado pra conta PJ
  ainda).

### 3. Novas tabelas (migrations `090` + `091`, separadas)

`090_bank_statement_imports.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Confirmar antes se o plano Neon permite; fallback sem trigram documentado
-- na seção de riscos se não permitir.

CREATE TABLE psychotherapy_bank_statement_imports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  file_name         VARCHAR(255) NOT NULL,
  file_format       VARCHAR(10) NOT NULL CHECK (file_format IN ('csv','ofx')),
  period_start      DATE,
  period_end        DATE,
  transaction_count INT NOT NULL DEFAULT 0,
  skipped_line_count INT NOT NULL DEFAULT 0,
  duplicate_fitid_count INT NOT NULL DEFAULT 0,
  imported_by       UUID NOT NULL REFERENCES tenants(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE psychotherapy_bank_statement_transactions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  import_id              UUID NOT NULL,
  -- FITID real do banco (coluna "Identificador" no CSV / <FITID> no OFX),
  -- confirmado estável e único por transação com extrato real (ver seção 2).
  fitid                  VARCHAR(100) NOT NULL,
  posted_at              DATE NOT NULL,
  amount_cents           INT NOT NULL CHECK (amount_cents > 0),
  raw_description        TEXT NOT NULL,
  payer_name_guess       VARCHAR(255),

  suggested_patient_id   UUID,
  suggested_month        CHAR(7) CHECK (suggested_month ~ '^\d{4}-\d{2}$'),
  suggested_sessions     INT CHECK (suggested_sessions IS NULL OR suggested_sessions > 0),
  match_confidence       VARCHAR(20) NOT NULL DEFAULT 'none'
                          CHECK (match_confidence IN ('high','medium','low','none')),
  possible_pix_duplicate BOOLEAN NOT NULL DEFAULT FALSE,

  status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','ignored')),
  confirmed_patient_id    UUID,
  confirmed_month         CHAR(7) CHECK (confirmed_month ~ '^\d{4}-\d{2}$'),
  confirmed_sessions      INT CHECK (confirmed_sessions IS NULL OR confirmed_sessions > 0),
  confirmed_at            TIMESTAMPTZ,
  confirmed_by            UUID,
  ignored_at              TIMESTAMPTZ,
  ignored_by              UUID,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (import_id, tenant_id)
    REFERENCES psychotherapy_bank_statement_imports (id, tenant_id) ON DELETE CASCADE,
  -- RESTRICT (não SET NULL) em ambas — evita problema de FK composta com
  -- coluna NOT NULL (tenant_id) no meio do SET NULL; mesmo padrão de
  -- financial_payments.patient_id.
  FOREIGN KEY (suggested_patient_id, tenant_id)
    REFERENCES psychotherapy_patients (id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (confirmed_patient_id, tenant_id)
    REFERENCES psychotherapy_patients (id, tenant_id) ON DELETE RESTRICT,
  -- FK simples pra tenants(id), igual ao padrão já usado em
  -- financial_payments.created_by — modelo atual é 1 operador == o próprio
  -- tenant, sem tabela de usuários separada.
  FOREIGN KEY (confirmed_by) REFERENCES tenants(id),
  FOREIGN KEY (ignored_by) REFERENCES tenants(id),
  CHECK (confirmed_by IS NULL OR confirmed_by = tenant_id),
  CHECK (ignored_by IS NULL OR ignored_by = tenant_id),

  UNIQUE (tenant_id, fitid),

  -- Integridade de estado completa para as 3 combinações válidas
  CONSTRAINT bank_stmt_tx_state_integrity CHECK (
    (status = 'pending'
      AND confirmed_patient_id IS NULL AND confirmed_sessions IS NULL
      AND confirmed_month IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND ignored_at IS NULL AND ignored_by IS NULL)
    OR
    (status = 'confirmed'
      AND confirmed_patient_id IS NOT NULL AND confirmed_sessions IS NOT NULL
      AND confirmed_month IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL
      AND ignored_at IS NULL AND ignored_by IS NULL)
    OR
    (status = 'ignored'
      AND confirmed_patient_id IS NULL AND confirmed_sessions IS NULL AND confirmed_month IS NULL
      AND confirmed_at IS NULL AND confirmed_by IS NULL
      AND ignored_at IS NOT NULL AND ignored_by IS NOT NULL)
  )
);
```

`091_bank_statement_tx_idx_concurrently.sql` (arquivo separado, sem
transação implícita com o DDL acima — padrão pós-incidente da migration 081):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_stmt_tx_tenant_status
  ON psychotherapy_bank_statement_transactions (tenant_id, status);

-- Suporte ao gate de duplicata Pix (seção 5, passo 3) — busca por
-- paciente+valor num índice parcial só de cobranças pending/paid, evitando
-- full scan em psychotherapy_pix_charges a cada confirmação.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pix_charges_patient_amount_active
  ON psychotherapy_pix_charges (tenant_id, patient_id, amount_cents)
  WHERE status IN ('pending', 'paid');
```

### 4. Motor de matching (síncrono, na importação)

Pool de candidatos: `listIndividualPatientsForBilling` **filtrado
explicitamente por `status != 'inactive'`** no próprio motor de matching
(correção da v3 — não presumir que o método do repositório já faz isso).

Para cada transação de crédito:

1. Checagem de duplicata Pix (aviso na UI, não bloqueia o import — o
   bloqueio de verdade é no confirm, seção 5).
2. Match por nome (`pg_trgm`/`similarity()`, fallback sem trigram se a
   extensão não estiver disponível).
3. Mês de competência sugerido = mês de `posted_at`, **sempre editável na
   UI antes de confirmar**.
4. Match por valor contra o registro mensal do paciente candidato **para o
   mês sugerido** (não contra o cadastro do paciente isolado):
   - `per_session`: só sugere se `amount_cents % session_price_cents == 0`.
   - `monthly`: só sugere se bate exato com `expected_amount_cents` do
     registro daquele mês.
   - Clamp contra saldo pendente (`expected_sessions - absences -
     paid_sessions`); se valor > saldo, não sugere sessões, só o paciente
     (confiança `medium`, aviso de overpayment).
5. Confiança `high`/`medium`/`low`/`none` como nas versões anteriores,
   `possible_pix_duplicate=true` força `none`.

`suggested_sessions` é só uma prévia para a UI — **o valor real gravado no
confirm é sempre recalculado no servidor a partir da transação e do
registro mensal no momento do commit** (seção 5), nunca confiado do
matching nem do payload do cliente.

### 5. Confirmação — endpoint atômico, sem `sessions` no payload do cliente

```
POST /api/psychotherapy/bank-statements/transactions/:id/confirm
Body: { patientId, month }   -- SEM campo "sessions": o servidor deriva
```

```
POST /api/psychotherapy/bank-statements/transactions/:id/ignore
POST /api/psychotherapy/bank-statements/transactions/confirm-batch
  Body: { ids: [...] }        -- cada id confirmado com o patientId/month
                                 já sugeridos automaticamente (lote só usa
                                 sugestões de alta confiança, não pede
                                 input manual por item)
GET  /api/psychotherapy/bank-statements/imports/:importId/transactions
  ?status=pending|confirmed|ignored
```

**Dentro de uma única transação SQL**, o `/confirm` (corrigido na v4 — ver
histórico no topo):

1. **Lock sem mudar status** (corrige a contradição com a constraint
   apontada pelo Codex): `SELECT * FROM
   psychotherapy_bank_statement_transactions WHERE id=$1 AND tenant_id=$2
   AND status='pending' FOR UPDATE`. Se retornar 0 linhas → `ROLLBACK`,
   `409` (já confirmada/ignorada, inclusive por uma requisição concorrente
   que ganhou a corrida). A linha fica **travada e ainda `pending`** durante
   todo o resto da transação — só muda pra `'confirmed'` no passo final
   (passo 7), já com todos os campos exigidos pela constraint preenchidos
   na mesma `UPDATE`, satisfazendo `bank_stmt_tx_state_integrity` sem
   estado intermediário inválido.
2. **Revalida o paciente**: `patientId` do body precisa ser
   `individual_therapy_enabled=TRUE AND status != 'inactive' AND
   deleted_at IS NULL` no momento do commit — se não, `ROLLBACK`, `422`.
3. **Gate de Pix, corrigido para fechar o TOCTOU real (2 iterações — ver
   histórico)**: a 1ª tentativa desta v4 usava `paid_at BETWEEN
   (posted_at - 3d) AND (posted_at + 3d)` como filtro de data — **bug real
   encontrado pelo Codex**: `paid_at` é `NULL` em cobranças `pending`
   (só é preenchido pelo webhook ao confirmar), então o `BETWEEN` nunca
   inclui candidatos pendentes, deixando exatamente o caso que devia
   bloquear (Pix ainda não confirmado, prestes a ser confirmado pelo
   webhook) fora do lock. Corrigido:

   ```sql
   SELECT * FROM psychotherapy_pix_charges
   WHERE tenant_id = $1
     AND patient_id = $2
     AND amount_cents = $3
     AND status IN ('pending', 'paid')
     AND (
       status = 'pending'
       OR paid_at BETWEEN $4::timestamptz - INTERVAL '3 days'
                      AND $4::timestamptz + INTERVAL '3 days'
     )
   FOR UPDATE
   ```
   (`$4` = `transaction.posted_at`). Candidatos `pending` **sempre**
   entram no lock, independentemente de data (não têm `paid_at` pra
   filtrar, e um Pix pendente por natureza ainda pode ser pago a qualquer
   momento pelo webhook). Candidatos `paid` continuam filtrados pela janela
   de ±3 dias. Isso toma o lock antes de decidir — se o webhook Pix
   (`PixController.ts:72`, `UPDATE ... WHERE status='pending'`) estiver
   numa transação concorrente tentando travar a mesma linha, uma espera a
   outra (serializado pelo Postgres). Depois de obter o lock: **se existir
   qualquer candidato** (pending ou já paid), `ROLLBACK`, `409`, mensagem
   "existe cobrança Pix relacionada a este paciente/valor — resolva pelo
   fluxo Pix antes de confirmar aqui". Não tenta adivinhar se o Pix vai ser
   pago ou não — qualquer ambiguidade bloqueia, sem exceção.
4. **Checa cutover, com o tipo corrigido** (achado do Codex: `month
   CHAR(7)` não pode comparar direto com `cutover_at TIMESTAMPTZ`): calcula
   `monthStart = (month || '-01')::date` — mesma semântica exata já usada
   em `syncMonthlyRecord` — e compara `monthStart >= cutover_at::date`.
   `SELECT cutover_at FROM tenant_financial_cutovers WHERE tenant_id=$1 AND
   status='approved'`; se `monthStart >= cutover_at::date`, `ROLLBACK`,
   `409` com mensagem explícita. **Aceito como risco não resolvido**: uma
   aprovação de cutover concorrente exatamente durante esta transação (via
   `ApproveTenantCutoverUseCase`) não está bloqueada por lock cruzado — é
   uma ação administrativa rara e deliberada (não um webhook automático de
   alta frequência como o Pix), então o risco de colisão é aceito para v1
   em vez de coordenar lock entre os dois fluxos.
5. Busca/cria (se necessário) o `psychotherapy_monthly_record` de
   `patientId`+`month`.
6. **Deriva `sessions` estritamente da transação**, nunca do payload:
   - `per_session`: `sessions = transaction.amount_cents /
     record.session_price_cents`, exige divisão exata — se não for exata,
     `ROLLBACK`, `422` ("valor não-redondo, confirme manualmente pelo
     Faturamento Mensal").
   - `monthly`: exige `transaction.amount_cents ==
     record.expected_amount_cents`, senão mesmo erro 422.
7. Chama o helper atômico `incrementPaidSessions` (seção "Unificação") com
   o `sessions` derivado no passo 6, via `RETURNING paid_sessions,
   payment_status, applied_sessions` (ver nota abaixo sobre
   `applied_sessions`) — e, na mesma transação, faz o `UPDATE` final na
   linha travada no passo 1: `SET status='confirmed', confirmed_patient_id=...,
   confirmed_sessions=..., confirmed_month=..., confirmed_at=NOW(),
   confirmed_by=$tenantId WHERE id=$1 AND tenant_id=$2 AND status='pending'`
   (o `WHERE status='pending'` aqui é redundante com o lock do passo 1, mas
   correto — o padrão idiomático de dupla checagem não custa nada e deixa
   claro que a transição só é válida a partir de `pending`).
8. `COMMIT`. Qualquer falha em 2-7 desfaz tudo, inclusive o lock do passo 1
   (a linha volta a ficar livre e `pending`).

**Nota sobre `applied_sessions` no helper `incrementPaidSessions`**: o
`UPDATE` atômico deve retornar não só o `paid_sessions` final, mas também
quantas sessões foram de fato aplicadas depois do clamp
(`applied_sessions = paid_sessions_novo - paid_sessions_antigo`), via um
`UPDATE ... RETURNING` combinado com o valor anterior (ex.: CTE
`old AS (SELECT paid_sessions FROM ... FOR UPDATE), upd AS (UPDATE ...
RETURNING ...) SELECT upd.paid_sessions, upd.payment_status,
upd.paid_sessions - old.paid_sessions AS applied_sessions FROM upd, old`).
Isso corrige um problema apontado pelo Codex em `PaymentReceiptHandler`: hoje
ele monta a mensagem de resposta ("1 sessão registrada") a partir do
`sessionsToAdd` calculado *antes* do UPDATE, que pode divergir do que
realmente foi aplicado depois do clamp se houve concorrência. Com
`applied_sessions` vindo do próprio `UPDATE`, a mensagem sempre reflete o
que foi gravado de verdade.

`confirm-batch` chama esse mesmo caminho item a item (não é uma transação
gigante única) — uma falha isolada não derruba as outras, retorna resumo
`{ sucesso: N, falhou: [{id, motivo}] }`.

### 6. Reimportação / idempotência

`UNIQUE (tenant_id, fitid)` com `ON CONFLICT DO NOTHING` — simplificado na
v7 agora que o FITID é um identificador real do banco, confirmado estável
e único (ver seção 2). Reimportar um extrato com sobreposição de período
não duplica transação já vista. `duplicate_fitid_count` (import) reporta
quantas linhas bateram em FITID já existente de um import anterior,
separado de `skipped_line_count` (erro de parse) — nunca um "N puladas"
genérico que esconda a diferença entre os dois casos.

### 7. Tela de conciliação (frontend)

Igual à v2 (upload → lista agrupada por status → linha com
data/valor/descrição/paciente sugerido editável/mês editável/botão
Confirmar/Ignorar — **sem campo de "sessões" editável agora, já que o
servidor deriva**), com:
- Aviso visual quando `possible_pix_duplicate=true`.
- "Confirmar todas de alta confiança": resumo (1º clique) → confirma (2º
  clique), reporta resultado por item.
- Se o servidor rejeitar por cutover/valor não-redondo/paciente
  inválido/duplicata Pix, a UI mostra o motivo específico por linha (não um
  erro genérico).

### 8. Retenção e sensibilidade de dado bancário de terceiros

Mantido da v2: sem persistir arquivo bruto, `raw_description` nunca logado,
sem expurgo automático em v1 (decisão consciente).

## Riscos e assunções (atualizado 2026-07-10, v7)

**Resolvidos/confirmados nesta sessão:**
1. ~~Formato exato do CSV/OFX do Nubank~~ — **confirmado com extrato real
   (96 transações, conta pessoal do mesmo titular)**: 4 colunas fixas no
   CSV, `STMTTRN` regular no OFX. Usuário confirmou que CSV/OFX também
   estão disponíveis na conta CNPJ, não só na pessoal.
2. ~~Estabilidade do FITID~~ — **confirmado que existe e é estável**: campo
   `Identificador` (CSV) = `<FITID>` (OFX), UUID único por transação,
   idêntico entre os dois formatos pra mesma transação. Dedupe simplificado
   de volta pra `UNIQUE (tenant_id, fitid)`.
3. ~~Extração de nome do pagador — heurística~~ — **nome vem completo e
   estruturalmente presente** em ambos os padrões de descrição observados,
   com 96 exemplos reais confirmando a taxonomia. CPF mascarado ou CNPJ
   completo, dependendo do tipo de pagador.

**Ainda não validados:**
4. `pg_trgm` habilitado no Neon do projeto — não confirmado.
5. Volume real de transações "ruído" na conta CNPJ dedicada — não medido
   diretamente (a amostra real analisada foi de uma conta pessoal, com bem
   mais ruído do que a CNPJ dedicada deve ter — RDB, boletos pessoais,
   compras no débito — coberto pelo fluxo de Ignorar independente do
   volume, e serviu de teste de robustez do parser contra ruído).
6. Formato de export CSV/OFX ainda não confirmado especificamente pra
   conta CNPJ (só pra conta pessoal do mesmo titular) — usuário confirmou
   que consegue exportar se necessário; esperado ser idêntico (mesmo motor
   de geração de extrato do Nubank), mas não formalmente testado ainda.

## Fora de escopo (v1)

- Grupos terapêuticos (exclusão técnica deliberada).
- Integração automática via Open Finance (Pluggy/Belvo).
- Pagamento em valor não-redondo/parcial.
- Conectar `financial_payments` ao fluxo individual.
- Múltiplas contas bancárias por tenant.
- Expurgo/retenção automática de dado sensível.
- Refactor completo de `saveMonthlyRecord`/edição manual pra usar o mesmo
  helper atômico (só os dois caminhos *automáticos* — bank reconciliation e
  WhatsApp receipt — são unificados nesta v1).

## Passos de implementação (ordem sugerida, atualizado na v7)

1. ~~Bloqueante: validar formato real do export Nubank~~ — **feito**:
   formato final é CSV (primário) ou OFX (alternativo), validado com 96
   transações reais. Opcional: pedir 1 export CSV/OFX real da própria
   conta CNPJ (não só da pessoal) antes de ir pra produção, já que só a
   pessoal foi formalmente testada.
2. Confirmar `pg_trgm` disponível no Neon (ou decidir fallback).
3. Extrair/testar o helper `incrementPaidSessions` isoladamente + refatorar
   `PaymentReceiptHandler.applyPayment` pra usá-lo (co-requisito, feito
   antes ou junto do endpoint novo).
4. Migrations `090`+`091` em branch Neon descartável — testar a constraint
   `bank_stmt_tx_state_integrity` tentando inserir estado inválido.
5. Backend: parser CSV (`csv-parse`), endpoint de upload, motor de
   matching, endpoint atômico de confirmação (com os 4 gates: paciente
   válido, Pix duplicado, cutover, valor exato), ignore, lote.
6. Frontend: tela de conciliação.
7. Teste end-to-end com extrato real (paciente sintético numa branch Neon
   antes de rodar contra dado real).
8. `tsc -b`/build completo, deploy, verificar hash de bundle.
9. ~~Nova rodada de auditoria Codex focada na seção 2 (parsing CSV/OFX)~~ —
   **feito em 2026-07-11: aprovado com ressalvas**, todas endereçadas no
   próprio texto das seções 1-2 (contrato CSV-only na v1, parsing estrito
   de data/valor, encoding, `skipped_line_count` visível, caractere exato
   da máscara de CPF). **Plano completo (v7) liberado pra implementação.**

## Veredito final da v7 (auditoria de ingestão CSV/OFX, Codex CLI, 2026-07-11): **APROVADO COM RESSALVAS**

Achados: (1) contrato ambíguo CSV-vs-OFX — corrigido, v1 só aceita `.csv`,
`.ofx` retorna `415` explícito; (2) parsing precisa ser estrito (nunca
`new Date()`/`parseFloat*100` pra dinheiro — usar parser de data estrito e
conversão de centavos via string); (3) encoding/BOM/CRLF precisam de regra
concreta, não só "tolerar"; (4) `skipped_line_count` precisa aparecer em
destaque na UI, não enterrado; (5) caractere de máscara do CPF é
especificamente `•` (U+2022), confirmado byte a byte no arquivo real — não
aproximação ASCII. **Nenhum achado de severidade crítica/alta** — "não há
falha nova de segurança ou risco de perda financeira comparável aos
problemas das versões anteriores" (Codex CLI). Todas as correções já
aplicadas ao texto das seções 1 e 2 acima.

**Combinado com a lógica financeira já aprovada nas seções 3-8 (v5), o
plano completo está pronto pra implementação** — único item ainda pendente
é o teste do parser contra um extrato real da própria conta CNPJ (só a
conta pessoal foi formalmente validada até agora), recomendado antes de ir
pra produção, não bloqueante pra começar a codar.

## Veredito da v5 (5ª rodada de auditoria Codex, 2026-07-10): **APROVADO**
(lógica financeira das seções 3-8, ainda válida na v7 — só a ingestão/parsing mudou, 2x agora: PDF na v6, revertido pra CSV/OFX na v7)

Os 2 motivos objetivos restantes da v4 (bug no SQL do gate Pix: `paid_at
BETWEEN` excluía candidatos `pending`, que têm `paid_at NULL`) foram
corrigidos e verificados. Codex CLI: "Não encontrei contradição nova
objetiva no trecho revisado." — plano liberado para implementação, seguindo
a ordem de passos da seção "Passos de implementação" (o passo 1, validar
formato real do export Nubank com o usuário, continua bloqueante antes de
escrever qualquer código).

## Mudanças da v4 para a v5 (rastreamento dos achados do Codex, 4ª rodada)

| # | Achado v4 (severidade) | Como foi endereçado na v5 |
|---|---|---|
| 1 | Objetivo: SQL do gate Pix usava `paid_at BETWEEN posted_at±3d`, que exclui candidatos `pending` (`paid_at IS NULL` nesses casos) — TOCTOU real permanecia | Condição de data separada por status: `status='pending' OR (status='paid' AND paid_at BETWEEN ...)` — candidatos pendentes sempre entram no `FOR UPDATE`, independente de data |

## Mudanças da v3 para a v4 (rastreamento dos achados do Codex, 3ª rodada)

| # | Achado v3 (severidade) | Como foi endereçado na v4 |
|---|---|---|
| 1 | Objetivo: claim `status='confirmed'` no passo 1 contradiz a própria constraint de integridade (campos exigidos ainda não calculados nesse ponto) | Passo 1 vira `SELECT ... FOR UPDATE WHERE status='pending'` (trava sem mudar status); transição pra `'confirmed'` só acontece no passo final, já com todos os campos exigidos preenchidos na mesma `UPDATE` |
| 2 | Objetivo: gate Pix só checava `status='paid'`, sem lock — TOCTOU real com o webhook em `READ COMMITTED` | Gate reescrito: busca candidatos Pix em qualquer status (`pending` ou `paid`) com `FOR UPDATE`, serializando contra o webhook; qualquer candidato encontrado (não só `paid`) bloqueia o confirm, sem tentar adivinhar o resultado da corrida |
| 3 | Menor: `month CHAR(7)` comparado direto com `cutover_at TIMESTAMPTZ` sem cast | Corrigido para `(month \|\| '-01')::date >= cutover_at::date`, mesma semântica de `syncMonthlyRecord` |
| 4 | Observação: aprovação de cutover concorrente não tem lock cruzado com o confirm | Documentado como risco aceito para v1 (ação administrativa rara, não um webhook de alta frequência) — não implementado, mas explícito, não omisso |
| 5 | Observação: `PaymentReceiptHandler` pode reportar "N sessões registradas" divergente do que o clamp realmente aplicou | Helper `incrementPaidSessions` passa a retornar `applied_sessions` calculado a partir do próprio `UPDATE` (via CTE), handler usa esse valor na mensagem, não o `sessionsToAdd` pré-calculado |
| 6 | Menor (não bloqueante): falta índice composto/parcial pra busca de duplicata Pix | Adicionado à seção 3 como índice adicional na migration 091 |

## Mudanças da v2 para a v3 (rastreamento dos achados do Codex, 2ª rodada)

| # | Achado v2 (severidade) | Como foi endereçado na v3 |
|---|---|---|
| 1 | Crítico: `PaymentReceiptHandler` escreve `paid_sessions` fora do lock novo | Helper `incrementPaidSessions` (UPDATE atômico de linha única) usado pelos dois caminhos automáticos; `PaymentReceiptHandler.applyPayment` refatorado como co-requisito |
| 2 | Crítico: TOCTOU com Pix não fechado | Checagem de duplicata Pix repetida **dentro** da transação de confirmação, não só no import |
| 3 | Crítico: conflito com sistema de cutover financeiro | Gate explícito no confirm consultando `tenant_financial_cutovers`, recusa com 409 se pós-cutover; confirmado que a tabela está vazia hoje em produção, mas o gate é permanente |
| 4 | Alto: servidor não recalculava `sessions` a partir da transação | Campo `sessions` removido do payload do cliente; servidor deriva estritamente de `amount_cents`/`session_price_cents`/`expected_amount_cents`, rejeita com 422 se não for exato |
| 5 | Alto: exclusão de grupo/inativo não imposta ponta a ponta | Filtro `status != 'inactive'` explícito no motor de matching (não presumido do repositório) E revalidado de novo no confirm |
| 6 | Médio: FK de `confirmed_by` incorreta (`tenants(id,id)`) | Corrigida para FK simples `confirmed_by REFERENCES tenants(id)` + `CHECK (confirmed_by = tenant_id)`, igual ao padrão de `financial_payments.created_by` |
| 7 | Médio: `ON DELETE SET NULL` em FK composta arriscado | Trocado para `ON DELETE RESTRICT` em ambas (`suggested_patient_id`, `confirmed_patient_id`), igual ao padrão de `financial_payments.patient_id` |
| 8 | Baixo/médio: constraint de `ignored` incompleta, sem auditoria de quem/quando ignorou | Adicionadas colunas `ignored_at`/`ignored_by`, constraint reescrita cobrindo as 3 combinações de estado por completo |

## Implementação (2026-07-11)

Implementado nesta sessão, seguindo a ordem de passos já definida acima.

**Migrations aplicadas em produção** (`npm run migrate`, Neon
`weathered-sunset-87453623`): `090_bank_statement_imports.sql`,
`091_idx_bank_stmt_tx_tenant_status_concurrently.sql`,
`092_idx_pix_charges_patient_amount_active_concurrently.sql`. **Correção
descoberta lendo o runner real** (`src/runMigrations.ts`): o parser de
índice `CONCURRENTLY` só reconhece 1 nome de índice por arquivo
não-transacional — por isso o índice de `psychotherapy_pix_charges` virou
migration `092` separada, não combinada com `091` como o desenho original
sugeria. `pg_trgm` e `unaccent` confirmados disponíveis no Neon e usados no
motor de matching (`unaccent` não estava no plano original — achado nesta
sessão, melhora a precisão do match de nome com acento).

**Backend**:
- `infrastructure/db/incrementPaidSessions.ts` — helper atômico
  compartilhado entre o endpoint novo e `PaymentReceiptHandler` (refatorado
  para usá-lo, eliminando a race documentada).
- `infrastructure/parsers/nubankCsvParser.ts` — parser CSV estrito,
  validado contra o extrato real de 96 transações (50 créditos extraídos,
  0 erros, valores em centavos exatos).
- `application/useCases/ImportBankStatementUseCase.ts` — parsing + motor de
  matching (nome via `pg_trgm`+`unaccent` com guard de ambiguidade, valor
  contra o registro mensal do mês sugerido, checagem de duplicata Pix,
  fallback só-por-valor) + persistência com dedupe por FITID.
- `application/useCases/ConfirmBankStatementTransactionUseCase.ts` — os 4
  gates dentro de 1 transação SQL, exatamente como desenhado e auditado.
- `application/useCases/IgnoreBankStatementTransactionUseCase.ts`.
- `presentation/controllers/BankStatementController.ts` + rotas em
  `psychotherapyRoutes.ts` (`import`, `imports/latest`, `imports/:id/transactions`,
  `transactions/:id/confirm`, `transactions/:id/ignore`, `transactions/confirm-batch`).
  **Endpoint `imports/latest` não estava no desenho original** — adicionado
  ao testar o frontend: sem ele, um refresh de página perdia acesso à lista
  pendente de revisão (gap de UX real, não cosmético).
- Dependências novas: `multer`, `csv-parse`, `@types/multer`.

**Frontend**: `pages/BankReconciliation.tsx` + `.css`, rota
`/bank-reconciliation`, item de menu "Conciliação Bancária" no `Layout.tsx`.
**Correção em `services/api.ts`**: `fetchApi` forçava `Content-Type:
application/json` incondicionalmente, o que quebraria upload multipart —
corrigido para pular esse header quando `options.body instanceof FormData`
(mudança retrocompatível, nenhum outro caller usa `FormData` hoje).

**Testado de ponta a ponta numa branch Neon descartável** (`br-sparkling-shadow-afanylls`,
apagada ao final) com pacientes sintéticos, backend local apontando pra
ela (nunca produção): import real do CSV (50/50 transações, 0 erros) →
motor de matching (`high`/`medium`/`none` corretos, incluindo um caso real
de ambiguidade genuína — 2 pacientes distintos com o mesmo nome completo,
corretamente recusado) → confirmação atômica (sessões incrementadas,
`payment_status` recalculado certo) → rejeição de dupla confirmação (409)
→ `ignore` → `confirm-batch` → **gate de duplicata Pix rejeitando dentro da
transação (409), sem nenhum efeito colateral gravado** (a parte mais
auditada do plano, validada na prática). Build real (`tsc -b`/`tsc` +
`vite build`) passou limpo nos dois apps. Frontend verificado no browser
(`/imports/latest` contra produção real, retorna vazio corretamente, sem
erro).

**Não feito nesta sessão** (fora do escopo do "implementar", não bloqueante):
commit/push/deploy do código; teste do parser contra um extrato real da
própria conta CNPJ (só a pessoal foi usada, formato esperado idêntico mas
não formalmente confirmado); parser OFX (documentado como fora de escopo
da v1); testes automatizados (unitários/integração) do parser e dos use
cases novos.
