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
