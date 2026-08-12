-- migrate:transaction=false
-- Suporta a query de inadimplência acumulada (listPatientMonthlyRecordsBefore):
-- WHERE tenant_id = $1 AND patient_id = $2 AND month < $3
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_monthly_records_tenant_patient_month
    ON psychotherapy_monthly_records(tenant_id, patient_id, month)
    WHERE patient_id IS NOT NULL;
