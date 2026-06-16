# Prompt de Implementação — Agendamento Pastoral Virtual

Implemente a funcionalidade de **Agendamento Pastoral Virtual** no PsicoApp. O objetivo é permitir que o terapeuta agende compromissos pastorais (pela agenda do Google Calendar ou pelo próprio app) que **não geram cobrança**, **não exigem cadastro de paciente** e **não aparecem nos relatórios financeiros**.

Use a abordagem de **Paciente Virtual** descrita abaixo — **sem alterar o schema do banco de dados** (sem migrações, sem colunas novas, sem FKs nullable).

---

## 1. Conceito

- Existe, por tenant, um único paciente "fantasma" chamado `Atendimento Pastoral`, com `status: 'inactive'` (isso já é suficiente para excluí-lo da geração de faturamento mensal — confirmado em `GeneratePsychotherapyMonthUseCase.ts`, que filtra `patients.filter(p => p.status !== 'inactive')`).
- **Identidade estável**: NÃO identifique esse paciente pelo campo `name` (é editável/exibível e pode ser alterado por engano). Use o campo `email` com um sentinel reservado e fixo: `__pastoral_virtual__@internal.psicoapp`. Toda lógica de "é o paciente pastoral?" deve checar esse e-mail, não o nome.
- Eventos do Google Calendar cujo título (campo `summary`) bater com o padrão pastoral (ver seção 3) são associados a esse paciente virtual. O título original completo do compromisso é preservado no campo `notes` do agendamento local, com o prefixo `[PASTORAL_SUMMARY]: `.

---

## 2. Backend

### 2.1 `apps/psychotherapy-api/src/application/useCases/SyncGoogleCalendarEventsUseCase.ts`

**Detecção (regex case-insensitive, com fallback):**
```ts
const PASTORAL_REGEX = /^\[?pastoral\]?:?\s*/i;

private isPastoralEvent(summary: string): boolean {
    return /^\[?pastoral\]?:?\s*/i.test(summary.trim());
}

private extractPastoralTitle(summary: string): string {
    const cleaned = summary.trim().replace(PASTORAL_REGEX, '').trim();
    return cleaned || 'Compromisso Pastoral';
}
```

**Lookup/criação do paciente virtual — método dedicado, SEM passar pelo matcher fuzzy existente** (`findExistingPatient` faz `includes()` de substring e pode colidir com pacientes reais; o caminho pastoral deve ser totalmente isolado):

```ts
private readonly PASTORAL_SENTINEL_EMAIL = '__pastoral_virtual__@internal.psicoapp';

private async findOrCreatePastoralPatient(
    config: GoogleOAuthTokens,
    patients: PsychotherapyPatient[]
): Promise<PsychotherapyPatient> {
    let patient = patients.find(p => p.email === this.PASTORAL_SENTINEL_EMAIL);
    if (!patient) {
        patient = await this.repository.savePatient({
            tenantId: config.tenantId,
            name: 'Atendimento Pastoral',
            status: 'inactive',
            paymentType: null,
            defaultSessionPriceCents: null,
            phone: null,
            email: this.PASTORAL_SENTINEL_EMAIL,
            reminderChannel: 'none'
        });
        patients.push(patient);
        logger.info({ tenantId: config.tenantId, patientId: patient.id }, '⛪ Paciente virtual "Atendimento Pastoral" criado');
    }
    return patient;
}
```

**Interceptar ANTES de `findOrCreatePatient`** — no `syncSingleEvent` e no `syncSeriesGroup`, antes de chamar `this.findOrCreatePatient(...)`, checar `this.isPastoralEvent(event.summary ?? '')`. Se verdadeiro, usar `findOrCreatePastoralPatient` no lugar de `findOrCreatePatient`.

**⚠️ CORREÇÃO CRÍTICA — não deixe o sync apagar a tag pastoral:**

Hoje, em três pontos, o código grava `notes: event.description ?? null` (a descrição do evento, não o título). Para eventos pastorais isso precisa ser `[PASTORAL_SUMMARY]: ${this.extractPastoralTitle(event.summary)}` em vez da descrição — senão, no próximo ciclo de sync (cron periódico), a tag é sobrescrita/apagada e o chip volta a mostrar o nome genérico do paciente virtual. Ajuste os três locais:

1. `syncSingleEvent` — na criação do novo agendamento (`notes: event.description ?? null`).
2. `syncSeriesGroup` — na criação de nova ocorrência de série (`notes: event.description ?? null`).
3. `updateExistingAppointment` — roda em **todo** ciclo de sync, não só na criação. Hoje compara `existingAppt.notes !== (event.description ?? null)` para decidir se atualiza. Para agendamentos do paciente pastoral, essa comparação deve ser feita contra `[PASTORAL_SUMMARY]: ${title}` derivado de `event.summary`, e NUNCA contra `event.description`.

Sugestão de implementação: extraia um helper que, dado `patient` e `event`, retorna o `notes` correto:
```ts
private resolveNotes(patient: PsychotherapyPatient, event: any): string | null {
    if (patient.email === this.PASTORAL_SENTINEL_EMAIL) {
        return `[PASTORAL_SUMMARY]: ${this.extractPastoralTitle(event.summary ?? '')}`;
    }
    return event.description ?? null;
}
```
E use `this.resolveNotes(patient, event)` nos três pontos acima, passando o `patient` já resolvido (pastoral ou normal) para cada chamada.

### 2.2 `apps/psychotherapy-api/src/infrastructure/google/GoogleCalendarService.ts`

No método `syncAppointment`, antes de montar `eventBody`:

```ts
const isPastoral = patientPhone === null && /* identificar via flag passada explicitamente, ver abaixo */;
```

Como este serviço não tem acesso direto ao objeto `PsychotherapyPatient`, ajuste a assinatura de `syncAppointment` para receber um parâmetro explícito `isPastoral: boolean` (calculado pelo chamador comparando `patient.email === PASTORAL_SENTINEL_EMAIL`). Quando `isPastoral` for `true`:

- `summary`: extrair o título original de `appointment.notes` removendo o prefixo `[PASTORAL_SUMMARY]: ` (se o prefixo não estiver presente, usar `appointment.notes` cru ou `'Compromisso Pastoral'` como fallback).
- `description`: **omitir completamente** o bloco de `Paciente:`, `WhatsApp:` e o link de confirmação. Pode usar apenas `appointment.notes` (texto livre, sem o prefixo da tag) ou deixar vazio.

Atualize todos os call-sites de `syncAppointment` (provavelmente em `SavePsychotherapyAppointmentUseCase` ou similar) para passar esse novo parâmetro.

### 2.3 `apps/psychotherapy-api/src/application/useCases/ListPsychotherapyPatientsUseCase.ts` (e/ou repositório)

Adicione um filtro para excluir `email = '__pastoral_virtual__@internal.psicoapp'` da listagem padrão de pacientes (`listPatients` com paginação). Verifique se o filtro deve entrar no use case ou diretamente na query do `PostgresPsychotherapyRepository.listPatients` (preferível: mais eficiente, evita trazer a linha do banco). Adicione constante compartilhada para o sentinel (ex.: em um arquivo `domain/constants.ts` ou exportada do próprio `SyncGoogleCalendarEventsUseCase.ts`) para não duplicar a string mágica em múltiplos arquivos.

---

## 3. Frontend

### 3.1 `apps/psychotherapy-web/src/pages/Appointments.tsx`

- No formulário de criação/edição: adicionar checkbox "Compromisso Pastoral".
- Ao marcar: desabilitar o `<select>` de paciente, fixar internamente o paciente para o virtual (resolva o ID buscando por `email` sentinel na lista de pacientes retornada pela API — se a listagem padrão já filtra o virtual, pode ser necessário um endpoint/flag separado para obtê-lo, ou simplesmente deixar o backend resolver automaticamente quando um campo `isPastoral: true` for enviado no payload de criação, evitando expor o ID do paciente virtual no frontend).
- Ao salvar, formatar `notes` como `[PASTORAL_SUMMARY]: ${tituloDigitado}`.
- Filtrar o paciente virtual (por e-mail sentinel, se vier na lista) do `<select>` de seleção manual.

> Recomendação de design: prefira que o **backend** resolva/crie o paciente virtual a partir de um campo `isPastoral: boolean` + `pastoralTitle: string` no payload de `POST/PUT /appointments`, em vez do frontend precisar conhecer o ID do paciente virtual. Isso mantém o sentinel de identidade só no backend.

### 3.2 `apps/psychotherapy-web/src/components/Calendar/AppointmentChip.tsx`

- Detectar se `appointment.notes` começa com `[PASTORAL_SUMMARY]:`. Se sim, extrair o título e usar como `patientName` exibido (em vez do nome recebido via prop — ou ajustar `WeekGrid.tsx` para já resolver isso, ver 3.3).
- **Cor**: aplique violeta (`#8b5cf6`) como uma camada visual adicional, não substituindo `STATUS_COLOR`. Ex.: mantenha `borderLeftColor: STATUS_COLOR[appointment.status]` para o estado (confirmado/cancelado/etc.), mas adicione uma faixa/indicador extra (ex.: um pequeno ícone ou um segundo `border` na borda superior, ou troque o `background`/um `badge` lateral) na cor violeta para sinalizar "é pastoral" sem perder a informação de status. Não jogue fora a lógica de opacidade reduzida para `canceled`/`no_show`.
- No popover: oculte os botões "Paciente faltou (cobrar)" e qualquer ação de cobrança/WhatsApp quando for pastoral. Mantenha apenas Confirmar/Cancelar/Editar/Excluir.

### 3.3 `apps/psychotherapy-web/src/components/Calendar/WeekGrid.tsx`

- Ajuste a resolução de `patientName` (atualmente provavelmente um lookup por `patientId`) para, quando o `notes` do agendamento tiver o prefixo `[PASTORAL_SUMMARY]:`, retornar o título extraído em vez do nome do paciente.

### 3.4 `apps/psychotherapy-web/src/pages/Patients.tsx`

- Não deve precisar de alteração se o backend já filtra o paciente virtual em `ListPsychotherapyPatientsUseCase`/repositório (item 2.3). Apenas confirme que a página usa esse endpoint padrão e não uma query direta que ignore o filtro.

---

## 4. Constantes compartilhadas

Para evitar duplicar a string mágica do sentinel e do prefixo de notas, centralize em um único local (ex.: `apps/psychotherapy-api/src/domain/constants/pastoral.ts`):
```ts
export const PASTORAL_SENTINEL_EMAIL = '__pastoral_virtual__@internal.psicoapp';
export const PASTORAL_SUMMARY_PREFIX = '[PASTORAL_SUMMARY]: ';
export const PASTORAL_TITLE_REGEX = /^\[?pastoral\]?:?\s*/i;
```
Importe esse arquivo em `SyncGoogleCalendarEventsUseCase.ts`, `GoogleCalendarService.ts` e no use case/rota de criação de agendamento. No frontend, replique apenas o prefixo `[PASTORAL_SUMMARY]: ` (string simples) onde necessário.

---

## 5. Plano de verificação manual

1. **GCal → App**: criar evento `Pastoral: Reunião do Conselho` no Google Calendar. Rodar o sync (ou aguardar o cron). Verificar:
   - Chip aparece roxo, com título "Reunião do Conselho" (não "Atendimento Pastoral").
   - **Rodar o sync uma segunda vez** (ou aguardar o próximo ciclo do cron) e confirmar que o título **não foi apagado/sobrescrito** — esse é o teste que valida a correção crítica.
2. **App → GCal**: criar compromisso pastoral pelo app. Verificar que o evento criado no Google Calendar tem o título correto e a descrição **sem** link de confirmação/WhatsApp.
3. **Financeiro**: gerar o mês de faturamento (`GeneratePsychotherapyMonthUseCase`) e confirmar que nenhum registro é criado para o paciente `Atendimento Pastoral`, e que ele não aparece na lista de pacientes (`/patients`) nem nos dropdowns de faturamento.
4. **Popover**: confirmar que "Paciente faltou (cobrar)" não aparece para agendamentos pastorais, mas Confirmar/Cancelar/Editar/Excluir continuam funcionando.
5. **Série recorrente pastoral**: criar uma série semanal `[PASTORAL] Reunião` no GCal e confirmar que todas as ocorrências importadas mantêm o título e a cor corretamente após dois ciclos de sync.
