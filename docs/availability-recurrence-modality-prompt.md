# Prompt de Implementação — Recorrência e Modalidade na Disponibilidade

Implemente as funcionalidades de **tipo de recorrência** (`avulso`, `semanal`, `quinzenal`) e **modalidade** (`presencial`, `online`, `ambos`) nos slots de disponibilidade do terapeuta no PsicoApp.

Não quebre nenhum slot existente: todos os registros atuais devem ser tratados como `recurrence_type = 'weekly'` e `modality = 'presencial'` (os defaults das novas colunas).

---

## 1. Migration

Crie o arquivo `apps/psychotherapy-api/src/migrations/023_availability_recurrence_modality.sql`:

```sql
-- Adiciona colunas de recorrência e modalidade
ALTER TABLE psychotherapy_availability_slots
  ADD COLUMN IF NOT EXISTS recurrence_type VARCHAR(10) NOT NULL DEFAULT 'weekly'
    CHECK (recurrence_type IN ('weekly', 'biweekly', 'once')),
  ADD COLUMN IF NOT EXISTS start_date DATE NULL,
  -- start_date serve para dois fins:
  --   'once'     → a data específica do slot avulso
  --   'biweekly' → data âncora (primeira ocorrência) para calcular paridade de semanas
  --   'weekly'   → ignorado (NULL aceitável)
  ADD COLUMN IF NOT EXISTS modality VARCHAR(10) NOT NULL DEFAULT 'presencial'
    CHECK (modality IN ('presencial', 'online', 'both'));

-- Remove a unique constraint antiga (bloqueia múltiplos 'once' no mesmo dia-da-semana/horário)
ALTER TABLE psychotherapy_availability_slots
  DROP CONSTRAINT IF EXISTS psychotherapy_availability_slots_tenant_id_day_of_week_start__key;

-- Unique parcial: slots recorrentes não podem duplicar dia+horário
CREATE UNIQUE INDEX IF NOT EXISTS idx_avail_unique_recurring
  ON psychotherapy_availability_slots (tenant_id, day_of_week, start_time)
  WHERE recurrence_type IN ('weekly', 'biweekly');

-- Unique parcial: slots avulsos não podem duplicar data+horário
CREATE UNIQUE INDEX IF NOT EXISTS idx_avail_unique_once
  ON psychotherapy_availability_slots (tenant_id, start_date, start_time)
  WHERE recurrence_type = 'once';
```

Aplique a migration no `runMigrations.ts` (mesma ordem dos outros arquivos no diretório `migrations/`).

---

## 2. Domain Model

### `apps/psychotherapy-api/src/domain/models/AvailabilitySlot.ts`

Adicione os três novos campos ao construtor e à classe:

```ts
export type AvailabilityRecurrenceType = 'weekly' | 'biweekly' | 'once';
export type AvailabilityModality = 'presencial' | 'online' | 'both';

export class AvailabilitySlot {
  constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly dayOfWeek: number,
    public readonly startTime: string,
    public readonly durationMinutes: number,
    public readonly isActive: boolean,
    public readonly notes: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly recurrenceType: AvailabilityRecurrenceType = 'weekly',
    public readonly startDate: Date | null = null,  // âncora para biweekly / data para once
    public readonly modality: AvailabilityModality = 'presencial'
  ) {}
}
```

---

## 3. Repository

### `apps/psychotherapy-api/src/domain/repositories/IPsychotherapyRepository.ts`

Atualize `SaveAvailabilitySlotDTO`:

```ts
export interface SaveAvailabilitySlotDTO {
  id?: string;
  tenantId: string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes?: number;
  isActive?: boolean;
  notes?: string | null;
  recurrenceType?: AvailabilityRecurrenceType;
  startDate?: Date | null;
  modality?: AvailabilityModality;
}
```

### `apps/psychotherapy-api/src/infrastructure/repositories/PostgresPsychotherapyRepository.ts`

**`saveAvailabilitySlot`**: inclua `recurrence_type`, `start_date`, `modality` no INSERT e no `ON CONFLICT ... DO UPDATE`.

Atenção: a constraint de conflito antiga (`tenant_id, day_of_week, start_time`) não existe mais. Use um `ON CONFLICT (id) DO UPDATE` (pelo id, quando id for fornecido) ou `INSERT + UPDATE` separado com lookup prévio.

**`listAvailabilitySlots`**: mapeie as três novas colunas no resultado — `recurrence_type`, `start_date`, `modality`.

**`mapRowToAvailabilitySlot`** (helper interno, se existir): adicione os campos.

---

## 4. Validation Schema (Rotas)

### `apps/psychotherapy-api/src/presentation/routes/psychotherapyRoutes.ts`

Atualize `availabilitySlotSchema`:

```ts
const availabilitySlotSchema = z.object({
  id: z.string().uuid().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(10).max(240).optional().default(50),
  isActive: z.boolean().optional().default(true),
  notes: z.string().nullable().optional(),
  recurrenceType: z.enum(['weekly', 'biweekly', 'once']).optional().default('weekly'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  modality: z.enum(['presencial', 'online', 'both']).optional().default('presencial'),
}).superRefine((data, ctx) => {
  if (data.recurrenceType === 'once' && !data.startDate) {
    ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Data obrigatória para slot avulso' });
  }
  if (data.recurrenceType === 'biweekly' && !data.startDate) {
    ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Data de início obrigatória para slot quinzenal' });
  }
});
```

### `apps/psychotherapy-api/src/application/useCases/booking/ManageAvailabilityUseCase.ts`

Passe `recurrenceType`, `startDate` (convertido de string para `Date`), e `modality` para o DTO do `saveAvailabilitySlot`.

Para slots do tipo `once`, derive `dayOfWeek` automaticamente a partir de `startDate`:

```ts
const dayOfWeek = data.recurrenceType === 'once' && data.startDate
  ? new Date(data.startDate).getDay()
  : data.dayOfWeek;
```

---

## 5. Lógica de Expansão de Slots para Booking

### `apps/psychotherapy-api/src/application/useCases/booking/ListAvailableSlotsUseCase.ts`

Ao gerar os slots disponíveis para o paciente agendar (janela de X semanas à frente):

```ts
function isSlotAvailableOnDate(slot: AvailabilitySlot, candidateDate: Date): boolean {
  if (!slot.isActive) return false;

  // Verificar dia da semana
  if (candidateDate.getDay() !== slot.dayOfWeek) return false;

  switch (slot.recurrenceType) {
    case 'once':
      // Disponível apenas na data exata
      if (!slot.startDate) return false;
      return isSameDay(candidateDate, slot.startDate);

    case 'weekly':
      // Sempre disponível nesse dia da semana
      // Se tiver startDate, só a partir dela
      if (slot.startDate && candidateDate < slot.startDate) return false;
      return true;

    case 'biweekly': {
      if (!slot.startDate) return false;
      // Verificar paridade: quantas semanas desde a âncora?
      const anchorMonday = startOfWeek(slot.startDate, { weekStartsOn: 1 });
      const candidateMonday = startOfWeek(candidateDate, { weekStartsOn: 1 });
      const weekDiff = Math.round(
        (candidateMonday.getTime() - anchorMonday.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weekDiff < 0) return false; // antes da âncora
      return weekDiff % 2 === 0;      // semanas pares = ativa
    }
  }
}
```

Use `date-fns` para `isSameDay` e `startOfWeek` (já é dependência do projeto — confirmado em `WeekGrid.tsx`).

---

## 6. Frontend — Tipos

### `apps/psychotherapy-web/src/types/api.ts`

Adicione os novos campos ao tipo `AvailabilitySlot`:

```ts
export type AvailabilityRecurrenceType = 'weekly' | 'biweekly' | 'once';
export type AvailabilityModality = 'presencial' | 'online' | 'both';

export interface AvailabilitySlot {
  id: string;
  tenantId: string;
  dayOfWeek: number;
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  recurrenceType: AvailabilityRecurrenceType;
  startDate: string | null;  // ISO date string "YYYY-MM-DD"
  modality: AvailabilityModality;
}
```

---

## 7. Frontend — Página de Disponibilidade

### `apps/psychotherapy-web/src/pages/Availability.tsx`

#### Formulário

Estado inicial do form:

```ts
const [form, setForm] = useState({
  dayOfWeek: 1,
  startTime: '09:00',
  durationMinutes: 50,
  isActive: true,
  notes: '',
  recurrenceType: 'weekly' as AvailabilityRecurrenceType,
  startDate: '',
  modality: 'presencial' as AvailabilityModality,
});
```

Adicione ao formulário, **antes** do campo de horário:

```tsx
{/* Tipo de recorrência */}
<div className="form-group">
  <label>Tipo</label>
  <div style={{ display: 'flex', gap: '0.5rem' }}>
    {(['weekly', 'biweekly', 'once'] as const).map(type => (
      <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
        <input
          type="radio"
          name="recurrenceType"
          value={type}
          checked={form.recurrenceType === type}
          onChange={() => setForm(f => ({ ...f, recurrenceType: type, startDate: '' }))}
        />
        {type === 'weekly' ? 'Semanal' : type === 'biweekly' ? 'Quinzenal' : 'Avulso'}
      </label>
    ))}
  </div>
</div>

{/* Dia da semana — só para semanal/quinzenal */}
{form.recurrenceType !== 'once' && (
  <div className="form-group">
    <label>Dia da semana</label>
    <select value={form.dayOfWeek} onChange={e => setForm(f => ({ ...f, dayOfWeek: Number(e.target.value) }))}>
      {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => (
        <option key={i} value={i}>{d}</option>
      ))}
    </select>
  </div>
)}

{/* Data específica — para avulso */}
{form.recurrenceType === 'once' && (
  <div className="form-group">
    <label>Data</label>
    <input type="date" required value={form.startDate}
      onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
  </div>
)}

{/* Data de início (âncora) — para quinzenal */}
{form.recurrenceType === 'biweekly' && (
  <div className="form-group">
    <label>Data da primeira ocorrência</label>
    <input type="date" required value={form.startDate}
      onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
    <small style={{ color: 'var(--text-muted)' }}>
      O sistema vai calcular as semanas alternadas a partir dessa data.
    </small>
  </div>
)}

{/* Modalidade */}
<div className="form-group">
  <label>Modalidade</label>
  <div style={{ display: 'flex', gap: '0.5rem' }}>
    {(['presencial', 'online', 'both'] as const).map(m => (
      <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
        <input
          type="radio"
          name="modality"
          value={m}
          checked={form.modality === m}
          onChange={() => setForm(f => ({ ...f, modality: m }))}
        />
        {m === 'presencial' ? 'Presencial' : m === 'online' ? 'Online' : 'Ambos'}
      </label>
    ))}
  </div>
</div>
```

#### Display dos slots na lista

Adicione badges de modalidade e recorrência ao `availability-slot-row`. Após o `<div className="slot-time">`, adicione:

```tsx
<div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
  {/* Badge recorrência */}
  <span className={`badge badge-sm ${
    slot.recurrenceType === 'once' ? 'badge-info' :
    slot.recurrenceType === 'biweekly' ? 'badge-warning' : 'badge-success'
  }`}>
    {slot.recurrenceType === 'once' ? 'Avulso' :
     slot.recurrenceType === 'biweekly' ? 'Quinzenal' : 'Semanal'}
  </span>
  {/* Badge modalidade */}
  <span className="badge badge-sm badge-secondary">
    {slot.modality === 'presencial' ? '🏢 Presencial' :
     slot.modality === 'online' ? '💻 Online' : '🏢💻 Ambos'}
  </span>
  {/* Data âncora para quinzenal e avulso */}
  {slot.startDate && (
    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
      {slot.recurrenceType === 'once' ? '' : 'desde '}
      {new Date(slot.startDate + 'T00:00:00').toLocaleDateString('pt-BR')}
    </span>
  )}
</div>
```

#### Agrupamento de avulsos

Os slots avulsos **não têm dia da semana fixo** — mostre-os numa seção separada "Datas Avulsas" acima ou abaixo dos slots recorrentes, ordenados por `startDate`.

---

## 8. Booking Page (paciente)

### `apps/psychotherapy-web/src/pages/BookAppointment.tsx` (ou nome similar)

Ao exibir os slots disponíveis para o paciente escolher, use a função `isSlotAvailableOnDate` (ou equivalente no frontend) para filtrar quais datas/horários mostrar. Inclua também a informação de modalidade no card do horário disponível para o paciente saber se é presencial ou online.

---

## 9. Verificação Manual

1. Criar um slot **Semanal** (ex: Terça 09:00, Presencial) → deve aparecer como hoje já funciona.
2. Criar um slot **Quinzenal** (ex: Quinta 14:00, Online, âncora 19/06/2025) → na página de booking do paciente deve aparecer 19/06, 03/07, 17/07... mas não 26/06 nem 10/07.
3. Criar um slot **Avulso** (ex: 25/06/2025 às 11:00, Ambos) → deve aparecer só nessa data na página de booking.
4. Verificar que slots existentes antes da migration continuam aparecendo normalmente (recurrenceType = 'weekly', modality = 'presencial' por default).
5. Confirmar que os badges aparecem corretamente na listagem de disponibilidade do terapeuta.
