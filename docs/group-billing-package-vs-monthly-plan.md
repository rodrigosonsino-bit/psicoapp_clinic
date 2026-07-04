# Plano — Tipo de plano visível em Pagamentos, taxa de cartão configurável e receita líquida

**Status:** revisão 2 — corrigida após revisão externa (Codex CLI) ter reprovado a v1
**Apps afetados:** `apps/psychotherapy-api` e `apps/psychotherapy-web`
**Página:** Grupos Terapêuticos (`Groups.tsx`), sub-aba Pagamentos

## 0. Pedido original do usuário

1. Front: coluna na tabela de pagamentos dos membros indicando o tipo de plano (Pacote Completo / Mensal).
2. Front: botão para dar baixa total no pagamento de quem escolheu pacote, marcando pago para todos os meses do curso.
3. Back: lógica para processar pagamento por pacote, garantindo status "Pago" nos períodos restantes.
4. Back: ao registrar pagamento parcelado no cartão, calcular o valor real que entra no faturamento, descontando taxa da operadora.
5. Ajustar cálculo de receita esperada e recebida para refletir isso.

## 1. Histórico da revisão (v1 → v2)

A v1 deste plano foi revisada pelo Codex CLI e **reprovada**. Achados confirmados manualmente contra o código real:

| Premissa da v1 | Realidade confirmada | Fonte |
|---|---|---|
| `billing_type` tem valores `monthly`/`upfront`/`installments` | CHECK só permite `group_default`/`upfront`/`exempt` | `migrations/079_therapy_group_billing_policies_and_refunds.sql:11` |
| Pagamento de pacote já aparece certo em `listGroupMembers`/`listGroupPayments` via `charge_type IN ('upfront','installments')` | `charge_type` só aceita `monthly`/`session`/`course_upfront` (`migrations/070...sql:36`) — o filtro `IN ('upfront','installments')` bate com valores que **não existem na coluna**; é um bug pré-existente, não algo que a v1 podia reaproveitar como "já funciona" |
| `payment.total_installments` identifica parcelas do cartão | `AdvanceInstallmentsUseCase` grava `charge_type='monthly'` e nunca popula `total_installments`/`installment_number`/`installment_group_id` (`AdvanceInstallmentsUseCase.ts`) — esse campo é sobre parcelamento **da mensalidade do curso**, não da transação no cartão. São conceitos diferentes. |
| `LEFT JOIN` em política `status='active'` é 1:1 por membro | Não há índice/constraint único garantindo isso — `UNIQUE(id, tenant_id)` só serve para FK composta. Precisa de seleção defensiva (mais recente/vigente), não um JOIN ingênuo. |
| `cardFeeRates: null` limpa a config | Não verificado se o padrão de `bookingPage` usa `COALESCE` (o que impediria limpar com `null`) — esta v2 **não copia esse padrão às cegas**: define semântica explícita abaixo. |

Essas correções mudam a v2 em pontos estruturais: **não existe "parcelado" como tipo de plano** (só existe no vocabulário do front, sem correspondente real no banco), e a taxa de cartão precisa de um campo próprio e efêmero no modal, desacoplado de qualquer contador de parcelas do grupo.

## 2. O que já existe hoje (não duplicar)

- `therapy_group_member_billing_policies.billing_type`: `group_default` (mensal padrão do grupo) | `upfront` (pacote pago à vista) | `exempt` (isento, com motivo).
- Botão **"Receber Pacote"** (`Groups.tsx`, `showUpfrontModal`) → `CreateUpfrontCourseChargeUseCase` (cobra saldo restante do curso) → `ConfirmGroupPaymentUseCase` (branch `charge_type === 'course_upfront'`, linhas 165-207): ativa política `upfront` e **anula** (não "paga") as mensalidades futuras `pending` com `due_date >= hoje`; inadimplência passada não é tocada. Ou seja, "baixa total" já existe, mas via anulação das cobranças futuras — não via marcá-las como `paid`. Isso é intencional (evita inflar receita com pagamentos que nunca existiram) e **não deve ser alterado**.
- Bruto/taxa/líquido (`net_amount_cents`/`processing_fee_cents`) já existem em `group_payments`/`financial_payments` desde `514aabf`, preenchidos a partir de um campo opcional "Crédito Líquido em Conta" digitado manualmente no `ConfirmPaymentModal`.
- `listGroupPayments` já retorna `total_paid_cents`, `total_net_cents`, `total_fee_cents` por paciente (bruto, líquido e taxa já calculados na API).

## 3. Escopo corrigido

### 3.1 Coluna "Tipo" na sub-aba Pagamentos

Valores possíveis, com rótulo fixo (sem inventar "parcelado"):
- `group_default` → **"Mensal"**
- `upfront` → **"Pacote Completo"**
- `exempt` → **"Isento"**
- Ausência de política → **"Mensal"** (mesmo default de hoje)

Seleção defensiva da política (evita duplicar linhas/somas caso exista mais de uma `active` histórica):

```sql
LEFT JOIN LATERAL (
    SELECT billing_type
    FROM therapy_group_member_billing_policies bp
    WHERE bp.member_id = tgm.id
      AND bp.status = 'active'
      AND bp.valid_from <= CURRENT_DATE
      AND (bp.valid_until IS NULL OR bp.valid_until >= CURRENT_DATE)
    ORDER BY bp.valid_from DESC
    LIMIT 1
) bp ON true
```

Mesma política aplicada a `listGroupMembers` (hoje usa `LEFT JOIN ... AND bp.status = 'active'` direto, sem o filtro de vigência por data nem `LIMIT 1` — vale corrigir os dois pontos juntos, já que o risco de duplicar é o mesmo).

Front: extrair um único helper `billingTypeLabel(type: string | null): string` reaproveitado nas duas tabelas (Membros e Pagamentos), com o mapeamento acima — substitui a ternária atual (`m.payment_type === 'monthly' ? ... : 'installments' ? ...`) que checava valores que nunca chegam do backend.

**Fora de escopo:** o filtro `charge_type IN ('upfront', 'installments')` usado no cálculo de `payment_status` (linhas 405-406 e 720-724 de `GroupController.ts`) é um bug pré-existente e independente deste plano (deveria ser `charge_type = 'course_upfront'`). Vou sinalizar para o usuário decidir se corrige junto ou como item separado — **não** vou silenciosamente propagar esse mesmo filtro errado para código novo.

### 3.2 "Baixa total" (pacote) — já implementado, sem trabalho novo

Confirmado: o fluxo já garante que, após confirmar o pagamento à vista, nenhuma mensalidade futura fica pendente (são anuladas, não pagas — distinção intencional preservada). Nenhuma mudança de backend aqui.

### 3.3 KPIs financeiros — 4 valores, não substituição

Em vez de trocar "Recebido" de bruto para líquido (o que Codex apontou corretamente como mistura de bases — "esperado" contratual é bruto, então "pendente" ficaria incoerente se "recebido" virasse líquido), a v2 mostra os dois:

- **Receita esperada** (bruto contratual): para membros `exempt`, conta 0; para `upfront` com política ativa, não soma `monthly_fee_cents` (já quitado/anulado, não gera expectativa mensal); para `group_default`/sem política, soma `monthly_fee_cents` como hoje.
- **Recebido (bruto)**: mantém `total_paid_cents`, como hoje.
- **Taxas descontadas**: novo KPI, soma `total_fee_cents`.
- **Recebido líquido**: novo KPI, soma `total_net_cents`.
- **Pendente**: continua calculado sobre bruto (contra "esperado"), sem mudança de fórmula.

### 3.4 Sugestão de taxa de cartão — campo próprio, efêmero

O modal ganha um campo **novo e local ao componente** (não persistido, não relacionado a `total_installments` do grupo): "Parcelas no cartão" (select 1x–12x), visível só quando `paymentMethod === 'credit_card'`. Ao mudar esse select (ou o valor bruto), se existir taxa configurada para aquele número de parcelas, **pré-preenche** (nunca sobrescreve edição manual já feita pelo usuário nesta sessão do modal) o campo "Crédito Líquido em Conta" com `paidCents * (1 - taxa/100)`, arredondado em centavos. Trocar para PIX/Dinheiro/Débito limpa a sugestão (mas não o valor já digitado manualmente). O backend do endpoint de confirmação **não muda** — continua recebendo só `netAmountCents` como já recebe hoje.

## 4. Modelagem

Migration `084_tenant_card_fee_rates.sql`:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS card_fee_rates JSONB;
```

Formato: `{"1": 350, "2": 450, ..., "12": 1590}` — chave = nº de parcelas (string `"1"`–`"12"`), valor = **basis points** (inteiro, 350 = 3,50%) em vez de float percentual, evitando erro de arredondamento em ponto flutuante sobre valor financeiro.

Validação:
- Zod: `z.record(z.string().regex(/^([1-9]|1[0-2])$/), z.number().int().min(0).max(10000)).nullable().optional()`.
- Semântica explícita e testada: **campo ausente no payload** = não altera o valor salvo (comportamento padrão de PATCH parcial); **campo `null`** = limpa a config; **objeto vazio `{}`** = configuração "zerada" mas presente (nenhuma parcela sugere nada, equivalente a ausente na prática, mas distinto para fins de auditoria/consulta).
- **Confirmado no código:** `booking_page = COALESCE($6::jsonb, booking_page)` (`PostgresPsychotherapyRepository.ts:431`) — esse padrão existente **não permite limpar com `null`** (Codex estava certo). `card_fee_rates` **não pode reusar esse mesmo COALESCE** se quiser suportar limpeza; a query de update precisa distinguir "campo não veio" (não gera `SET` para essa coluna) de "campo veio como `null`" (`SET card_fee_rates = NULL` incondicional) na camada de use case/repositório, não via `COALESCE` no SQL.

## 5. Back-end — todos os pontos da cadeia (não só schema+use case)

Camadas que precisam mudar para `cardFeeRates` chegar ao perfil (levantamento real do fluxo de `bookingPage`, que segue o mesmo caminho):
- `updateProfileSchema` (Zod, `psychotherapyRoutes.ts`)
- `UpdateTenantProfileUseCase` / `UpdateTenantProfileDTO`
- `ProfileController.updateProfile` (monta o DTO manualmente — precisa incluir o campo novo)
- Modelo de domínio `TenantProfile` (e seu `toJSON`, se existir)
- `TenantProfileRow` (tipo de linha do banco)
- Repositório: `getTenantProfile` (leitura) e `updateTenantProfile` (escrita + `RETURNING`)
- Rota `GET /profile` (para expor `cardFeeRates` na leitura)
- Tipos do frontend (`types/api.ts` ou equivalente)

`listGroupPayments`/`listGroupMembers`: aplicar o `LATERAL JOIN` da seção 3.1.

## 6. Front-end

- `billingTypeLabel()` compartilhado (seção 3.1).
- Coluna "Tipo" na tabela de Pagamentos.
- `FinancialSummary`: 4 KPIs (seção 3.3), tipos `any[]`/`any` trocados por interfaces explícitas para os campos usados (`total_paid_cents`, `total_net_cents`, `total_fee_cents`, `payment_type`) — evita reintroduzir confusão de campos como a v1 fez.
- `ProfileSettings.tsx`: seção de configuração de taxas por parcela (1x–12x), salvando via `PUT /api/profile { cardFeeRates }` em basis points (converter de/para % só na exibição).
- `ConfirmPaymentModal`: campo local "Parcelas no cartão" + lógica de sugestão (seção 3.4). Fonte dos `cardFeeRates`: **confirmado que não existe** hoje nenhum contexto/hook compartilhado de perfil no frontend (`grep` por `useProfile`/`ProfileContext` não retornou nada). Decisão: `Groups.tsx` busca `GET /api/profile` uma vez no mount (mesmo padrão já usado para carregar grupos) e passa `cardFeeRates` como prop para `ConfirmPaymentModal` — sem criar um Context novo para um único campo.

## 7. Ordem de rollout (evita quebrar `GET /profile` em produção)

1. Migration `084` aplicada no Neon.
2. Deploy do backend (schema/use case/controller/repositório já sabem ler/escrever a coluna nova).
3. Deploy do frontend.

Nunca subir backend que lê `card_fee_rates` antes da coluna existir.

## 8. Testes

- `billing_type`: `group_default`, `upfront`, `exempt`, ausência de política → rótulo e receita esperada corretos.
- Política histórica encerrada (`valid_until` no passado) não é escolhida pela LATERAL, e não duplica soma de pagamentos.
- `cardFeeRates`: ausente vs `null` vs `{}` têm efeitos distintos e testados; parcela fora de 1–12 e taxa fora de 0–10000 bps rejeitadas; isolamento entre tenants.
- Migration up/down com tenant legado (coluna `NULL`).
- `FinancialSummary`: mix de `group_default`/`upfront`/`exempt` produz "esperado" correto; "pendente" continua coerente com "esperado" bruto.
- Modal: sugestão não sobrescreve edição manual; trocar de cartão para PIX e voltar; taxa ausente/zero/100%; arredondamento em centavos.
- Idempotência do `confirm` continua igual (nenhuma mudança de contrato do endpoint).

## 9. Fora de escopo

- Taxa por bandeira/adquirente (só por nº de parcelas, v1).
- Qualquer cálculo automático "oficial" sem confirmação manual do operador.

## 11. Revisão 3 — correções de uma 2ª reprovação (Codex)

A v2 foi revisada de novo e reprovada, com achados novos confirmados manualmente:

1. **Fórmula de bps errada na v2** (`paidCents * (1 - taxa/100)` com taxa em bps geraria fator negativo). Corrigido: `paidCents * (1 - taxaBps/10000)`, arredondando o líquido resultante em centavos (`Math.round`).

2. **Bug de `course_upfront` não pode ficar fora de escopo** — confirmado que é um bug **já ativo em produção**: pacientes que compraram o pacote completo aparecem com status **"Pendente"** em meses futuros (as mensalidades futuras são anuladas — `status='voided'` — e ficam de fora de todas as somas; a query hoje só reconhece pagamento via `charge_type IN ('upfront','installments')`, que nunca existe de verdade). Decisão do usuário: corrigir junto nesta entrega.

   Correção (em `listGroupMembers` e `listGroupPayments`, `GroupController.ts`): trocar `charge_type IN ('upfront', 'installments')` por `charge_type = 'course_upfront'` **com recorte temporal explícito**, para não marcar como "pago" meses anteriores à compra do pacote (que podem ter dívida real não quitada — o próprio fluxo de anulação só cobre mensalidades *futuras* a partir da compra, `ConfirmGroupPaymentUseCase.ts:189`, e inadimplência anterior fica separada):

   ```sql
   EXISTS (
       SELECT 1 FROM group_payments gp2
       WHERE gp2.group_member_id = tgm.id AND gp2.tenant_id = $2
         AND gp2.status = 'paid' AND gp2.charge_type = 'course_upfront'
         AND TO_CHAR(gp2.paid_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') <= $3 -- effectiveMonth
   )
   ```

   Isso garante: meses a partir da compra (inclusive) → "Pago" via pacote; meses antes da compra → segue a lógica normal de mensalidade (pode legitimamente mostrar pendência de dívida anterior, que não é tocada pelo fluxo de pacote).

3. **`LATERAL JOIN` da seção 3.1 usava `CURRENT_DATE`** em vez do mês efetivamente consultado (`$3`/`effectiveMonth`) — corrigido para usar o parâmetro do endpoint, e adicionado filtro explícito `bp.tenant_id = $2` (isolamento de tenant na subquery, não só no `WHERE` externo).

4. **Constraint real, não "ausência total de proteção":** existe `EXCLUDE USING gist (tenant_id, member_id, daterange(valid_from, valid_until, '[]')) WHERE status='active'` (`079...sql:39-45`) que impede duas políticas *vigentes ao mesmo tempo*. O risco real do `LEFT JOIN` ingênuo não é concorrência de vigência — é que `ConfirmGroupPaymentUseCase` fecha a política antiga só com `valid_until = CURRENT_DATE - 1` (linha ~170), **sem** mudar `status` para `canceled`; a política antiga fica com `status='active'` e `valid_until` no passado. Um `JOIN` sem filtro de data pegaria as duas. O `LATERAL` com filtro de vigência (item 3.1, agora parametrizado pelo mês) já resolve isso.

5. **Auditoria da taxa aplicada** (decisão do usuário: incluir). Nova migration adiciona a `group_payments` e `financial_payments`:

   ```sql
   ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS card_installments SMALLINT;
   ALTER TABLE group_payments ADD COLUMN IF NOT EXISTS applied_fee_bps INT;
   ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS card_installments SMALLINT;
   ALTER TABLE financial_payments ADD COLUMN IF NOT EXISTS applied_fee_bps INT;
   ```

   Nullable (pagamento em dinheiro/PIX/débito não tem parcelas nem taxa sugerida). `ConfirmGroupPaymentInput` ganha `cardInstallments?: number` e `appliedFeeBps?: number` opcionais, gravados tal como recebidos (o backend não recalcula nada, só registra o que o front usou pra sugerir — a fonte da verdade financeira continua sendo `netAmountCents` digitado/confirmado pelo operador).

   **Crítico:** `protect_financial_payments_immutability()` (`080_add_net_amount_to_payments.sql:57-79`) lista explicitamente as colunas protegidas contra edição via `IS DISTINCT FROM`. As 2 colunas novas em `financial_payments` **precisam entrar nessa lista** (`CREATE OR REPLACE FUNCTION`, mesmo padrão já usado em 057/080) — senão ficam editáveis depois de gravadas, quebrando a própria garantia de auditoria que este item existe para dar.

## 12. Escopo final consolidado

- Migration `084`: `tenants.card_fee_rates` (JSONB) + `card_installments`/`applied_fee_bps` em `group_payments` e `financial_payments` + trigger de imutabilidade atualizado.
- Backend: `listGroupMembers`/`listGroupPayments` com LATERAL parametrizado por mês + fix do `course_upfront`; cadeia completa do perfil para `cardFeeRates` (schema, use case, controller, domínio, repositório, rota GET); `ConfirmGroupPaymentUseCase`/schema aceitando `cardInstallments`/`appliedFeeBps` opcionais.
- Frontend: `billingTypeLabel()` compartilhado + coluna "Tipo" em Pagamentos; `FinancialSummary` com 4 KPIs; seção de taxas em `ProfileSettings`; `ConfirmPaymentModal` com campo de parcelas + sugestão com fórmula correta em bps.

## 10. Não-quebra

- Migration aditiva, nullable, sem default obrigatório.
- `listGroupPayments`/`listGroupMembers` ganham campos, não removem nem renomeiam nada existente.
- Nenhuma mudança no contrato do endpoint de confirmação de pagamento (`netAmountCents` continua opcional, do jeito que já é).
