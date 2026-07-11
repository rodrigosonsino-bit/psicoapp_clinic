# Plano revisado — Mensagem em massa para pacientes ativos

**Status:** revisado e ainda não aprovado para implementação  
**Veredito do plano original:** **Reprovado**  
**Apps afetados:** `apps/psychotherapy-api` e `apps/psychotherapy-web`  
**Reuso:** `WhatsappSessionManager` de `packages/whatsapp-core`; sem reutilizar a fila `whatsapp-messages`

## 1. Resultado da auditoria

### 1.1 Riscos arquiteturais

1. **Bloqueante — a integração com a fila descrita no plano original não funciona.**
   `BullMQMessageScheduler.schedule()` rejeita mensagens sem `id` persistido e enfileira somente `{ messageId }`. O worker que consome essa fila busca o ID em `scheduled_messages`. O `psychotherapy-api` não possui `IMessageRepository`, não registra Redis ou `IMessageSchedulerService` no container e não inicializa esse worker. Apenas construir um payload “ScheduledMessage-like” não é suficiente.
2. **Acoplamento indevido entre aplicações.**
   `scheduled_messages`, seu repositório e o worker pertencem ao `scheduler-api`. Fazer o `psychotherapy-api` gravar diretamente nessa estrutura criaria dependência de banco e de topologia de deploy não formalizada. O Docker Compose do `psychotherapy-api`, isoladamente, não sobe o worker do `scheduler-api`.
3. **Dual write sem recuperação.**
   Persistir auditoria no PostgreSQL e depois publicar no Redis, sem outbox/reconciliação, permite campanhas registradas mas nunca enfileiradas — ou jobs publicados sem auditoria correspondente.
4. **Throttling por `delayMs = index * intervalo` não limita a taxa real.**
   Retries, reinício do Redis, jobs atrasados e múltiplas instâncias podem concentrar envios. O limite deve existir no consumidor, não apenas no horário inicial do job.
5. **Entrega exatamente uma vez não é garantida.**
   Se o processo enviar ao WhatsApp e cair antes de persistir `sent`, um retry pode duplicar a mensagem. Idempotência HTTP evita campanhas duplicadas, mas não resolve essa janela de falha.
6. **Risco operacional do WhatsApp permanece alto.**
   Nenhum intervalo torna automação via Baileys “segura contra ban”. Limite, feature flag, rollout gradual, telemetria e cancelamento são obrigatórios. O lote inicial de 200 destinatários é agressivo sem histórico operacional.
7. **Topologia de sessões não foi validada.**
   O envio deve ocorrer no processo que é proprietário do `WhatsappSessionManager`. Escalar réplicas sem ownership de sessão por tenant pode causar disputa de sessão e jobs executados na réplica errada.
8. **Privacidade e consentimento foram ignorados.**
   Paciente ativo não equivale a autorização para mensagem em massa. O conteúdo pode conter dado sensível e aparecer em notificações. É necessário opt-in específico, opt-out e política de retenção; validação jurídica continua sendo uma pendência externa.

### 1.2 Modelagem de dados

1. A tabela original `broadcast_messages` mistura campanha e destinatário: repete o conteúdo N vezes e não representa o broadcast como agregado.
2. Faltam FKs para tenant e paciente, `CHECK` de status, índices operacionais, timestamps de processamento, contador de tentativas, erro, telefone congelado e chave de idempotência.
3. `status VARCHAR(20)` apenas comentado não garante integridade.
4. Não há proteção contra associação de paciente de outro tenant.
5. Não há migration de rollback, embora o runner do projeto exija arquivo correspondente em `migrations/down`.
6. Usar somente o telefone atual do paciente destrói a auditabilidade se o cadastro mudar depois. O destinatário deve guardar `phone_snapshot` e `patient_name_snapshot`.

### 1.3 Backend

1. O use case proposto depende de uma abstração que não está disponível no composition root.
2. Falta transação para congelar a lista de destinatários e criar a campanha atomicamente.
3. Falta chave de idempotência para duplo clique, retry do browser e timeout após aceite da API.
4. Falta contrato de erro para WhatsApp desconectado, lote vazio, lote acima do limite, telefone inválido, campanha concorrente e indisponibilidade da fila.
5. Falta cancelamento, consulta de progresso e reconciliação pós-crash.
6. O plano amplia ainda mais `IPsychotherapyRepository`, que já concentra muitas responsabilidades. Broadcast deve possuir repositório próprio.
7. `authMiddleware` identifica o tenant, mas isso não substitui limite por tenant e validação de ownership em todas as consultas.

### 1.4 Frontend

1. O botão não deve ficar próximo ao link `wa.me` de uma linha da tabela; a ação é global e deve ficar no cabeçalho da página.
2. A tela lista apenas uma página de 20 pacientes. O contador e os destinatários nunca podem ser derivados do estado local da tabela.
3. “Reaproveitar a resposta do broadcast” não permite confirmação informada: a campanha já teria sido criada. É necessário preview read-only antes do POST.
4. Faltam prevenção de duplo envio, estados de aceite/processamento e tratamento de resultado parcial.
5. O modal precisa de `role="dialog"`, nome acessível, foco inicial, focus trap, fechamento por `Escape`, labels e devolução do foco ao botão de origem.
6. Polling sem intervalo e encerramento definidos pode causar renderizações e tráfego desnecessários.

### 1.5 Pontos cegos e suposições não verificadas

- Formato canônico de telefone, especialmente inclusão do DDI `55`.
- Consentimento para comunicação coletiva e mecanismo de opt-out.
- Regra para `reminder_channel = 'none'`; ela não deve ser interpretada automaticamente como consentimento ou recusa de broadcast.
- Quantidade média e máxima de pacientes por tenant.
- Se mensagens de broadcast consomem quota do plano comercial.
- Quantas réplicas do backend executam em produção e qual delas mantém cada socket Baileys.
- Comportamento desejado para destinatários em estado `delivery_unknown`.
- Retenção do texto e dos telefones usados na campanha.
- Conteúdo permitido: comunicação administrativa versus conteúdo clínico/marketing.

### 1.6 Veredito

**Reprovado.** A proposta original possui falha funcional na integração com a fila, ausência de idempotência e recuperação transacional, modelagem insuficiente e risco de envio sem consentimento. Esses pontos podem gerar campanha perdida, duplicidade, vazamento de informação sensível e bloqueio da conta de WhatsApp.

---

## 2. Arquitetura revisada

### 2.1 Decisões

1. O `psychotherapy-api` será o proprietário do fluxo de broadcast porque já inicializa o `WhatsappSessionManager` usado por seus tenants.
2. Será criada uma fila BullMQ dedicada, `psychotherapy-broadcast-recipients`. A fila `whatsapp-messages` não será reutilizada: seu contrato exige `scheduled_messages` e um worker pertencente ao `scheduler-api`.
3. PostgreSQL será a fonte de verdade. As linhas de destinatários funcionarão como outbox; um dispatcher reconciliável publicará jobs com `jobId` estável.
4. A API apenas cria a campanha e retorna `202 Accepted`. O envio ocorrerá fora do request HTTP.
5. A taxa será aplicada no worker. Para a primeira versão, usar um limite global conservador da fila; rate limit por tenant fica para uma evolução após validar a topologia de sessões.
6. Não prometer exatamente uma vez. Um envio cuja confirmação ficou ambígua irá para `delivery_unknown` e não será reenviado automaticamente.
7. Só entram no snapshot pacientes ativos, não excluídos, com telefone válido e opt-in explícito para broadcast.
8. A v1 só pode ser habilitada com uma única réplica proprietária das sessões e do worker. Se produção usar múltiplas réplicas, ownership/roteamento por tenant ou um processo exclusivo de WhatsApp passa a ser pré-requisito, não trabalho futuro opcional.

### 2.2 Defaults operacionais iniciais

Configurar por ambiente, com validação no bootstrap:

```env
ENABLE_BROADCAST_MESSAGES=false
BROADCAST_WORKER_ENABLED=false
BROADCAST_MAX_RECIPIENTS=50
BROADCAST_INTERVAL_MS=12000
BROADCAST_MAX_ATTEMPTS=5
BROADCAST_RECONCILIATION_MS=30000
BROADCAST_SENDING_LEASE_MS=120000
BROADCAST_RETENTION_DAYS=90
PHONE_DEFAULT_COUNTRY_CODE=55
```

Em produção, rejeitar `BROADCAST_INTERVAL_MS < 5000`. Esses valores são limites de rollout, não garantia contra bloqueio do WhatsApp. Aumentar lote ou reduzir intervalo somente após medir falhas, desconexões e feedback dos destinatários.

## 3. Modelagem e migrations

Criar `041_broadcast_messages.sql` e `migrations/down/041_broadcast_messages.sql`.

### 3.1 Consentimento no paciente

Adicionar a `psychotherapy_patients`:

```sql
whatsapp_bulk_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
whatsapp_bulk_opt_in_at TIMESTAMPTZ,
whatsapp_bulk_opt_out_at TIMESTAMPTZ
```

Não marcar registros existentes como opt-in durante a migration.

### 3.2 Campanhas

Criar `psychotherapy_broadcasts` com:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`;
- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`;
- `idempotency_key UUID NOT NULL`;
- `content TEXT NOT NULL` com `CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000)`;
- `status` com `CHECK` para `queued`, `processing`, `completed`, `partial_failed`, `canceled`;
- `created_at`, `started_at`, `completed_at`, `canceled_at`;
- `UNIQUE (tenant_id, idempotency_key)` e `UNIQUE (id, tenant_id)`.

Índice: `(tenant_id, created_at DESC)`.

O status da campanha é uma projeção dos destinatários. Os estados individuais são a fonte autoritativa e a reconciliação deve corrigir a projeção.

### 3.3 Destinatários/outbox

Criar `psychotherapy_broadcast_recipients` com:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`;
- `broadcast_id UUID NOT NULL`;
- `tenant_id UUID NOT NULL`;
- `patient_id UUID NOT NULL`;
- `patient_name_snapshot VARCHAR(255) NOT NULL`;
- `phone_snapshot VARCHAR(20) NOT NULL` em formato canônico;
- `status` com `CHECK` para `queued`, `sending`, `retry_wait`, `sent`, `failed`, `delivery_unknown`, `canceled`;
- `attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`;
- `next_attempt_at`, `locked_at`, `sent_at`, `created_at`;
- `last_error_code VARCHAR(80)` e `last_error_message TEXT` sem stack trace ou segredo;
- `UNIQUE (broadcast_id, patient_id)`;
- FK composta `(broadcast_id, tenant_id)` para `psychotherapy_broadcasts(id, tenant_id)` com `ON DELETE CASCADE`;
- FK composta `(patient_id, tenant_id)` para `psychotherapy_patients(id, tenant_id)`.

Índices:

- `(broadcast_id, status)`;
- parcial `(next_attempt_at, id) WHERE status IN ('queued', 'retry_wait')`;
- parcial `(locked_at) WHERE status = 'sending'`.

O nome e telefone em snapshot preservam o destino efetivo mesmo se o paciente for editado depois. Conteúdo, telefone e nome não devem aparecer em logs. Após `BROADCAST_RETENTION_DAYS`, um job deve redigir conteúdo e snapshots ou excluir a campanha conforme política aprovada.

## 4. Backend

### 4.1 Separação de camadas

Criar:

- `domain/repositories/IBroadcastRepository.ts`;
- `infrastructure/repositories/PostgresBroadcastRepository.ts`;
- `application/services/PhoneNormalizer.ts`;
- `application/useCases/PreviewBroadcastUseCase.ts`;
- `application/useCases/CreateBroadcastUseCase.ts`;
- `application/useCases/GetBroadcastUseCase.ts`;
- `application/useCases/CancelBroadcastUseCase.ts`;
- `infrastructure/queue/BroadcastQueue.ts`;
- `infrastructure/queue/BroadcastOutboxDispatcher.ts`;
- `infrastructure/queue/BroadcastWorker.ts`;
- `presentation/controllers/BroadcastController.ts`.

Registrar repositório, conexão Redis, queue, dispatcher e worker no composition root. Adicionar `bullmq` como dependência direta do `psychotherapy-api`; não depender de hoisting transitivo do workspace.

### 4.2 Seleção e normalização

A consulta de elegibilidade deve aplicar no banco:

```sql
tenant_id = $1
AND status IN ('weekly', 'biweekly', 'one_off')
AND deleted_at IS NULL
AND whatsapp_bulk_opt_in = TRUE
AND phone IS NOT NULL
AND btrim(phone) <> ''
```

Não usar apenas `status != 'inactive'`, pois isso incluiria silenciosamente qualquer status futuro.

O `PhoneNormalizer` deve remover caracteres de formatação, aplicar o DDI padrão somente segundo regra configurada e rejeitar comprimentos inválidos. Não “corrigir” número ambíguo. Preview e criação devem usar exatamente a mesma implementação.

### 4.3 Preview

`PreviewBroadcastUseCase` retorna contagens, não dados pessoais:

```json
{
  "eligible": 37,
  "excluded": {
    "inactive": 8,
    "deleted": 1,
    "withoutPhone": 3,
    "invalidPhone": 2,
    "withoutOptIn": 11
  },
  "maxRecipients": 50
}
```

O preview é informativo. O snapshot definitivo é criado no POST e a resposta pode apresentar total diferente se cadastros mudarem nesse intervalo.

### 4.4 Criação transacional e idempotente

`CreateBroadcastUseCase` deve:

1. validar feature flag, tenant, conteúdo, conexão atual do WhatsApp e limite de campanha;
2. exigir `Idempotency-Key` UUID no header;
3. impedir mais de uma campanha não terminal por tenant e aplicar cooldown por tenant;
4. abrir transação;
5. obter a campanha existente pela chave ou criar `psychotherapy_broadcasts`;
6. selecionar e bloquear logicamente os destinatários elegíveis, normalizar telefones e inserir o snapshot em lote;
7. rejeitar lote vazio ou acima do limite antes do commit;
8. fazer commit;
9. sinalizar o dispatcher, sem tornar o sucesso HTTP dependente da publicação imediata no Redis.

Retry com a mesma chave retorna a campanha existente e nunca cria um segundo snapshot.

### 4.5 Outbox, worker e consistência

1. O dispatcher consulta destinatários `queued`/`retry_wait` vencidos e publica jobs com `jobId = broadcast-recipient-{id}`.
2. Reinício ou falha entre commit e Redis é recuperado pela varredura periódica. Publicação repetida é deduplicada pelo `jobId` e pela transição condicional no banco.
3. Jobs usam `attempts: 1` e remoção após conclusão/falha; tentativas e backoff pertencem ao estado persistido, não ao contador volátil do BullMQ.
4. Antes de enviar, o worker faz claim atômico `queued|retry_wait -> sending`, incrementa tentativa e grava lease. Se a linha já estiver terminal, o job termina sem envio.
5. O worker consulta novamente se a campanha foi cancelada imediatamente antes de chamar o WhatsApp.
6. O worker usa o `WhatsappSessionManager` do `psychotherapy-api` e aplica limiter real de um envio por `BROADCAST_INTERVAL_MS`, inicialmente com `concurrency = 1`.
7. Em sucesso, persiste `sent` e `sent_at`.
8. Em erro conhecido antes de confirmação, persiste `retry_wait` com backoff exponencial e jitter. Ao atingir o máximo, persiste `failed`.
9. Uma lease `sending` expirada é marcada `delivery_unknown`; não deve voltar automaticamente para a fila, evitando duplicidade após crash na janela pós-envio.
10. A campanha vira `completed` quando todos forem `sent`, `partial_failed` quando houver estado terminal diferente de `sent`, e `processing` enquanto houver trabalho.
11. O processo deve fechar worker, queue e Redis no shutdown gracioso.

Trade-off aceito na v1: o limiter global serializa tenants e reduz throughput. É mais seguro que permitir bursts e evita inventar isolamento por tenant antes de validar ownership das sessões.

### 4.6 Cancelamento

Cancelar deve:

- mudar a campanha para `canceled`;
- mudar apenas destinatários `queued`/`retry_wait` para `canceled`;
- tentar remover jobs correspondentes da fila;
- nunca afirmar que mensagens `sending`, `sent` ou `delivery_unknown` foram canceladas.

### 4.7 Contratos HTTP

Todas as rotas ficam depois de `router.use(authMiddleware)`:

```text
GET  /api/psychotherapy/broadcasts/preview
POST /api/psychotherapy/broadcasts
GET  /api/psychotherapy/broadcasts/:id
GET  /api/psychotherapy/broadcasts?limit=20
POST /api/psychotherapy/broadcasts/:id/cancel
```

Body do POST:

```json
{ "message": "Texto entre 1 e 1000 caracteres" }
```

Resposta `202`:

```json
{
  "data": {
    "id": "uuid",
    "status": "queued",
    "totalRecipients": 37,
    "createdAt": "2026-06-28T12:00:00.000Z"
  }
}
```

Erros mínimos: `400` validação/lote vazio, `401` autenticação, `404` campanha de outro tenant, `409` campanha ativa ou WhatsApp desconectado, `422` lote acima do limite e `503` feature/infra indisponível. Não devolver telefone, conteúdo ou erro interno nos endpoints de listagem.

Adicionar limite específico por tenant para criação de campanha; o rate limiter global por IP já existente não é suficiente.

## 5. Frontend

1. Adicionar botão global “Nova mensagem em massa” no cabeçalho de `Patients.tsx`, ao lado de “Novo Paciente”. Não colocá-lo em uma linha de paciente.
2. Extrair `BroadcastMessageDialog` em componente próprio; não aumentar ainda mais o componente `Patients`.
3. Ao abrir, buscar preview no backend e mostrar elegíveis, excluídos e limite. Não derivar contagem da página atual.
4. Exigir confirmação explícita com o total definitivo esperado e avisar que o processamento é assíncrono e não pode desfazer mensagens já enviadas.
5. Gerar uma chave UUID ao iniciar cada tentativa lógica e reutilizá-la em retries. Gerar nova chave somente após sucesso terminal ou cancelamento deliberado.
6. Desabilitar submit enquanto o POST estiver pendente. Após `202`, mostrar “campanha aceita”, não “mensagens enviadas”.
7. Consultar o status a cada 5 segundos somente enquanto o modal/histórico estiver visível e a campanha não for terminal; interromper em unmount.
8. Exibir `sent`, `failed`, `delivery_unknown`, `canceled` e total sem listar telefones.
9. Implementar acessibilidade do dialog: `role="dialog"`, `aria-modal`, título associado, labels, focus trap, `Escape`, foco inicial e restauração de foco.
10. Tratar `409`, `422` e `503` com mensagens específicas e manter o texto digitado para retry seguro.

Também adicionar os campos de opt-in/opt-out ao formulário de paciente, com texto claro de consentimento. Não acoplar esse consentimento ao canal de lembretes existente.

## 6. Segurança, privacidade e observabilidade

- Não registrar texto, telefone, nome ou payload completo em logs.
- Logs estruturados devem conter apenas `tenantId`, `broadcastId`, `recipientId`, transição de estado, tentativa, duração e código de erro sanitizado.
- Métricas: campanhas criadas, enviados, falhas, `delivery_unknown`, profundidade/fase mais antiga da fila, latência e desconexões por tenant.
- Alertar em aumento de falhas/desconexões e pausar automaticamente uma campanha após limiar configurável de falhas consecutivas.
- Proibir conteúdo vazio e definir no produto se conteúdo clínico ou promocional é permitido. A recomendação para v1 é limitar a comunicação administrativa.
- Aplicar retenção e controle de acesso ao histórico. Confirmar requisitos jurídicos antes de habilitar em produção.

## 7. Testes obrigatórios

### Unitários

- seleção explícita dos três status ativos;
- exclusão de soft-deleted, sem opt-in, sem telefone e telefone inválido;
- normalização com e sem DDI;
- limite vazio/máximo;
- repetição da mesma `Idempotency-Key`;
- transições válidas de estado e cálculo do status da campanha;
- cancelamento sem alterar `sent`/`sending`.

### Integração

- FKs compostas bloqueiam mistura de tenants;
- criação da campanha e destinatários é atômica;
- falha Redis após commit é recuperada pelo dispatcher;
- job duplicado não envia destinatário terminal;
- retry/backoff e limite de tentativas;
- lease expirada produz `delivery_unknown`, não reenvio;
- limiter impede burst real;
- todas as consultas de campanha filtram `tenant_id`.

### API/E2E

- `401` sem token;
- tenant não acessa campanha de outro tenant;
- `202` e contrato de resposta;
- duplo clique/retry cria uma campanha;
- WhatsApp desconectado retorna `409` sem persistir campanha;
- fluxo preview → criar → acompanhar → cancelar;
- acessibilidade básica e restauração de foco do modal.

## 8. Ordem de implementação e rollout

1. Confirmar topologia de produção: número de réplicas, ownership das sessões e Redis compartilhado. Não habilitar a v1 com mais de uma réplica proprietária de sessão/worker.
2. Aprovar regra de consentimento, conteúdo permitido, quota e retenção.
3. Criar migration `041` e rollback; validar `up -> down -> up` em banco de teste.
4. Implementar repositório e use cases com testes.
5. Implementar Redis, dispatcher, worker, reconciliação e shutdown com testes de falha.
6. Implementar controller, schemas Zod e contratos HTTP.
7. Implementar opt-in e modal acessível no frontend.
8. Publicar com `ENABLE_BROADCAST_MESSAGES=false`.
9. Executar smoke test com tenant controlado e 2–5 números autorizados.
10. Habilitar gradualmente, começando com lote máximo baixo; observar métricas antes de qualquer aumento.

## 9. Critérios de aceite

- Nenhum request HTTP permanece aberto durante os envios.
- Retry do mesmo request não cria campanha duplicada.
- Falha entre PostgreSQL e Redis é recuperada automaticamente.
- Não ocorre burst acima do limiter configurado, inclusive após reinício.
- Nenhum destinatário sem opt-in ou de outro tenant entra no snapshot.
- Crash na janela ambígua não causa reenvio automático.
- Cancelamento impede novos envios ainda não iniciados.
- UI diferencia “aceito”, “enviando”, “concluído”, “parcial” e “cancelado”.
- Migration possui rollback validado.
- Logs não contêm conteúdo ou dados pessoais dos destinatários.

## 10. Fora de escopo da v1

- templates com variáveis;
- anexos;
- agendamento para data futura;
- seleção manual de subconjunto de pacientes;
- limiter justo por tenant;
- retry manual de `delivery_unknown`;
- confirmação de entrega/leitura pelo WhatsApp.
