# Ingestão Automática de Extrato Bancário via E-mail — Plano v2 — **APROVADO COM RESSALVAS (não implementado)**

> **Veredito final (2ª rodada de auditoria Codex CLI, 2026-07-11):
> Aprovado com ressalvas.** Os 6 achados da v1 foram fechados; a única
> ressalva remanescente (mecanismo de reclaim de mensagens travadas
> precisava ser um `UPDATE` atômico, não leitura+escrita em passos
> separados) já foi corrigida no texto abaixo. **Plano pronto pra
> implementação — bloqueado só pelo pré-requisito real: confirmar o
> formato do e-mail/anexo do Nubank com um envio de teste.**

> **Histórico**: v1 auditada pelo Codex CLI e **reprovada** (2026-07-11) —
> 6 achados (3 altos, 3 médios): verificação SPF/DKIM subespecificada e
> potencialmente falsificável; armazenamento de token OAuth do Gmail sem
> exigir criptografia (achado confirmado lendo `GoogleCalendarService.ts`/
> migration `012_google_calendar.sql` reais — hoje `access_token`/
> `refresh_token` ficam em `TEXT` puro); contradição entre "mesmo pipeline
> já aprovado" e a hipótese de PDF (pipeline atual é CSV-only, PDF exigiria
> reabrir os riscos da v6 do plano de conciliação); schema de dedupe
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

## Pré-requisito bloqueante — mesma categoria de risco que a v1 teve com PDF/CSV/OFX

**Não sabemos, ainda, em que formato o Nubank manda o extrato por e-mail
automático.** Pode ser PDF anexado (mais comum em envios automáticos de
banco), pode ser um link pra baixar, pode até ser o CSV. A v1 deste projeto
já mudou de arquitetura 2 vezes (PDF → CSV/OFX) por causa exatamente desse
tipo de suposição não validada — **não repetir o erro aqui**. Antes de
escrever qualquer parser novo:

1. Usuário configura o envio recorrente no app do Nubank pro alias.
2. Aguardar 1 envio real chegar.
3. Inspecionar o e-mail real (remetente exato, assunto, formato do anexo
   ou link, se tem senha/proteção no PDF).
4. Só então decidir: reaproveitar o parser CSV já existente (se o anexo for
   CSV), ou desenhar um novo caminho (se for PDF/link).

**Correção da v2 (achado #3 da auditoria)**: a v1 dizia "roda o mesmo
pipeline já existente e aprovado" como se fosse verdade incondicionalmente
— **não é**. `ImportBankStatementUseCase` hoje chama `parseNubankCsv()`
direto e grava `file_format='csv'` — é **CSV-only**, ponto final. As duas
hipóteses de formato do anexo do e-mail levam a caminhos bem diferentes:

- **Se vier CSV**: a frase "mesmo pipeline" fica literalmente verdadeira —
  só muda a origem do buffer (upload HTTP → anexo de e-mail), o resto do
  código não muda nada.
- **Se vier PDF**: **não é** "só trocar a origem do arquivo" — reabre
  integralmente os riscos já identificados e descartados na v6 do plano de
  conciliação (extração posicional, ausência provável de FITID real,
  dedupe mais frágil, hardening contra PDF malicioso). Nesse caso, esta
  fase 2 vira um projeto do tamanho da v6, não um incremento pequeno sobre
  a v1 já aprovada. **Isso precisa ser reavaliado com o usuário antes de
  prosseguir** se o formato real vier a ser PDF — não é uma decisão que
  este plano toma sozinho.

Este plano **não assume mais** um formato específico como hipótese de
trabalho (a v1 assumia PDF "porque é mais comum") — a decisão de caminho
fica genuinamente em aberto até o passo 1 (bloqueante) ser cumprido.

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

**Correção da v2 (achado #2 da auditoria) — armazenamento de token precisa
de controles mais fortes que o do Calendar hoje**: confirmado lendo o
código real que `google_oauth_tokens` (migration `012_google_calendar.sql`)
guarda `access_token`/`refresh_token` como `TEXT` puro, sem criptografia —
aceitável hoje pro Calendar (escopo limitado a criar/editar eventos), mas
**insuficiente pro Gmail** (`gmail.readonly` cobre a caixa inteira — um
vazamento do banco exporia acesso de leitura ao e-mail inteiro do usuário,
não só ao extrato). Requisitos novos, não presentes na v1:
- Tabela **separada** (`gmail_oauth_tokens`, não reaproveitar
  `google_oauth_tokens`), reforçando o isolamento já decidido.
- **`refresh_token` cifrado em repouso** antes de gravar (cifra simétrica
  com chave em variável de ambiente dedicada, nunca a mesma do
  `JWT_SECRET`/outros segredos já em uso) — o `access_token` de curta
  duração pode continuar em texto puro (expira em ~1h), mas o
  `refresh_token` de longa duração (a chave de fato sensível) não.
- **Fluxo de desconexão explícito** (botão "Desconectar e-mail" na tela de
  perfil) que revoga o token junto ao Google (`oauth2Client.revokeToken()`)
  e apaga a linha — não só marca como inativo.
- Aviso explícito na UI, no momento da conexão: "o app terá acesso técnico
  de leitura à sua caixa de e-mail inteira (Gmail exige esse escopo), mas
  só processa mensagens enviadas para o alias configurado" — transparência
  sobre a limitação já documentada acima.

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

**Correção da v2 (achado #4 da auditoria)** — schema completo, seguindo o
mesmo padrão já usado em `psychotherapy_bank_statement_imports`/
`_transactions` (FK composta com `tenant_id`, `UNIQUE(id, tenant_id)`
quando referenciada por outra tabela):

```sql
CREATE TABLE psychotherapy_bank_statement_email_imports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  gmail_message_id   VARCHAR(100) NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'processing'
                      CHECK (status IN ('processing','processed','rejected_sender',
                                         'rejected_auth','no_attachment','error')),
  import_id          UUID,  -- preenchido só se status='processed'
  error_detail       TEXT,  -- nunca inclui corpo/assunto do e-mail, só a causa técnica
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (import_id, tenant_id)
    REFERENCES psychotherapy_bank_statement_imports (id, tenant_id) ON DELETE SET NULL,
  UNIQUE (tenant_id, gmail_message_id)
);
```

**Claim atômico contra concorrência** (achado real: dois disparos do job
de polling podem se sobrepor — ex. um ciclo demorando mais que o intervalo
entre execuções): antes de processar qualquer mensagem, o job faz
`INSERT INTO psychotherapy_bank_statement_email_imports (tenant_id,
gmail_message_id, status) VALUES ($1, $2, 'processing') ON CONFLICT
(tenant_id, gmail_message_id) DO NOTHING RETURNING id`. Se não retornar
linha, outro processo já está tratando essa mensagem (ou já tratou) —
pula sem reprocessar. Só depois desse claim bem-sucedido o job segue pros
filtros de segurança e eventual `ImportBankStatementUseCase.execute()`.

**Retry de mensagens travadas — reclaim atômico** (precisão adicionada
após 2ª rodada de auditoria): se um processo morrer no meio (status fica
`processing` indefinidamente), o reclaim **não pode** ser um SELECT seguido
de UPDATE em passos separados (2 workers reconsiderando a mesma linha
travada ao mesmo tempo reabririam a mesma corrida que o claim original
evita). Reclaim correto, atômico, em 1 statement:

```sql
UPDATE psychotherapy_bank_statement_email_imports
SET status = 'processing', created_at = NOW()
WHERE tenant_id = $1 AND gmail_message_id = $2
  AND status = 'processing' AND created_at < NOW() - INTERVAL '30 minutes'
RETURNING id;
```

Só o worker que efetivamente recebe a linha de volta (`RETURNING id` não
vazio) segue pro processamento — os demais tratam como "já sendo tratado
por outro processo" e pulam, igual ao claim inicial.

## Job de polling — reaproveita o padrão já usado no projeto

`node-cron` já é dependência usada em `server.ts` (jobs a cada 15 min e
diário às 3h). Novo job: `EmailBankStatementPollUseCase`, rodando a cada
X horas (a definir — extrato não muda em tempo real, não precisa ser
frequente; sugestão inicial: a cada 6h). Fluxo do job:

1. Pra cada tenant com a conexão de e-mail dedicada ativa: buscar mensagens
   novas via Gmail API (`to:` + não presentes em
   `psychotherapy_bank_statement_email_imports`).
2. Pra cada mensagem: aplicar os 3 filtros de segurança (seção acima).
3. Se aprovada: extrair anexo, chamar `ImportBankStatementUseCase.execute()`
   — **mesmo caminho, mesmas garantias já auditadas** (matching, gates,
   nunca grava sozinho).
4. Registrar resultado na tabela de dedupe de e-mail.
5. **Não notificar por WhatsApp/push nesta v1** (fora de escopo) — a
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
- **Rejeitar mensagens com múltiplos anexos inesperados** (mais que 1) sem
  tentar adivinhar qual é o extrato — reportar como `error`, deixar pra
  revisão manual.
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
  do e-mail rejeitado.

## Riscos e assunções (bloqueantes)

1. **Formato real do anexo/e-mail do Nubank — não confirmado** (seção
   "Pré-requisito bloqueante" acima). Bloqueante de verdade — nada de
   parser novo antes disso.
2. Domínio de envio real do Nubank pra verificação de remetente — a
   confirmar com o e-mail real.
3. Cadência de envio automático configurável no app do Nubank — não
   confirmado se é diária/semanal/mensal, isso afeta a cadência do
   polling (não faz sentido pollar de 15 em 15 min um e-mail que só chega
   1x por mês).
4. Custo/limite de quota da Gmail API — verificar se o plano gratuito do
   Google Cloud cobre o volume esperado (deve ser trivial pro volume de
   1 e-mail por tenant por ciclo, mas confirmar antes de assumir).

## Fora de escopo desta v1

- Notificação proativa (WhatsApp/push) de novas sugestões.
- Suporte a outros bancos além do Nubank.
- Reaproveitar a conexão OAuth do Calendar (decisão explícita de manter
  separada).
- Qualquer coisa além de PDF/CSV como formato de anexo (OFX por e-mail,
  se existir, fica pra quando for confirmado que existe).

## Passos de implementação (ordem sugerida)

1. **Bloqueante**: usuário configura o envio automático no Nubank, aguarda
   1 e-mail real chegar, compartilha o formato/remetente real.
2. Decidir arquitetura de parsing definitiva com base no formato real
   (reaproveitar CSV, ou desenhar extração de PDF).
3. Registrar novo cliente/escopo OAuth dedicado (`gmail.readonly`), fluxo
   de conexão na tela de perfil (padrão similar ao "Conectar Google
   Calendar" já existente).
4. Migration da tabela de dedupe de e-mail.
5. `EmailBankStatementPollUseCase` + job `node-cron`.
6. Testar contra o e-mail real numa branch Neon descartável antes de tocar
   produção — mesmo rigor da v1.
7. **Nova rodada de auditoria Codex CLI** antes de implementar de verdade
   (mesmo processo da v1 — este plano ainda não foi auditado).
