-- Migration: 100_no_overlapping_calendar_events.sql
-- Descrição: Adiciona restrição de exclusão GiST para impedir sobreposição de eventos ativos (status != 'canceled') para o mesmo tenant (apenas para eventos criados a partir de 2026-07-20).

-- 1. Preflight check: Verifica se existem conflitos/sobreposições ativas criadas a partir de 2026-07-20
DO $$
DECLARE
    conflicts_count INT;
BEGIN
    SELECT COUNT(*) INTO conflicts_count
    FROM calendar_events c1
    JOIN calendar_events c2 ON c1.tenant_id = c2.tenant_id
        AND c1.id < c2.id
        AND tstzrange(c1.scheduled_at, c1.ended_at, '[)') && tstzrange(c2.scheduled_at, c2.ended_at, '[)')
    WHERE c1.status <> 'canceled' AND c2.status <> 'canceled'
      AND c1.created_at >= '2026-07-20 00:00:00+00' AND c2.created_at >= '2026-07-20 00:00:00+00';

    IF conflicts_count > 0 THEN
        RAISE EXCEPTION 'Preflight abortado: Encontrados % eventos sobrepostos ativos criados a partir de 2026-07-20 no mesmo tenant. Por favor, saneie o banco antes de prosseguir.', conflicts_count;
    END IF;
END $$;

-- 2. Adiciona a exclusion constraint GiST na tabela calendar_events
ALTER TABLE calendar_events
ADD CONSTRAINT exclude_overlapping_calendar_events
EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(scheduled_at, ended_at, '[)') WITH &&
) WHERE (status <> 'canceled' AND created_at >= '2026-07-20 00:00:00+00');
