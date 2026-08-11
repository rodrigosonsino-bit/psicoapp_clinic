# Plano: corrigir texto enganoso do badge "Sessão paga" em Agendamentos — v3.1

> Status: **APROVADO COM RESSALVAS pelo Codex CLI (3ª rodada) — ressalvas
> incorporadas nesta v3.1, liberado para implementação.**

## Mudanças da v3 para a v3.1 (rastreamento dos achados do Codex, 3ª rodada — APROVADO COM RESSALVAS, não-bloqueantes)

| # | Achado v3 | Como foi endereçado na v3.1 |
|---|---|---|
| 1 | Faltavam 2 textos residuais em `handleMarkSessionPaid` que ainda prometiam vínculo por sessão: toast de "já tudo pago" (linha 261) e toast de erro genérico (linha 273) | Adicionados à Mudança 4 com o texto exato sugerido pelo Codex |
| 2 | Tooltip proposto ("não indica a data exata") ainda sugeria que existe vínculo, só faltando a data | Trocado pelo texto mais rigoroso sugerido pelo Codex: nega o vínculo por completo, não só a data |
| 3 | Nota opcional em `MonthlyRecords.tsx` não é "só troca de string" (é JSX novo) e escopo devia mencionar exclusão de futuras/faltas/canceladas | Reclassificada explicitamente como "adição textual opcional" (4º arquivo, não risco arquitetural) com texto ajustado |

## Mudanças da v2 para a v3 (rastreamento dos achados do Codex, 2ª rodada)

| # | Achado v2 (severidade) | Como foi endereçado na v3 |
|---|---|---|
| 1-6 | Objetivo/ressalvas: histórico de créditos não reconcilia com saldo atual quando há decrementos manuais; query da Mudança 3 não tinha `paid_sessions` pra calcular o resíduo (contradição interna); endpoint atômico não resolve idempotência de duplo clique; lost-update continua existindo contra `saveMonthlyRecord`; inventário de escritores ainda incompleto (`importPsychotherapyWorkbook.ts`, `IssuePsychotherapyReceiptUseCase`); nome "mark-session-paid" e mensagens de sucesso continuavam implicando vínculo sessão-específica que não existe | **Toda a Mudança 1 (auditoria), Mudança 2 (endpoint atômico) e Mudança 3 (histórico de créditos) foram removidas.** O Codex apontou explicitamente, no veredito final da 2ª rodada: *"Para corrigir apenas a promessa enganosa do badge, renomear indicadores e a ação já entregaria o núcleo com muito menos superfície. O histórico só é proporcional se houver requisito de produto explícito."* Não há esse requisito — o problema relatado é confusão de leitura, não necessidade de auditoria financeira. v3 resolve **só** isso |

## Contexto e problema real (não hipotético)

Descoberto investigando um caso real de produção (paciente Paula G, PsicoApp,
2026-08-11): a tela de Agendamentos mostra um badge/tooltip "Sessão paga" por
agendamento individual, mas **não existe nenhum vínculo no schema entre um
pagamento específico e uma sessão específica** para pacientes `per_session`
— só um contador agregado por mês (`psychotherapy_monthly_records.paid_sessions`).

`PostgresBillingRepository.computeCoveredSessions`
(`backend/src/infrastructure/repositories/PostgresBillingRepository.ts:1113-1132`)
pega os agendamentos não-cancelados do mês com `scheduled_at <= NOW()`, ordena
por data, e marca como "covered" as primeiras N (N = `paid_sessions`), sem
qualquer relação com a data em que o pagamento foi de fato recebido. Essa é
uma decisão de escopo deliberada e documentada
(`docs/bank-statement-reconciliation-plan.md`, "Fora de escopo (v1):
Conectar `financial_payments` ao fluxo individual") — funciona corretamente
para o fechamento agregado do mês (X de Y sessões pagas está sempre certo),
mas a UI expõe esse número agregado com linguagem que implica uma afirmação
factual pontual ("esta sessão foi paga") que o dado não sustenta.

Caso real: Paula pagou R$90 via Pix em 01/08 (confirmado no mesmo dia). A
sessão de 04/08 já estava cancelada desde 28/07 (antes do Pix). A sessão de
**11/08** (próxima não-cancelada, ocorrida 10 dias após o pagamento) apareceu
com "Sessão paga" — nenhum pagamento foi recebido nesse dia.

## Por que a v3 é deliberadamente pequena

Duas rodadas de auditoria (Codex CLI) mostraram que qualquer tentativa de
**explicar a origem** do crédito por sessão (v1: atribuição ordinal; v2:
histórico de créditos do mês) esbarra em problemas reais e não-triviais:
saldo legado sem rastro, decrementos manuais não capturados por um log
aditivo, múltiplos escritores de `paid_sessions` fora de qualquer transação
unificada (`saveMonthlyRecord`, `MonthlyRecordSynchronizer`,
`importPsychotherapyWorkbook.ts`, `IssuePsychotherapyReceiptUseCase`, scripts
de backfill), e nenhum deles com lock/versionamento que permita reconstruir
"o que aconteceu" com confiança total.

**Resolver isso de verdade é um projeto de ledger financeiro, não uma
correção de UX** — desproporcional ao problema relatado, que é: a palavra
"paga" no singular, atrelada a uma sessão específica, mente sobre o que o
sistema sabe. A v3 ataca exatamly esse ponto, e só ele: **trocar a
linguagem para o que é verdadeiro** — "esta sessão está dentro do saldo pago
do mês", não "esta sessão foi paga". Zero mudança de comportamento, zero
mudança de schema, zero endpoint novo, zero risco de concorrência novo.

## Mudança única — Textos e rótulos (frontend, 3 arquivos)

Nenhuma mudança de backend. Nenhuma mudança de dado. Só texto.

**1. `src/components/Calendar/AppointmentChip.tsx`**
   - Linha 95: `title={isPaid ? 'Sessão paga' : undefined}` →
     `title={isPaid ? 'Incluída por ordem cronológica no contador mensal de sessões pagas; não vincula esta sessão a um pagamento específico.' : undefined}`
     (texto exato sugerido pelo Codex na 3ª rodada — nega o vínculo por
     completo, não só a data do pagamento).
   - Linha 146 (botão, condição real confirmada no código:
     `appointment.status === 'attended' && !appointment.groupId && !isPaid`):
     manter a condição de exibição exatamente como está, trocar o texto do
     botão de "Marcar sessão como paga" para **"Adicionar sessão paga ao
     saldo do mês"**.

**2. `src/components/Calendar/MonthGrid.tsx:79`**
   - Mesma troca de texto: `title={coveredAppointmentIds.has(a.id) ? 'Sessão paga' : undefined}`
     → mesmo texto (rigoroso) da Mudança 1.

**3. `src/pages/Appointments.tsx:562`** (indicador na lista tabular, mesmo
   `coveredAppointmentIds`, confirmado `title="Sessão paga"` no código real)
   - Mesma troca de texto, mantendo o padrão visual (ícone/cor) inalterado.

**4. `src/pages/Appointments.tsx` — `handleMarkSessionPaid` (linhas 246-275)**
   - **Nenhuma mudança de lógica** (continua chamando o mesmo endpoint
     genérico `POST /months/:month/records`, mesmo cálculo client-side,
     mesmo comportamento — o lost-update conhecido e aceito nesse caminho
     não é objeto deste plano).
   - 3 strings trocadas (as 2 originais + as 2 residuais apontadas pelo
     Codex na 3ª rodada, que a v3 tinha deixado passar):
     - Linha 261, `toast.info`: `'Esse mês já está com todas as sessões esperadas marcadas como pagas.'`
       → `'O saldo mensal já contempla todas as sessões esperadas.'`
     - Linha 270, `toast.success`: `` `Sessão marcada como paga (${newPaidSessions}/${targetSessions} pagas em ${month}).` ``
       → `` `+1 sessão paga adicionada ao saldo de ${month} (${newPaidSessions}/${targetSessions}).` ``
     - Linha 273, fallback de erro: `'Erro ao marcar sessão como paga.'`
       → `'Erro ao atualizar o saldo de sessões pagas do mês.'`

**5. Adição textual opcional (4º arquivo, não é troca de string em local
   existente — é 1 linha de JSX nova; ainda assim frontend informativo, sem
   novo dado/endpoint, risco mínimo) — `src/pages/MonthlyRecords.tsx`,
   verificar durante implementação o componente exato do contador
   `paidSessions`/`expectedSessions` por paciente/mês**: adicionar um texto
   explicativo estático perto dele, ajustado por precisão (achado da 3ª
   rodada — o cálculo também exclui futuras, faltas e canceladas, não só
   "ordem cronológica"): *"Sessões pagas contam, em ordem cronológica, entre
   as sessões elegíveis já ocorridas no mês (exclui canceladas e faltas) —
   não indicam qual pagamento específico corresponde a qual sessão."*

## Explicitamente fora de escopo (documentado, não esquecido)

- Qualquer rastreamento de origem de pagamento por sessão (auditoria,
  histórico de créditos, ledger) — fica documentado neste arquivo como
  **trabalho futuro**, condicionado a haver necessidade real de produto (ex.:
  disputa recorrente com pacientes, exigência de auditoria financeira
  formal) que justifique o escopo maior que duas rodadas de auditoria já
  mostraram ser não-trivial.
- O lost-update conhecido em `saveMonthlyRecord` (leitura-cálculo-escrita no
  cliente) — risco pré-existente, já documentado no plano de conciliação
  bancária original, não introduzido nem agravado por esta mudança.
- Qualquer alteração em `ConfirmBankStatementTransactionUseCase`,
  `incrementPaidSessions`, `PaymentReceiptHandler`, `MonthlyRecordSynchronizer`
  ou qualquer script de backfill — nenhum desses arquivos é tocado.
- Qualquer migração de banco de dados — nenhuma.

## Testes

- Regressão: build (`tsc -b`/`vite build`) limpo nos dois apps.
- Manual, verificação visual contra o caso real da Paula G: tooltip da
  sessão de 11/08 não afirma mais "Sessão paga", mostra o texto novo.
- Manual: clicar em "Adicionar sessão paga ao saldo do mês" numa sessão
  `attended` sem cobertura ainda funciona exatamente como antes (mesmo
  endpoint, mesmo resultado numérico), só a mensagem de toast muda.
- Nenhum teste automatizado novo necessário — não há lógica nova, só string
  literals.

## Ordem de implementação

1. Editar os 3 arquivos de texto/tooltip (Mudanças 1-3).
2. Editar a mensagem de toast (Mudança 4).
3. Verificar `MonthlyRecords.tsx` e decidir se a nota explicativa (Mudança 5,
   opcional) se aplica.
4. Build + verificação manual no navegador.
5. Deploy frontend (sem dependência de deploy de backend, já que nada mudou
   lá).

## Riscos residuais aceitos

- Continua não havendo vínculo real pagamento↔sessão — só a linguagem para
  de afirmar que existe. Se isso não for suficiente para a necessidade real
  do produto, o próximo passo é abrir um plano novo, específico para
  ledger/auditoria de pagamento por sessão, auditado separadamente (escopo
  maior, precisa de decisão de produto sobre regra de alocação retroativa,
  não cabe como extensão deste plano mínimo).
