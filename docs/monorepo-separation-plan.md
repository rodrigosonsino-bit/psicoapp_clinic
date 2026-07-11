# Separação do Monorepo (PsicoApp + Scheduler) em 2 Repositórios — Plano

## Contexto e motivação

Decisão do usuário (2026-07-11): separar completamente `apps/psychotherapy-*`
(PsicoApp) de `apps/scheduler-*` (Scheduler) em 2 repositórios Git
independentes, sem contato entre eles.

**Motivação real, na ordem em que surgiu na conversa:**
1. Hipótese inicial (minha, descartada): "só isolar configs de deploy
   dentro do monorepo já resolveria" — bugs reais recentes (Railway
   construindo `Dockerfile.scheduler` errado, Vercel com Root Directory na
   raiz ignorando `vercel.json` de subpasta) eram sintomas de config de
   deploy mal isolada, corrigíveis sem separar repositório.
2. **Motivo decisivo, do usuário**: agentes de IA (Claude, e principalmente
   o segundo agente "Antigravity" que opera no mesmo working tree) já
   confundiram os dois apps múltiplas vezes, fazendo mudança de um produto
   no lugar errado. Existe até uma convenção documentada só pra mitigar
   isso ("Como Classificar uma Feature Nova: Scheduler vs. Psychotherapy",
   ver [[non-breaking-changes]]/[[scheduler-architecture]]) — o fato de
   precisar de uma convenção pra evitar confusão já é sintoma do problema.
   Uma convenção é uma guarda fraca (depende do agente lembrar de segui-la);
   repositórios físicos separados são uma guarda estrutural (o agente
   simplesmente não vê o outro app).

## Estado atual do monorepo (mapeado nesta sessão, 2026-07-11)

- **Repo único**: `rodrigosonsino-bit/psicoapp` no GitHub, branch `master`.
- **Apps**:
  - `apps/psychotherapy-api` + `apps/psychotherapy-web` — PsicoApp.
    Migrations SQL sequenciais (`001`-`089`), banco **Neon**
    (`weathered-sunset-87453623`).
  - `apps/scheduler-api` + `apps/scheduler-web` (+ wrapper Electron
    desktop) — Scheduler. Migrations `node-pg-migrate` (JS, timestamp),
    banco **Postgres próprio do Railway** (projeto `Whatsapp_agendamento`,
    NÃO é o Neon — só o `.env` local aponta pro Neon por conveniência de
    dev, produção usa bancos fisicamente diferentes já hoje).
  - `packages/whatsapp-core` — cliente Baileys compartilhado
    (`WhatsappSessionManager`, `WhatsappClient`), usado pelos dois backends.
- **Deploy — já são serviços/projetos separados na prática**:
  - PsicoApp: Vercel (frontend) + Railway projeto `psicoapp-backend`,
    serviço `backend` (API).
  - Scheduler: Railway projeto `Whatsapp_agendamento`, serviços
    `whatsapp-scheduler-backend` + `Postgres` + `Redis`.
  - **Ou seja, o deploy já não é compartilhado hoje** — a separação de
    repositório não muda infraestrutura de hosting, só a origem do código
    (`repo:` em cada serviço Railway/Vercel aponta hoje pro monorepo único;
    precisa passar a apontar pro repo dedicado de cada um).
- **Acoplamento real que sobrevive à separação** (não é bug de monorepo,
  é regra de negócio):
  - **Regra de ouro do socket Baileys (Erro 440)**: os dois produtos usam
    a mesma sessão/número de WhatsApp via Baileys — não podem abrir conexão
    simultânea. Scheduler é o dono; PsicoApp roda com
    `DISABLE_WHATSAPP_BOOT=true`. Isso é uma restrição de **negócio**
    (mesmo WhatsApp Business), não de código — continua existindo depois
    da separação, só não tem mais nada "estrutural" (código/repo) impondo
    isso; vira 100% depender de env var configurada certa em cada serviço.
  - **Filtro de lembrete duplicado via Google Calendar**: Scheduler pula
    calendários chamados `sessões_terapia`/`sessoes_terapia` (comparação de
    string) pra não duplicar lembrete que o PsicoApp já manda. Isso é lógica
    do próprio Scheduler sabendo de uma convenção de nome do outro produto —
    não é comunicação em tempo real entre os dois, só uma convenção de
    nomenclatura. Sobrevive à separação sem mudança.
- **Acoplamento que a separação elimina**:
  - Confusão de agente de IA entre os dois apps (motivo principal).
  - Ambiguidade de Root Directory/config de deploy na raiz do monorepo
    (causa direta dos 2 incidentes reais desta sessão: Railway/Dockerfile,
    Vercel/rewrite).
  - Numeração de migration precisando checar "a maior de todo o repo,
    incluindo untracked" — vira só relevante dentro do próprio repo de cada
    produto (já eram bancos diferentes, então isso sempre foi um cuidado
    cosmético, não técnico).
  - Git status/diff misto entre trabalho do Antigravity num app e do
    Claude Code no outro, no mesmo working tree.

## Decisão: histórico de git — recomendação é começar do zero por repo

Duas opções levantadas, **nenhuma decidida ainda pelo usuário**:

**Opção A — `git filter-repo`/`subtree split`** (preserva histórico/blame):
extrai o histórico de commits que tocaram `apps/psychotherapy-*` +
`packages/whatsapp-core` pra um repo novo, e o de `apps/scheduler-*` +
`packages/whatsapp-core` pro outro (cada um leva uma cópia da história de
`whatsapp-core`, já que os dois app tocaram nesse pacote). Mais fiel, mais
complexo de executar sem erro (path rewriting, risco de perder algo),
precisa validação cuidadosa pós-migração.

**Opção B — começar do zero por repo** (só o estado atual, sem histórico):
copiar os arquivos de hoje pra 2 repos novos como 1º commit, sem tentar
preservar `git blame`. Muito mais simples e seguro de executar. **Perda de
histórico é mitigada pelo fato de que a maior parte do "porquê" das decisões
já está capturada narrativamente** no notebook NotebookLM
(`f96a5ea7-c051-46e6-b5a2-945a2fccf8aa`, ver [[notebooklm_reference]]) e
neste sistema de memória — não depende só do `git log`/`git blame` pra
reconstruir contexto.

**Recomendação**: Opção B, pelo perfil do projeto (solo/poucos
colaboradores, decisões já documentadas fora do git). Manter o monorepo
atual **arquivado** (renomear no GitHub, ex.
`psicoapp-monorepo-archive-2026`, sem apagar) como referência histórica
consultável se algum dia precisar de um commit antigo específico.

**Isso precisa ser confirmado com o usuário antes de executar** — é a
primeira decisão bloqueante da implementação.

## `packages/whatsapp-core` — duplicar, não publicar

Cada repo novo recebe uma **cópia própria** do código-fonte atual de
`packages/whatsapp-core` (não um pacote npm publicado/versionado — custo de
manutenção desproporcional pro tamanho do time). Aceita-se o risco de
divergência: se um bug for corrigido no Baileys de um lado, precisa
lembrar de aplicar no outro também.

**Mitigação leve, sem ferramenta nova**: registrar essa regra na memória
(feita nesta sessão, ver seção de handoff abaixo) — "ao mexer em
`packages/whatsapp-core` em qualquer um dos 2 repos, verificar se o outro
repo tem o mesmo bug/melhoria aplicável."

**Nota de simplificação futura, fora de escopo desta separação**: o
PsicoApp já migrou lembretes 1:1 pra WhatsApp Cloud API oficial
especificamente pra se afastar da instabilidade do Baileys (ver
[[project_status]]) — o `PaymentReceiptHandler` (leitor de comprovante via
foto) é hoje o único uso real de Baileys no lado do PsicoApp, e está
dormant em produção (`DISABLE_WHATSAPP_BOOT=true`). Pode valer a pena, numa
sessão futura, avaliar se vale eliminar a dependência de `whatsapp-core`
do lado do PsicoApp por completo (migrar `PaymentReceiptHandler` pra usar
webhook da Cloud API em vez de Baileys) — isso removeria a necessidade de
manter 2 cópias do pacote. Não faz parte desta separação, só uma
observação pra revisitar depois.

## Redistribuição de arquivos de nível raiz

- `scripts/check_rodrigo.js` (consulta tenant no Neon) → repo do PsicoApp.
- `docs/*.md` — todos são do PsicoApp por conteúdo, vão pra esse repo:
  `availability-recurrence-modality-prompt.md`,
  `broadcast-message-plan.md`, `pastoral-appointments-prompt.md`,
  `group-billing-package-vs-monthly-plan.md`,
  `bank-statement-reconciliation-plan.md` (plano em andamento, ver seção
  de handoff),
  `monorepo-separation-plan.md` (este arquivo — pode ficar num dos dois ou
  em ambos como referência histórica da decisão).
- `package.json` raiz (script `build` agregando os dois apps, causa direta
  do incidente de Vercel documentado em [[non-breaking-changes]]) — não
  migra, cada repo novo tem seu próprio `package.json` simples, sem
  agregação entre produtos.
- `Dockerfile.scheduler` (raiz, o que o Railway realmente usa hoje pro
  Scheduler, corrigido nesta sessão pra copiar `public/`/`migrations`) →
  repo do Scheduler, idealmente virando o único Dockerfile dali (eliminando
  a duplicidade com `apps/scheduler-api/Dockerfile`, que hoje é ignorado
  pelo Railway — ver [[project_status]] seção "Railway servia Not Found").

## Ordem de execução recomendada (incremental, sem downtime)

1. **Decisão bloqueante com o usuário**: Opção A ou B de histórico de git
   (ver seção acima).
2. Criar os 2 repositórios novos no GitHub (vazios).
3. Popular cada repo (cópia de arquivos ou filter-repo, conforme decisão),
   incluindo a cópia duplicada de `packages/whatsapp-core` em cada um.
4. Cada repo com seu próprio `package.json`/`railway.toml`/`Dockerfile`/
   `vercel.json` autocontido — sem nenhuma referência a `apps/` de outro
   produto.
5. **Validar build isolado de cada repo novo antes de tocar em produção**:
   `npm ci && npm run build` local, e um deploy de teste (branch/preview,
   não produção) em cada plataforma, confirmando que builda sozinho sem
   depender de nada do monorepo antigo.
6. **Corte de produção** (momento de risco real, fazer com o usuário
   presente, mesmo rigor já usado nesta sessão pro fix do Railway):
   repointar `repo:` de cada serviço Railway (`psicoapp-backend`/`backend`,
   `Whatsapp_agendamento`/`whatsapp-scheduler-backend`) e do projeto Vercel
   pro repositório novo correspondente, um de cada vez, confirmando deploy
   `Ready`/`Online` e smoke test (mesmo processo de verificação de hash de
   bundle já documentado) antes de seguir pro próximo serviço.
7. Confirmar variáveis de ambiente/segredos de cada serviço sobreviveram ao
   repoint (normalmente são por serviço, não por conexão de repo, mas
   validar na prática).
8. **Arquivar o monorepo antigo** no GitHub (rename, não deletar) — só
   depois de confirmar os 2 repos novos em produção estáveis por alguns
   dias.
9. **Avisar/redirecionar o agente Antigravity** pros novos repos — ele
   opera de forma independente no mesmo working tree local hoje; precisa
   ser informado da migração (fora do escopo de algo que o Claude Code
   consiga fazer sozinho — é uma ação do usuário na UI do Antigravity).

## Riscos e pontos de atenção

- **Corte de produção (passo 6) é a única etapa genuinamente arriscada** —
  os passos 1-5 são reversíveis/não tocam produção. Fazer com confirmação
  explícita do usuário antes, um serviço de cada vez, não os 2 de uma vez.
- Variáveis de ambiente/segredos: conferir que não há nada hardcoded
  assumindo a estrutura de monorepo (paths relativos cruzando `apps/`).
- Depois da separação, `git status`/`git diff` antes de editar arquivos
  centrais (regra hoje documentada por causa do Antigravity) deixa de ser
  necessária entre produtos — mas continua válida dentro de cada repo
  individualmente se o Antigravity continuar operando lá.

## Handoff — estado no fim desta sessão (2026-07-11), pra continuar em outra

**O que foi decidido, não implementado ainda:**
- Separar o monorepo em 2 repos (este documento) — usuário concordou com a
  ideia, plano escrito, **implementação não iniciada**. Falta decidir
  histórico de git (Opção A vs B, seção acima) antes de começar.

**Item em paralelo, também não implementado, com uma pendência técnica
travada nesta sessão:**
- Plano de conciliação de extrato bancário (Nubank CSV/OFX) →
  `docs/bank-statement-reconciliation-plan.md` (v7). Lógica financeira
  (schema, gates, transação atômica) **aprovada pelo Codex CLI** após
  várias rodadas. A ingestão mudou de PDF (v6) pra CSV/OFX (v7) depois que
  o usuário confirmou disponibilidade de CSV/OFX e forneceu um extrato real
  de teste (96 transações, conta pessoal) que validou um FITID real e
  estável. **Falta**: uma rodada final de auditoria Codex confirmando a
  seção de parsing CSV/OFX da v7 — **travada nesta sessão por um bug de
  ambiente** (`codex exec` em background ficou preso indefinidamente sem
  produzir output, 3 tentativas, processos `codex.exe` órfãos que não
  consegui encerrar via `taskkill` do shell sandboxed; `codex exec` em
  primeiro plano com prompt trivial funcionou normalmente, então não é
  falta de créditos/autenticação — parece específico a esse prompt/modo
  background nesse ambiente). **Próximo passo real**: tentar de novo a
  auditoria da v7 (talvez em primeiro plano, ou dividindo o prompt em
  partes menores) antes de começar a implementação do parser.
- Também combinado com o usuário: se um dia formos automatizar a ingestão
  do extrato por e-mail (fase 2, não iniciada), usar o alias
  `rodrigosonsino+nubank@gmail.com` (Gmail, já configurado pelo usuário no
  app do Nubank) como fonte, com recomendação de e-mail dedicado por
  segurança se o alias não for suficiente.

**Como retomar**: ler este arquivo inteiro, mais
`docs/bank-statement-reconciliation-plan.md` (v7) se for continuar aquele
fio, mais a memória do projeto (`project_status.md`,
`non-breaking-changes.md`, `scheduler-architecture.md`) pra contexto geral.
Perguntar ao usuário qual dos dois fios retomar primeiro (separação de
repos ou conciliação bancária) — são independentes entre si.
