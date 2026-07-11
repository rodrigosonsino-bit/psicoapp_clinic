-- 076_calendar_events_idx.sql
-- noTransaction

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_calendar_events_group_session 
ON calendar_events (tenant_id, group_id, scheduled_at) 
WHERE event_type = 'group';
