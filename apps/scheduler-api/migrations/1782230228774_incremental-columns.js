/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
    // Adição de colunas incrementais que foram feitas no código ao longo do tempo.
    // Isso garante que bancos existentes (que começaram antes de algumas dessas features)
    // sejam atualizados corretamente.

    pgm.sql(`
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_subscription_id VARCHAR;
        
        ALTER TABLE plans ADD COLUMN IF NOT EXISTS mp_plan_id VARCHAR(255);
        
        ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
        
        ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS google_name VARCHAR(255);
        
        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS receive_weekly_report BOOLEAN DEFAULT FALSE;
        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS weekly_report_day VARCHAR(10) DEFAULT '1';
        ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS weekly_report_time VARCHAR(10) DEFAULT '08:00';
    `);

    // Migrações Multi-Tenant Complexas
    pgm.sql(`
        -- 1. whatsapp_auth
        ALTER TABLE whatsapp_auth ADD COLUMN IF NOT EXISTS tenant_id UUID;
        
        DO $$ 
        DECLARE 
            orphan_count INT;
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.key_column_usage
                WHERE table_name = 'whatsapp_auth' AND column_name = 'tenant_id'
            ) THEN
                SELECT count(*) INTO orphan_count FROM whatsapp_auth WHERE tenant_id IS NULL;
                IF orphan_count > 0 THEN
                    RAISE EXCEPTION 'Dados orfaos detectados em whatsapp_auth (tenant_id IS NULL). Migracao abortada para evitar vazamento multi-tenant.';
                END IF;
                ALTER TABLE whatsapp_auth ALTER COLUMN tenant_id SET NOT NULL;
                ALTER TABLE whatsapp_auth DROP CONSTRAINT IF EXISTS whatsapp_auth_pkey;
                ALTER TABLE whatsapp_auth ADD PRIMARY KEY (tenant_id, key);
            END IF;
        END $$;

        -- 2. whatsapp_contacts
        ALTER TABLE whatsapp_contacts ADD COLUMN IF NOT EXISTS tenant_id UUID;
        
        DO $$ 
        DECLARE 
            orphan_count INT;
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.key_column_usage
                WHERE table_name = 'whatsapp_contacts' AND column_name = 'tenant_id'
            ) THEN
                SELECT count(*) INTO orphan_count FROM whatsapp_contacts WHERE tenant_id IS NULL;
                IF orphan_count > 0 THEN
                    RAISE EXCEPTION 'Dados orfaos detectados em whatsapp_contacts (tenant_id IS NULL). Migracao abortada para evitar vazamento multi-tenant.';
                END IF;
                ALTER TABLE whatsapp_contacts ALTER COLUMN tenant_id SET NOT NULL;
                ALTER TABLE whatsapp_contacts DROP CONSTRAINT IF EXISTS whatsapp_contacts_pkey;
                ALTER TABLE whatsapp_contacts ADD PRIMARY KEY (tenant_id, id);
            END IF;
        END $$;

        -- 3. whatsapp_ai_contact_contexts
        ALTER TABLE whatsapp_ai_contact_contexts ADD COLUMN IF NOT EXISTS tenant_id UUID;
        
        DO $$ 
        DECLARE 
            orphan_count INT;
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.key_column_usage
                WHERE table_name = 'whatsapp_ai_contact_contexts' AND column_name = 'tenant_id'
            ) THEN
                SELECT count(*) INTO orphan_count FROM whatsapp_ai_contact_contexts WHERE tenant_id IS NULL;
                IF orphan_count > 0 THEN
                    RAISE EXCEPTION 'Dados orfaos detectados em whatsapp_ai_contact_contexts (tenant_id IS NULL). Migracao abortada para evitar vazamento multi-tenant.';
                END IF;
                ALTER TABLE whatsapp_ai_contact_contexts ALTER COLUMN tenant_id SET NOT NULL;
                ALTER TABLE whatsapp_ai_contact_contexts DROP CONSTRAINT IF EXISTS whatsapp_ai_contact_contexts_pkey;
                ALTER TABLE whatsapp_ai_contact_contexts ADD PRIMARY KEY (tenant_id, contact_jid);
            END IF;
        END $$;

        -- 4. whatsapp_ai_chats
        ALTER TABLE whatsapp_ai_chats ADD COLUMN IF NOT EXISTS tenant_id UUID;
        
        DO $$
        DECLARE 
            orphan_count INT;
        BEGIN
            SELECT count(*) INTO orphan_count FROM whatsapp_ai_chats WHERE tenant_id IS NULL;
            IF orphan_count > 0 THEN
                RAISE EXCEPTION 'Dados orfaos detectados em whatsapp_ai_chats (tenant_id IS NULL). Migracao abortada para evitar vazamento multi-tenant.';
            END IF;
            -- Tornar NOT NULL caso ainda não seja
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_ai_chats' AND column_name = 'tenant_id' AND is_nullable = 'YES') THEN
                ALTER TABLE whatsapp_ai_chats ALTER COLUMN tenant_id SET NOT NULL;
            END IF;
        END $$;
        CREATE INDEX IF NOT EXISTS idx_ai_chats_tenant ON whatsapp_ai_chats(tenant_id, contact_jid);
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
    throw new Error('Irreversible migration');
};
