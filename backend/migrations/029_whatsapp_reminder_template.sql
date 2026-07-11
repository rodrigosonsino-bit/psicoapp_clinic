ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS whatsapp_reminder_template TEXT;
