# Ingestão Automática de Extrato Bancário via E-mail — Plano v8 — **aprovado com ressalvas (8ª rodada), pronto pra implementação**

> **Histórico resumido**: v1 reprovada (6 achados). v2 aprovada com
> ressalva menor (reclaim precisava ser atômico — corrigido). v3: usuário
> confirmou formato do anexo (CSV entre 3), aprovada, mas uma 4ª rodada de
> **releitura completa e independente** (não só verificando achados
> anteriores) encontrou **6 achados novos reais** que as rodadas
> incrementais anteriores não pegaram — reprovando de novo:
>
> 1. **Alto**: fluxo de `state` do OAuth do Gmail ia repetir um padrão
>    inseguro que já existe (sem saber) no Calendar hoje —
>    `GoogleAuthController.ts` confia no `state` da URL como tenantId sem
>    validação (CSRF de OAuth). **Achado sobre código pré-existente,
>    sinalizado como tarefa própria separada, fora deste plano** — mas
>    esta feature nova não podia copiar o mesmo padrão. Corrigido: `state`
>    aleatório real, tabela dedicada `gmail_oauth_states`.
> 2. **Alto, e uma correção de informação errada**: a v2 tinha dito que os
>    tokens do Calendar ficam em texto puro — **isso estava errado**,
>    eles já são cifrados via `cryptoHelper.ts` (`encrypt()`/`decrypt()`,
>    AES-256-GCM) antes de gravar. Corrigido: reaproveitar essa mesma
>    função pro Gmail, em vez de inventar cifra nova.
> 3. **Alto**: schema com `FK ... ON DELETE SET NULL` numa coluna composta
>    com `tenant_id NOT NULL` — **mesmo bug já corrigido antes no próprio
>    plano de conciliação bancária (v3→v4)**, reintroduzido aqui por
>    descuido. Corrigido pra `RESTRICT`, mesmo padrão já estabelecido.
> 4. **Médio/alto**: claim/reclaim atômicos individualmente corretos, mas
>    o processo ponta a ponta (import + marcar e-mail como processado) não
>    era idempotente — um crash no meio podia gerar um 2º import órfão pro
>    mesmo e-mail num retry. Corrigido na 4ª rodada com checagem de
>    `import_id` já preenchido — **correção insuficiente, ver achado #1 da
>    5ª rodada abaixo**.
> 5. **Médio**: reclaim reaproveitava `created_at` como timestamp de lease
>    — corrigido pra coluna `claimed_at` dedicada.
> 6. **Médio**: regra de anexo precisava de mais precisão (case-insensitive,
>    limite de tamanho, CSV que passa a detecção mas falha o parse não é
>    sucesso silencioso) — detalhado.
>
> Todos os 6 corrigidos, mas uma **5ª rodada** (também releitura crítica,
> não só checagem dos achados anteriores) reprovou de novo com **5 novos
> achados**, sendo o #1 uma correção real sobre uma correção da 4ª rodada
> que não fechava a janela de verdade:
>
> 1. **Alto**: a correção do achado #4 da 4ª rodada (checar
>    `email_imports.import_id IS NOT NULL`) não fechava a janela — a
>    escrita desse campo acontecia **depois** do `execute()` retornar, em
>    passo separado; um crash exatamente entre as duas escritas ainda
>    gerava reprocessamento. **Corrigido de verdade**: nova coluna
>    `source_gmail_message_id` gravada atomicamente dentro do próprio
>    `INSERT` que cria a linha em `psychotherapy_bank_statement_imports`
>    (dentro da transação já existente do `ImportBankStatementUseCase`),
>    virando a fonte da verdade de "e-mail já importado" em vez de uma
>    segunda tabela escrita em passo posterior.
> 2. **Médio/alto**: o reclaim estava descrito na seção de dedupe mas não
>    integrado ao fluxo real do job (que só descrevia tratar mensagens
>    novas). Corrigido: job de polling reescrito para processar
>    explicitamente 2 filas (novas + reclaim) alimentando o mesmo loop de
>    tratamento de 6 passos.
> 3. **Baixo**: FK composta `(import_id, tenant_id)` depende de
>    `UNIQUE(id, tenant_id)` na tabela referenciada — confirmado que já
>    existe (`090_bank_statement_imports.sql`), só precisava estar
>    explícito no texto.
> 4. **Médio**: sobrava texto antigo contraditório dizendo que os tokens
>    do Calendar ficam em texto puro, conflitando com a correção do achado
>    #2 da 4ª rodada — corrigido (parágrafo do Histórico anotado).
> 5. **Médio**: semântica de `status='no_attachment'` vs. `status='error'`
>    pra zero anexos `.csv` estava descrita de forma inconsistente em dois
>    trechos — padronizada: `no_attachment` só pra zero `.csv`; `error`
>    pra mais de um `.csv` ou anexo fora da allowlist.
>
> Todos os 5 corrigidos, mas uma **6ª rodada** (também releitura crítica e
> independente, incluindo checagem direta do código real do repositório,
> não só do texto do plano) reprovou de novo com **2 achados novos reais**:
>
> 1. **Alto**: a premissa "gravado dentro da transação interna do
>    `ImportBankStatementUseCase`" era **falsa** — conferido no código
>    real, `execute()` hoje não é transacional (`INSERT`s/`UPDATE` soltos
>    via `dbPool.query()`, sem `BEGIN`/`COMMIT`). Um crash entre o `INSERT`
>    do import e os `INSERT`s das transações deixaria um import parcial
>    que o retry trataria como concluído com sucesso. **Corrigido**:
>    `execute()` precisa ser reescrito pra ser genuinamente transacional
>    (`pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`, mesmo padrão já usado
>    em `ConfirmBankStatementTransactionUseCase`) como pré-requisito de
>    implementação, não só de schema.
> 2. **Médio/alto**: claim/reclaim atômicos, mas sem ownership no restante
>    do fluxo — um worker "zumbi" (que passou do timeout de 30min) podia
>    continuar escrevendo depois de outro fazer reclaim da mesma mensagem;
>    e uma colisão de dois workers no `UNIQUE(tenant_id,
>    source_gmail_message_id)` não tinha tratamento explícito. **Corrigido**:
>    nova coluna `claim_token` (regenerada a cada claim/reclaim), todo
>    update terminal condicionado a esse token; violação de unique
>    (`23505`) tratada como caminho esperado de idempotência.
>
> Ambos corrigidos, mas uma **7ª rodada** (releitura crítica, incluindo
> checagem do runner de migrations real) reprovou de novo com **3 achados
> novos**, todos de severidade média — mostrando que a correção do
> `claim_token` da 6ª rodada só cobria parte dos casos:
>
> 1. **Médio/alto**: `claim_token` só estava condicionado nos updates de
>    rejeição e sucesso, não em `no_attachment`/`error` — deixando esses 2
>    casos vulneráveis ao mesmo problema de worker "zumbi" sobrescrever o
>    estado de um worker novo. **Corrigido**: regra única — toda escrita de
>    `status` (sucesso, rejeição, `no_attachment`, `error`, sem exceção)
>    passa pelo mesmo `UPDATE ... WHERE id=$1 AND status='processing' AND
>    claim_token=$2`.
> 2. **Médio**: a migration de `source_gmail_message_id` + `CREATE INDEX
>    CONCURRENTLY` estava num único bloco, mas o runner real do projeto
>    envolve cada arquivo em transação por padrão — `CONCURRENTLY` não roda
>    em transação. **Corrigido**: 3 migrations separadas (mesmo padrão já
>    usado no plano de conciliação v1).
> 3. **Médio/baixo**: o tratamento de `23505` não deixava explícito que o
>    Postgres aborta a transação inteira na violação, exigindo `ROLLBACK`
>    antes de qualquer outra query no mesmo client. **Corrigido**:
>    sequência explícita (checar constraint específico → `ROLLBACK` →
>    `SELECT` do id existente → `client.release()`).
>
> (Observação adicional, não-bloqueante: a tela de e-mails rejeitados
> prometia mostrar o remetente sem o schema ter coluna pra isso —
> corrigido com `sender_normalized`.)
>
> Todos corrigidos, e a **8ª rodada** aprovou com ressalvas — **sem achado
> alto, sem falha de segurança ou perda de dados** — só 3 esclarecimentos
> de baixa/média severidade, todos aplicados:
>
> 1. **Baixo/médio**: nomes/ordem das 3 migrations não estavam explícitos
>    (o runner aplica em ordem alfabética via `.sort()`) — corrigido com
>    nomes sequenciais explícitos (`093`/`094`/`095`).
> 2. **Baixo/médio**: fluxo de refresh token do Gmail não estava detalhado
>    — o polling roda sem interação do usuário, então precisa de
>    `access_type: 'offline'` + `prompt: 'consent'` na autorização,
>    rejeitar se `refresh_token` não vier, e renovar/persistir o access
>    token expirado antes de cada ciclo do job — corrigido.
> 3. **Baixo**: `sender_normalized` não estava incluído no `UPDATE`
>    terminal genérico do `claim_token` — corrigido, mesmo `UPDATE`, sem
>    escrita separada.
>
> **Plano aprovado, pronto pra implementação** (v8). 8 rodadas de
> auditoria Codex CLI ao todo neste documento.

> **Histórico**: v1 auditada pelo Codex CLI e **reprovada** (2026-07-11) —
> 6 achados (3 altos, 3 médios): verificação SPF/DKIM subespecificada e
> potencialmente falsificável; armazenamento de token OAuth do Gmail sem
> exigir criptografia **(achado da v1/v2 continha uma leitura errada do
> código — corrigido na v4, ver histórico acima: os tokens já são
> cifrados via `cryptoHelper.ts`; o requisito real era reaproveitar essa
> cifra existente, não inventar uma nova)**; contradição entre "mesmo
> pipeline já aprovado" e a hipótese de PDF (pipeline atual é CSV-only,
> PDF exigiria reabrir os riscos da v6 do plano de conciliação); schema de
> dedupe
> incompleto (sem claim atômico contra concorrência, sem FK composta);
> `to:` sozinho não é camada de segurança forte (header controlável pelo
> remetente); lacunas de privacidade específicas de e-mail de terceiro
> (spam/phishing também chegam no alias). Esta v2 endereça todos os 6.

## Contexto e objetivo

Fase 2 da feature de conciliação bancária (v1 — upload manual de CSV — já
está em produção, ver `docs/bank-statement-reconciliation-plan.md`).
Objetivo: o Nubank envia automaticamente (recorrência configurada pelo
próprio usuário no app do banco) um e-mail com o extrato pra
`rodrigosonsino+nubank@gmail.com` (alias já configurado no Nubank, ver
[[project_status]]); o PsicoApp lê essa caixa periodicamente, encontra o
e-mail, extrai o anexo, e roda o **mesmo pipeline já existente e aprovado**
(`ImportBankStatementUseCase`) — parando exatamente onde já para hoje: a
terapeuta confirma manualmente cada sugestão. **Nada muda na gravação** —
só a origem do arquivo deixa de ser upload manual e passa a ser automática.

## Formato do anexo — resolvido (v3): CSV entre 3 anexos

**Confirmado pelo usuário (2026-07-11)**: o e-mail automático do Nubank
chega com os 3 formatos anexados (CSV, OFX, PDF) — mesmos 3 que já foram
baixados manualmente e usados pra validar a v1 da conciliação. Isso resolve
o que era o pré-requisito bloqueante deste plano (a v1 chegou a mudar de
arquitetura 2x, PDF → CSV/OFX, por causa de suposição de formato não
validada — aqui não precisa repetir esse ciclo, o formato já é conhecido).

**Decisão de parsing**: o job de e-mail identifica o anexo cujo nome/
`Content-Type` indica CSV (ex. `filename.endsWith('.csv')` ou
`Content-Type: text/csv`) entre os 3 anexados, **ignora OFX e PDF**, e
passa o buffer do CSV pro `parseNubankCsv()`/`ImportBankStatementUseCase`
já existentes — nenhuma mudança nesses dois. Se por algum motivo o anexo
CSV não estiver presente numa mensagem específica (ex. Nubank muda o
comportamento), a mensagem cai em `status='no_attachment'` (schema já
previsto abaixo) — nunca tenta parsear PDF/OFX como fallback silencioso.

**Ainda recomendado, não bloqueante**: validar contra 1 e-mail real assim
que o primeiro chegar — confirmar nome exato do arquivo CSV anexado (pra
calibrar a detecção por nome/extensão), remetente real (pro filtro de
segurança da seção seguinte) e assunto. Isso pode acontecer em paralelo
com o início da implementação, não precisa mais ser um passo prévio
sequencial.

**Correção da v2 (achado #3 da auditoria), agora resolvida na v3**: a v1
dizia "roda o mesmo pipeline já existente e aprovado" como se fosse
verdade incondicionalmente — não era, `ImportBankStatementUseCase` é
CSV-only. A v2 deixou a decisão de caminho em aberto (CSV = trivial, PDF =
projeto do tamanho da v6 descartada). **Com a confirmação da v3 de que o
CSV está entre os 3 anexos**, a frase volta a ser literalmente verdadeira:
só muda a origem do buffer (upload HTTP → anexo de e-mail extraído), o
resto do código (`parseNubankCsv`, motor de matching, gates de
confirmação) não muda nada. O caminho "se vier PDF" fica documentado como
não aplicável a esta integração — OFX e PDF do e-mail são simplesmente
ignorados, não processados.

## Decisão de arquitetura: Gmail API, conexão OAuth dedicada (não reaproveitar a do Calendar)

O app já tem integração OAuth com Google (`GoogleCalendarService`,
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, escopo hoje só
`https://www.googleapis.com/auth/calendar`). Dois caminhos possíveis:

- **A) Ampliar o escopo da conexão existente** pra incluir Gmail — mais
  simples de implementar (reusa toda a infra de token), mas aumenta o
  raio de exposição do token único: se ele vazar, carrega acesso a
  Calendar **e** e-mail juntos.
- **B) Conexão OAuth separada, dedicada só a isso**, com o escopo mais
  restrito possível — **escolhido**. Mesmo cliente OAuth (`GOOGLE_CLIENT_ID`
  do projeto), mas fluxo de autorização e armazenamento de token
  independentes do Calendar. Se o token de e-mail vazar, não carrega
  acesso ao Calendar; se o de Calendar vazar, não carrega acesso a e-mail.

**Escopo OAuth**: `https://www.googleapis.com/auth/gmail.readonly` (só
leitura — a app nunca precisa escrever/apagar e-mail). **Limitação real,
documentada explicitamente**: o Gmail API **não tem** um escopo OAuth
"restrito a um remetente/rótulo específico" — `gmail.readonly` concede
leitura da caixa inteira. A restrição por remetente/alias (seção seguinte)
é feita **na query de busca da aplicação**, não no nível do OAuth — é
defesa em profundidade, não uma garantia técnica dura. Isso precisa ficar
claro pro usuário no momento do consentimento (Google já mostra esse aviso
na tela de permissão, mas vale reforçar na UI do app).

**Correção da v4 (achado #2 da 4ª rodada de auditoria) — a v2/v3 tinham uma
informação errada sobre o estado real do código**: a v2 afirmava que
`google_oauth_tokens` guarda `access_token`/`refresh_token` em `TEXT` puro,
sem criptografia — **isso está errado**, verificado lendo
`PostgresPsychotherapyRepository.saveGoogleOAuthTokens` (linha ~2155): os
tokens **já passam por `encrypt()`** (`infrastructure/auth/cryptoHelper.ts`,
AES-256-GCM com chave derivada de `MASTER_ENCRYPTION_KEY`) antes de gravar
— a coluna é `TEXT` porque guarda o payload cifrado empacotado
(`gcm:v1:iv:tag:ciphertext`), não o token em claro. **Correção de rumo**:
em vez de inventar um novo esquema de cifra pro Gmail, **reaproveitar o
mesmo `cryptoHelper.ts` já existente** (`encrypt()`/`decrypt()`) — é
infra testada, com suporte a rotação de chave versionada
(`gcm:v1:...`), e mantém consistência com o resto do projeto.

**Schema completo de `gmail_oauth_tokens`** (não estava escrito antes, só
descrito em prosa — achado real da 4ª rodada):

```sql
CREATE TABLE gmail_oauth_tokens (
  tenant_id            UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  encrypted_access_token  TEXT NOT NULL,  -- via cryptoHelper.encrypt()
  encrypted_refresh_token TEXT NOT NULL,  -- via cryptoHelper.encrypt()
  expiry_date           BIGINT NOT NULL,
  email_address         VARCHAR(255) NOT NULL, -- conta Gmail conectada (exibida na UI)
  connected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Requisitos operacionais, mantidos da v2/v3:
- Tabela **separada** de `google_oauth_tokens` (reforça o isolamento já
  decidido — vazar um não carrega o outro), mas **reaproveitando** a
  mesma função de cifra, não uma nova.
- **Fluxo de desconexão explícito** (botão "Desconectar e-mail" na tela de
  perfil) que revoga o token junto ao Google (`oauth2Client.revokeToken()`)
  e apaga a linha — não só marca como inativo.
- Aviso explícito na UI, no momento da conexão: "o app terá acesso técnico
  de leitura à sua caixa de e-mail inteira (Gmail exige esse escopo), mas
  só processa mensagens enviadas para o alias configurado".
- **Ressalva da 8ª rodada de auditoria — requisitos de refresh token
  precisam estar explícitos, não implícitos**: como o job de polling roda
  sem interação do usuário (diferente do Calendar, usado sob demanda), o
  fluxo de autorização precisa garantir um `refresh_token` de verdade, ou
  o polling para de funcionar silenciosamente depois do access token
  expirar. Mesmo padrão já usado no `GoogleCalendarService`: gerar a URL
  de autorização com `access_type: 'offline'` e `prompt: 'consent'`
  (força o Google a emitir `refresh_token` mesmo em reconexão, que senão
  só vem na 1ª autorização); se o callback não receber `refresh_token`
  (usuário já tinha autorizado antes e o Google omitiu), tratar como erro
  explícito e pedir pra desconectar e reconectar do zero, nunca salvar
  token parcial. O job de polling, ao usar um access token expirado,
  deve renová-lo via `refresh_token` e persistir o novo access token
  cifrado de volta em `gmail_oauth_tokens` (`encrypted_access_token`,
  `expiry_date`) antes de prosseguir.

**Correção da v4 (achado #1 da 4ª rodada) — fluxo de `state` do OAuth
precisa ser seguro, não copiar o padrão atual do Calendar**: investigação
nesta rodada encontrou que o callback OAuth do Calendar
(`GoogleAuthController.ts:47`) hoje faz `const { state: tenantId } =
req.query` — **confia direto no parâmetro `state` da URL como sendo o
tenantId, sem validação alguma** (vulnerabilidade CSRF de OAuth
pré-existente, sinalizada separadamente como tarefa própria de correção,
fora do escopo deste plano). A tabela `google_oauth_states` existe no
schema (migration `041_expand_calendar_security.sql`) mas está
desconectada desse fluxo. **Esta feature não pode repetir esse padrão** —
usa `state` aleatório de verdade:

```sql
CREATE TABLE gmail_oauth_states (
  state_hash   CHAR(64) PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

(Tabela dedicada, não reaproveita `google_oauth_states` — mesmo princípio
de isolamento já aplicado a tokens: um state minted pro fluxo de e-mail
não deve ter validade nenhuma se replayado contra o callback do Calendar,
e vice-versa.) Fluxo: `getGmailAuthorizationUrl(tenantId)` gera um token
aleatório de 32 bytes, grava `sha256(token)` + `tenant_id` +
`expires_at=NOW()+10min` nessa tabela, e passa o token (não o tenantId)
como `state` na URL de consentimento. O callback busca por
`sha256(state recebido)`, exige `expires_at > NOW() AND consumed_at IS
NULL`, marca `consumed_at=NOW()` **na mesma operação** (`UPDATE ...
RETURNING tenant_id`, atômico — nunca ler depois escrever em passos
separados), e só então usa o `tenant_id` retornado pra prosseguir. `state`
inválido/expirado/já consumido → erro explícito, nunca assume um tenant.

## Filtro de mensagens — múltiplas camadas, nenhuma sozinha é suficiente

1. **Busca Gmail API restrita**: `to:rodrigosonsino+nubank@gmail.com` — só
   processa e-mails endereçados a esse alias específico, não a caixa toda.
   **Correção da v2 (achado #5 da auditoria)**: o header `To` é escrito
   pelo remetente e não prova entrega real ao alias — é só um pré-filtro de
   ruído, não uma camada de segurança. A validação de segurança de verdade
   é o header adicionado pelo **próprio Gmail no recebimento**
   (`Delivered-To`, quando presente) comparado contra o alias esperado —
   mais confiável que confiar no `To` isolado. Se `Delivered-To` não
   estiver disponível pra essa mensagem, tratar como sinal fraco e depender
   mais pesado das camadas 2 e 3 abaixo.
2. **Verificação de remetente real**: checar o header `From` contra um
   domínio confirmado do Nubank (a confirmar no passo de inspeção real —
   provavelmente algo em `@nubank.com.br` ou domínio de envio
   transacional dedicado, ex. `notificacoes.nubank.com.br`). **Não confiar
   só no nome de exibição** ("Nubank" pode ser falsificado por qualquer
   remetente).
3. **Verificação de autenticação do e-mail (SPF/DKIM/DMARC), especificada
   com precisão** (correção da v2, achado #1 da auditoria — a v1 dizia só
   "checar o header `Authentication-Results`", o que é explorável se
   implementado ingenuamente):
   - **Nunca confiar em qualquer `Authentication-Results` presente na
     mensagem** — esse header pode existir no e-mail original (escrito
     pelo próprio remetente/atacante) antes de chegar ao Gmail. Usar
     **só** o(s) header(s) `Authentication-Results` cujo `authserv-id`
     bate com o servidor do Gmail (`mx.google.com`, confirmar o valor
     exato contra um e-mail real) — **ignorar qualquer outro**.
   - **Exigir alinhamento de domínio, não só "spf=pass" isolado**: SPF
     sozinho autentica o *envelope sender* (`Return-Path`), não
     necessariamente o domínio visível no `From` — um remetente malicioso
     pode ter SPF válido pro **próprio** domínio dele. Exigir
     **`dmarc=pass`** com `header.from=<domínio Nubank confirmado>`, e/ou
     **`dkim=pass`** com `header.d=<mesmo domínio>` alinhado ao `From`.
   - Mensagem que falha essa checagem (ou não tem o header do Gmail
     presente, ou não bate o `authserv-id`, ou passa SPF/DKIM mas de
     domínio não-alinhado) é **rejeitada e reportada**
     (`status='rejected_auth'`, ver seção de dedupe), nunca processada
     silenciosamente.
4. **Assunto reconhecível** (a confirmar com o e-mail real) como sinal
   adicional, não como filtro único.

**Resumo do que essas camadas garantem, sem exagerar**: com `Delivered-To`
+ `From` alinhado + DMARC/DKIM alinhado ao domínio real do Nubank,
verificados a partir do header inserido pelo próprio Gmail (não
confiável pelo remetente), um atacante externo comum não consegue
injetar uma transação falsa fingindo ser o Nubank. Isso não protege contra
um comprometimento real da conta de e-mail do Nubank em si (fora do
controle desta aplicação).

## Deduplicação a nível de e-mail (separada da deduplicação por FITID já existente)

**Correção da v4 (achados #3, #4, #5 da 4ª rodada de auditoria)** — schema
com 3 problemas reais corrigidos: (a) FK `ON DELETE SET NULL` numa coluna
composta com `tenant_id NOT NULL` é inválida (mesmo bug já corrigido antes
no plano de conciliação v3→v4 — repetido aqui por descuido, agora
consistente com o padrão `RESTRICT` de `psychotherapy_bank_statement_imports`);
(b) faltavam colunas operacionais (`claimed_at` dedicado em vez de
reaproveitar `created_at` como timestamp de lease, `attempt_count`); (c) o
processo de import+status não era ponta a ponta idempotente (ver fluxo do
job corrigido abaixo).

```sql
CREATE TABLE psychotherapy_bank_statement_email_imports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  gmail_message_id   VARCHAR(100) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing','processed','rejected_sender',
                                         'rejected_auth','no_attachment','error')),
  import_id          UUID,  -- preenchido assim que o import é criado (ver fluxo idempotente)
  error_detail       TEXT,  -- nunca inclui corpo/assunto do e-mail, só a causa técnica
  sender_normalized  VARCHAR(255),  -- só o endereço From, pra tela de rejeitados (correção 7ª rodada)
  attempt_count      INT NOT NULL DEFAULT 1,
  claim_token        UUID NOT NULL DEFAULT gen_random_uuid(),  -- ownership do worker atual (achado #2 da 6ª rodada)
  claimed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- timestamp de lease, não de criação
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- RESTRICT (não SET NULL) — mesmo padrão já usado em
  -- psychotherapy_bank_statement_transactions, evita o problema de FK
  -- composta com coluna NOT NULL no meio de um SET NULL.
  FOREIGN KEY (import_id, tenant_id)
    REFERENCES psychotherapy_bank_statement_imports (id, tenant_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, gmail_message_id)
);
```

**Claim atômico contra concorrência** (dois disparos do job de polling
podem se sobrepor — ex. um ciclo demorando mais que o intervalo entre
execuções): antes de processar qualquer mensagem, o job faz `INSERT INTO
psychotherapy_bank_statement_email_imports (tenant_id, gmail_message_id,
status) VALUES ($1, $2, 'processing') ON CONFLICT (tenant_id,
gmail_message_id) DO NOTHING RETURNING id, claim_token`. Se não retornar
linha, outro processo já está tratando essa mensagem (ou já tratou) —
pula sem reprocessar. O `claim_token` retornado (gerado pelo `DEFAULT
gen_random_uuid()`) é o token de posse que esse worker guarda em memória
pro resto do processamento dessa mensagem.

**Reclaim atômico de mensagens travadas**, usando `claimed_at` (não
`created_at`, que preserva o momento real de criação da linha) — **correção
do achado #2 da 6ª rodada de auditoria**: o reclaim original só travava a
linha de volta, mas não invalidava a posse do worker anterior (se ele
"acordasse" depois de 30min e tentasse escrever, não havia nada
impedindo). Agora o reclaim **gera um novo `claim_token`**, e todo update
terminal do worker (passo 5 do loop abaixo) só tem efeito se apresentar o
`claim_token` que recebeu no momento do claim/reclaim — um worker "zumbi"
que volta depois de ser reclaimed por outro simplesmente não bate mais o
token e o `UPDATE` afeta 0 linhas, sem sobrescrever o trabalho do novo
dono:

```sql
UPDATE psychotherapy_bank_statement_email_imports
SET status = 'processing', claimed_at = NOW(), claim_token = gen_random_uuid(),
    attempt_count = attempt_count + 1
WHERE tenant_id = $1 AND gmail_message_id = $2
  AND status = 'processing' AND claimed_at < NOW() - INTERVAL '30 minutes'
RETURNING id, import_id, claim_token;
```

Só o worker que efetivamente recebe a linha de volta (com o `claim_token`
novo) segue pro processamento — e é esse `claim_token` novo, não o antigo,
que ele vai usar no update terminal do passo 5.

**Correção real do achado #4 (5ª rodada de auditoria) — a correção da 4ª
rodada não fechava a janela de verdade**: checar `email_imports.import_id
IS NOT NULL` não adianta se a escrita desse campo acontece **depois** do
`execute()` retornar, em uma chamada separada — um crash exatamente entre
as duas escritas (import criado, mas o link em `email_imports` ainda não
gravado) faria o retry ver `import_id IS NULL` de novo e rechamar o use
case, recriando o problema que a correção deveria evitar.

**Fechamento de verdade**: em vez de depender de uma escrita externa
posterior pra "lembrar" que o import já existe, o próprio
`psychotherapy_bank_statement_imports` passa a guardar a correlação com o
e-mail de origem, **escrita atomicamente dentro do mesmo `INSERT` que já
cria a linha**:

**Correção do achado #2 da 7ª rodada de auditoria — a `CONCURRENTLY`
precisa ser um arquivo de migration separado**: o runner real
(`runMigrations.ts`) envolve cada arquivo numa transação por padrão, e só
desliga isso com o marcador `-- migrate:transaction=false` — mas
`CREATE INDEX CONCURRENTLY` não pode rodar dentro de transação (erro do
Postgres), e o próprio projeto já documentou essa regra (ver padrão
existente em `091_idx_bank_stmt_tx_tenant_status_concurrently.sql` do
plano de conciliação v1). Precisam ser **2 migrations**, não 1:

```sql
-- Migration N (transacional, padrão): só a coluna aditiva.
ALTER TABLE psychotherapy_bank_statement_imports
  ADD COLUMN source_gmail_message_id VARCHAR(100);
```

```sql
-- Migration N+1 (arquivo separado, com o marcador de topo
-- "-- migrate:transaction=false", só esse índice, nada mais no arquivo):
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  uq_bank_stmt_imports_gmail_message_id
  ON psychotherapy_bank_statement_imports (tenant_id, source_gmail_message_id)
  WHERE source_gmail_message_id IS NOT NULL;
```

**Achado real #1 da 6ª rodada de auditoria — a premissa "dentro da
transação interna do `ImportBankStatementUseCase`" era falsa**: o Codex
foi conferir o código real (não só o texto do plano) e `execute()` **hoje
não é transacional** — faz o `INSERT` do import, depois um `INSERT` por
transação do CSV, depois um `UPDATE` de `duplicate_fitid_count`, tudo via
`dbPool.query()` direto, sem `BEGIN`/`COMMIT`. Gravar
`source_gmail_message_id` só no primeiro `INSERT` e depender dele como
"fonte da verdade" de conclusão é uma premissa quebrada: um crash entre o
`INSERT` do import e os `INSERT`s das transações deixaria um import
**parcial** (ou até vazio) que o retry trataria como concluído com
sucesso, escondendo a perda de dados em vez de preveni-la — pior que o
problema original.

**Correção real (pré-requisito de implementação, não só de schema)**:
`ImportBankStatementUseCase.execute()` precisa ser reescrito pra abrir uma
transação de verdade — `pool.connect()` → `client.query('BEGIN')` →
`INSERT` do import (já com `source_gmail_message_id`) → todos os
`INSERT`s de transações → `UPDATE` de `duplicate_fitid_count` → `COMMIT`
(com `ROLLBACK`+`client.release()` em qualquer erro no meio) — mesmo
padrão já usado em `ConfirmBankStatementTransactionUseCase` (que já é
transacional, ver plano v1 de conciliação). Só depois dessa mudança a
premissa "gravado atomicamente dentro da transação" passa a ser
verdadeira; sem ela, este passo do plano não deve ser implementado.

**Colisão de `UNIQUE(tenant_id, source_gmail_message_id)` entre dois
workers** (parte do achado #2 da 6ª rodada): mesmo com claim/reclaim
corretos, dois workers podem passar pela checagem `SELECT ... WHERE
source_gmail_message_id=$2` (não encontrar nada) e os dois chamarem
`execute()` em seguida, numa janela de corrida rara mas possível (ex.
claim de um tenant com dois `gmail_message_id` que colidiriam — na
prática mitigado pelo claim atômico por `gmail_message_id`, mas o
`source_gmail_message_id` é a chave de dedupe real, não o claim).

**Correção do achado #3 da 7ª rodada — a sequência exata do tratamento de
`23505` precisa estar explícita, não implícita**: como `execute()` agora é
transacional, o Postgres **aborta a transação inteira** assim que a
violação de unique acontece — nenhum outro comando (incluindo o `SELECT`
de busca do import existente) pode rodar nesse mesmo `client` até um
`ROLLBACK` explícito. Sequência correta, dentro do `catch` de `execute()`:

1. Checar `err.code === '23505'` **e** `err.constraint ===
   'uq_bank_stmt_imports_gmail_message_id'` (o nome exato do índice —
   nunca engolir qualquer unique violation genérica, só essa específica;
   outras violações de unique, ex. `fitid` duplicado dentro do loop de
   transações, têm tratamento próprio já existente via `ON CONFLICT DO
   NOTHING`, não passam por aqui).
2. `await client.query('ROLLBACK')` — obrigatório antes de qualquer outra
   query nesse client.
3. **Depois** do rollback, `SELECT id FROM
   psychotherapy_bank_statement_imports WHERE tenant_id=$1 AND
   source_gmail_message_id=$2` (pode reusar o mesmo client, já que a
   transação abortada foi encerrada) — usa o `id` encontrado como se
   tivesse vindo da checagem prévia, e prossegue normalmente pro passo 5
   do loop.
4. `client.release()` no `finally`, como qualquer uso normal de client de
   pool.

Qualquer outro erro (não `23505` nesse constraint específico) segue o
caminho de erro normal: `ROLLBACK`, `client.release()`, propaga a
exceção — o job mapeia pra `status='error'` no `email_imports` (nunca
sucesso silencioso).

**Antes de chamar `execute()`**, o job de e-mail primeiro consulta
`SELECT id FROM psychotherapy_bank_statement_imports WHERE tenant_id=$1
AND source_gmail_message_id=$2` — se encontrar, o import **já existe de
uma tentativa anterior**, pula direto pra atualizar `email_imports` e
marcar `processed` (usando o `claim_token` atual, ver seção de
claim/reclaim), sem chamar `execute()` de novo. Se não encontrar, chama
`execute()` normalmente (agora transacional, ver acima), tratando
`23505` como descrito. Isso fecha a janela porque a "fonte da verdade" de
"esse e-mail já foi importado" passa a ser a própria tabela de imports,
**gravada atomicamente numa transação real** — não parcialmente, e não
numa segunda tabela escrita em passo separado.

## Job de polling — reaproveita o padrão já usado no projeto

`node-cron` já é dependência usada em `server.ts` (jobs a cada 15 min e
diário às 3h). Novo job: `EmailBankStatementPollUseCase`, rodando a cada
X horas (a definir — extrato não muda em tempo real, não precisa ser
frequente; sugestão inicial: a cada 6h). Fluxo do job:

Cada execução do job processa **2 filas**, ambas alimentando o mesmo loop
de tratamento (passos 3 em diante):

- **Fila de mensagens novas**: buscar via Gmail API (`to:` + `-in:spam
  -in:trash`) e fazer o **claim atômico** (`INSERT ... ON CONFLICT DO
  NOTHING`) pra cada uma — só entram no processamento as que o claim
  aceitou.
- **Fila de reclaim**: `SELECT id, gmail_message_id FROM
  psychotherapy_bank_statement_email_imports WHERE tenant_id=$1 AND
  status='processing' AND claimed_at < NOW() - INTERVAL '30 minutes'`,
  aplicando o **reclaim atômico** (`UPDATE ... RETURNING`, que também gera
  um `claim_token` novo — seção de dedupe acima) pra cada uma — só entram
  as que o reclaim conseguiu travar de volta, e cada uma carrega consigo o
  `claim_token` que o worker atual recebeu.

Loop de tratamento, pra cada mensagem claimed/reclaimed (o worker guarda o
`claim_token` recebido no claim/reclaim durante todo o loop):

**Regra geral (correção do achado #1 da 7ª rodada de auditoria — a 6ª
rodada só tinha condicionado o `claim_token` no sucesso, deixando os
outros updates terminais desprotegidos)**: **toda** escrita de `status`
em `psychotherapy_bank_statement_email_imports` a partir daqui —
sucesso, rejeição, `no_attachment` ou `error`, sem exceção — usa o mesmo
formato:

```sql
UPDATE psychotherapy_bank_statement_email_imports
SET status = $novoStatus, error_detail = $detalhe, import_id = $importIdOuNull,
    sender_normalized = $senderNormalizedOuNull, processed_at = NOW()
WHERE id = $1 AND status = 'processing' AND claim_token = $2
```

(**Ressalva da 8ª rodada**: `sender_normalized` faz parte desse mesmo
`UPDATE` genérico, resolvido no passo 1 junto com os filtros de segurança
— nunca um `UPDATE` separado só pra essa coluna, que teria que ser
condicionado a `claim_token` de novo por conta própria.)

Se essa query afetar 0 linhas, outro worker já fez reclaim dessa mensagem
nesse meio tempo — este worker **não** tenta escrever de novo por
nenhuma via alternativa, só loga um aviso (`claim perdido, mensagem já
sendo tratada por outro worker`) e segue pra próxima mensagem da sua
fila. Os passos abaixo descrevem os valores de `$novoStatus`/`$detalhe`
em cada caso, mas todos passam por essa mesma query condicionada.

1. Aplicar os 4 filtros de segurança (seção "Filtro de mensagens"). Falha
   em qualquer um → `$novoStatus` = `rejected_sender`/`rejected_auth`
   correspondente, segue pra próxima mensagem.
2. Identificar o anexo `.csv` (regra da seção de privacidade/segurança
   abaixo). Zero `.csv` → `$novoStatus='no_attachment'`. Mais de um
   `.csv`, ou anexo fora da allowlist → `$novoStatus='error'` com
   `$detalhe` explicando qual dessas duas condições ocorreu.
3. **Checagem de idempotência real** (correção da 5ª/6ª rodada, seção
   anterior): `SELECT id FROM psychotherapy_bank_statement_imports WHERE
   tenant_id=$1 AND source_gmail_message_id=$2`. Se encontrar → import já
   existe de uma tentativa anterior, pula direto pro passo 5 com esse
   `id`. Se não encontrar → chama
   `ImportBankStatementUseCase.execute({..., sourceGmailMessageId:
   gmailMessageId})` — **`execute()` agora transacional de verdade**
   (achado #1 da 6ª rodada, corrigido acima) — o `import_id` sai gravado
   atomicamente dentro dessa chamada, cobrindo import + transações +
   contadores na mesma transação; violação de unique (`23505`) na
   constraint `uq_bank_stmt_imports_gmail_message_id` é tratada como
   idempotência (`ROLLBACK` + busca o `id` existente, ver seção acima),
   nunca como erro.
4. Se o CSV foi detectado mas o parse estrito falhar (header não bate) —
   `$novoStatus='error'`, `$detalhe` técnico, **nunca** tratado como
   sucesso silencioso.
5. `$novoStatus='processed'`, `import_id=$3` (o `id` resolvido no passo
   3) — único caso de sucesso, só alcançado depois do passo 3/4 terem
   resolvido com um `import_id` válido em mãos.
6. **Não notificar por WhatsApp/push nesta v1** (fora de escopo) — a
   terapeuta vê o resultado ao abrir a tela de Conciliação Bancária
   normalmente. Pode virar melhoria futura (avisar quando há sugestões de
   alta confiança pendentes).

## Privacidade e segurança — e-mail de terceiro não é só o Nubank (nova, achado #6 da auditoria)

O alias `rodrigosonsino+nubank@gmail.com` recebe **qualquer** e-mail
endereçado a ele — spam, phishing, e-mail mal endereçado por engano
também chegam lá, não só o extrato legítimo do Nubank. Regras explícitas,
nenhuma presente na v1:

- **Nunca logar** assunto, corpo ou headers completos do e-mail — só
  metadados técnicos mínimos (remetente normalizado, resultado da
  checagem de auth, ID da mensagem) nos logs de aplicação. Mesma regra já
  aplicada ao `raw_description` do CSV na v1 (nunca logado em erro).
- **Validar o anexo por conteúdo real (content sniffing), não só pela
  extensão/`Content-Type` declarado** pelo e-mail — mesmo princípio da
  validação de assinatura de arquivo já usada no upload manual.
- **Correção da v3 (achado da 3ª rodada de auditoria)**: a regra da v2
  ("rejeitar múltiplos anexos") ficou incompatível com o formato real
  confirmado — o e-mail legítimo do Nubank chega com **3 anexos** (CSV,
  OFX, PDF), não 1. Regra corrigida: aceitar a mensagem só se houver
  **exatamente 1 anexo `.csv`** dentro de uma allowlist conhecida de
  extensões esperadas (`.csv`, `.ofx`, `.pdf` — os outros 2 são ignorados,
  não processados). **Semântica de status corrigida na 5ª rodada** (as
  versões anteriores tinham 2 trechos conflitantes): `status='no_attachment'`
  se **zero** anexos `.csv` (caso específico, mais informativo — "não tinha
  extrato nenhum nessa mensagem"); `status='error'` se **mais de um**
  anexo `.csv`, ou qualquer anexo fora da allowlist esperada (caso
  diferente — "mensagem estruturalmente fora do padrão", mesmo que tenha
  passado nos filtros de remetente/autenticação). Os dois casos vão pra
  revisão manual, só com motivos distintos no `error_detail`/no status.
  **Precisão adicional (achado #6 da 4ª rodada)**: comparação de extensão
  **case-insensitive** (`.CSV`/`.csv` tratados igual); limite de tamanho
  do anexo individual (ex. 5MB, mesmo limite já usado no upload manual);
  `Content-Type` ambíguo/genérico (`application/octet-stream`) não é
  motivo de rejeição sozinho — a validação real é o content sniffing do
  parser (cabeçalho `Data,Valor,Identificador,Descrição` estrito, já
  existente); **CSV que passa a detecção de anexo mas falha o parse
  estrito (header não bate) não é sucesso silencioso** — vira
  `status='error'` com `error_detail` técnico, nunca um import "vazio"
  tratado como concluído.
- **Nunca seguir link arbitrário presente no corpo do e-mail** — se o
  Nubank mandar um link de download em vez de anexo direto (possível,
  ainda não confirmado), isso é fora de escopo desta v2 e precisa de
  desenho de segurança próprio (validação de domínio do link, etc.) antes
  de ser considerado.
- **Excluir explicitamente Spam/Trash** da busca Gmail API (`-in:spam
  -in:trash` na query) — nunca processar algo que o próprio Gmail já
  triou como suspeito.
- **Rate limit por tenant** no job de polling (mesmo se a Gmail API
  permitir mais) — evita que um volume anormal de e-mails pro alias (ex.
  ataque de spam direcionado) gere carga de processamento desproporcional.
- **Tela de e-mails rejeitados** (extensão da tela de Conciliação
  Bancária) mostra só o mínimo necessário pra terapeuta entender o motivo
  da rejeição (remetente, motivo técnico) — nunca corpo/assunto completo
  do e-mail rejeitado. **Correção da 7ª rodada de auditoria**: o schema de
  `psychotherapy_bank_statement_email_imports` não tinha coluna pra
  guardar o remetente, mas essa tela promete mostrá-lo — adicionar coluna
  `sender_normalized VARCHAR(255)` (só o endereço `From`, nunca nome de
  exibição nem headers completos), preenchida no passo 1 do loop de
  tratamento junto com o resultado dos filtros de segurança, antes de
  qualquer rejeição ser gravada.

## Riscos e assunções

1. ~~Formato real do anexo/e-mail do Nubank~~ — **resolvido na v3**: CSV
   confirmado entre os 3 anexos. Não bloqueia mais.
2. Domínio de envio real do Nubank pra verificação de remetente — ainda a
   confirmar com o e-mail real (não bloqueia o início da implementação,
   bloqueia só ativar o filtro de segurança em produção — ver seção de
   passos).
3. Cadência de envio automático configurável no app do Nubank — não
   confirmado se é diária/semanal/mensal, isso afeta a cadência do
   polling (não faz sentido pollar de 15 em 15 min um e-mail que só chega
   1x por mês).
4. Custo/limite de quota da Gmail API — verificar se o plano gratuito do
   Google Cloud cobre o volume esperado (deve ser trivial pro volume de
   1 e-mail por tenant por ciclo, mas confirmar antes de assumir).
5. **Novo**: nome exato do arquivo CSV anexado (pra calibrar a detecção
   por extensão/`Content-Type` no meio dos 3 anexos) — só confirmável com
   o e-mail real.

## Fora de escopo desta v3

- Notificação proativa (WhatsApp/push) de novas sugestões.
- Suporte a outros bancos além do Nubank.
- Reaproveitar a conexão OAuth do Calendar (decisão explícita de manter
  separada).
- Processar os anexos OFX/PDF do e-mail (só o CSV é extraído e
  processado; os outros 2 são ignorados).

## Passos de implementação (ordem sugerida)

1. ~~Bloqueante: confirmar formato do anexo~~ — **resolvido** (CSV
   confirmado entre os 3 anexos do e-mail automático).
2. Registrar novo cliente/escopo OAuth dedicado (`gmail.readonly`), fluxo
   de conexão na tela de perfil (padrão similar ao "Conectar Google
   Calendar" já existente).
3. Migrations (todas aditivas, não quebram o caminho de upload manual
   existente) — **correção do achado #2 da 7ª rodada: são 3 arquivos, não
   1 ou 2**, porque `CREATE INDEX CONCURRENTLY` não pode compartilhar
   arquivo/transação com nenhum outro DDL. **Ressalva da 8ª rodada**:
   `runMigrations.ts` aplica os arquivos em ordem lexicográfica
   (`.sort()`) — os números abaixo são sugestão de nome, mas o importante
   é a Migration do índice vir **depois**, alfabeticamente, da que cria a
   coluna (ambas depois de `092_idx_pix_charges_...sql`, o último número
   já usado no repo):
   - `093_gmail_email_ingestion_tables.sql` (transacional, padrão):
     tabelas `gmail_oauth_tokens`, `gmail_oauth_states`,
     `psychotherapy_bank_statement_email_imports` (já com `claim_token`,
     `sender_normalized`).
   - `094_bank_stmt_imports_source_gmail_message_id.sql` (transacional,
     padrão): `ALTER TABLE psychotherapy_bank_statement_imports ADD
     COLUMN source_gmail_message_id VARCHAR(100)`.
   - `095_idx_bank_stmt_imports_gmail_message_id_concurrently.sql`
     (`-- migrate:transaction=false`, só 1 statement): o `CREATE UNIQUE
     INDEX CONCURRENTLY uq_bank_stmt_imports_gmail_message_id`.
4. **Pré-requisito antes do job em si (achado #1 da 6ª rodada)**: reescrever
   `ImportBankStatementUseCase.execute()` pra ser genuinamente transacional
   (`pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK` cobrindo o `INSERT` do
   import, os `INSERT`s de transações e o `UPDATE` de
   `duplicate_fitid_count` — hoje são `dbPool.query()` soltos), adicionar o
   parâmetro `sourceGmailMessageId` opcional gravado no mesmo `INSERT`
   transacional, e tratar violação de unique (`23505`) em
   `source_gmail_message_id` como idempotência. Mudança isolada,
   testável sozinha (o caminho de upload manual continua passando
   `sourceGmailMessageId: null` e se comporta identicamente, só que agora
   dentro de uma transação).
5. `EmailBankStatementPollUseCase` + job `node-cron` (extrai o anexo
   `.csv` entre os 3, aplica os filtros de segurança, chama
   `ImportBankStatementUseCase.execute()` já transacional do passo 4).
6. Testar contra 1 e-mail real numa branch Neon descartável antes de tocar
   produção — mesmo rigor da v1, incluindo confirmar nome do anexo e
   domínio de remetente reais nesse teste, **e testar o caso de
   claim_token invalidado** (simular um worker lento sendo reclaimed por
   outro, confirmar que o `UPDATE` terminal do primeiro afeta 0 linhas).
7. Build completo + verificação de hash de bundle (frontend, se a tela de
   conexão/desconexão de e-mail for adicionada) antes de deploy.
