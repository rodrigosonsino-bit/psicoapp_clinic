-- 075_preflight_calendar.sql

DO $$ 
BEGIN
    -- Duplicatas de calendar_events (mesmo grupo/sessão)
    IF EXISTS (
        SELECT 1
        FROM calendar_events
        WHERE group_session_record_id IS NOT NULL
        GROUP BY tenant_id, group_session_record_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicatas em calendar_events encontradas. Reconcilie antes de prosseguir.';
    END IF;

    -- Duplicatas de psychotherapy_appointments (mesmo paciente/slot/grupo)
    IF EXISTS (
        SELECT 1
        FROM psychotherapy_appointments
        WHERE group_id IS NOT NULL
        GROUP BY tenant_id, group_id, patient_id, calendar_event_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicatas em psychotherapy_appointments (grupo) encontradas. Reconcilie antes de prosseguir.';
    END IF;
END $$;
