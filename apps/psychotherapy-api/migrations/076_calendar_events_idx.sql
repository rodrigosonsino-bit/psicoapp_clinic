-- 076_calendar_events_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_calendar_events_group_session 
ON calendar_events (tenant_id, group_session_record_id) 
WHERE group_session_record_id IS NOT NULL;
