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
    // ==== 1. EXTENSÕES ====
    pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // ==== 2. TABELAS BASE (DO SCHEMA.SQL ORIGINAL) ====
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS tenants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            plan VARCHAR(50) DEFAULT 'starter',
            status VARCHAR(20) DEFAULT 'trial',
            stripe_customer_id VARCHAR(255),
            stripe_subscription_id VARCHAR(255),
            mp_subscription_id VARCHAR(255),
            subscription_status VARCHAR(50) DEFAULT 'trialing',
            current_period_end TIMESTAMPTZ,
            max_messages_per_month INT DEFAULT 200,
            whatsapp_connected BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            is_admin BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS scheduled_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            recipient_id VARCHAR(255) NOT NULL,
            send_at TIMESTAMP WITH TIME ZONE NOT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            platform VARCHAR(20) DEFAULT 'whatsapp',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            metadata JSONB DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_messages_user_id ON scheduled_messages(user_id);

        CREATE TABLE IF NOT EXISTS whatsapp_auth (
            tenant_id UUID NOT NULL,
            key VARCHAR(255) NOT NULL,
            value JSONB NOT NULL,
            PRIMARY KEY (tenant_id, key)
        );

        CREATE TABLE IF NOT EXISTS whatsapp_contacts (
            tenant_id UUID NOT NULL,
            id VARCHAR(255) NOT NULL,
            name VARCHAR(255) NOT NULL,
            ai_disabled BOOLEAN DEFAULT FALSE,
            ai_disabled_at TIMESTAMP WITH TIME ZONE,
            google_name VARCHAR(255),
            PRIMARY KEY (tenant_id, id)
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            user_id VARCHAR(255) PRIMARY KEY,
            ai_auto_reply_enabled BOOLEAN DEFAULT FALSE,
            ai_auto_reply_instructions TEXT,
            office_hours JSONB,
            receive_weekly_report BOOLEAN DEFAULT FALSE,
            weekly_report_day VARCHAR(10) DEFAULT '1',
            weekly_report_time VARCHAR(10) DEFAULT '08:00',
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS google_calendar_configs (
            user_id VARCHAR(255) PRIMARY KEY,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            expiry_date BIGINT NOT NULL,
            email VARCHAR(255) NOT NULL,
            is_enabled BOOLEAN DEFAULT TRUE,
            calendar_id VARCHAR(255),
            calendar_name VARCHAR(255),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS google_event_preferences (
            user_id VARCHAR(255) NOT NULL,
            event_id VARCHAR(255) NOT NULL,
            auto_send BOOLEAN DEFAULT TRUE,
            event_summary VARCHAR(255),
            event_start TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, event_id)
        );

        CREATE TABLE IF NOT EXISTS whatsapp_ai_chats (
            id SERIAL PRIMARY KEY,
            tenant_id UUID NOT NULL,
            contact_jid VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            message_text TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_chats_jid ON whatsapp_ai_chats(contact_jid);
        CREATE INDEX IF NOT EXISTS idx_ai_chats_tenant ON whatsapp_ai_chats(tenant_id, contact_jid);

        CREATE TABLE IF NOT EXISTS whatsapp_ai_contact_contexts (
            tenant_id UUID NOT NULL,
            contact_jid VARCHAR(255) NOT NULL,
            display_name VARCHAR(255),
            summary TEXT,
            current_intent VARCHAR(100),
            conversation_stage VARCHAR(100),
            pending_action JSONB,
            preferences JSONB,
            last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenant_id, contact_jid)
        );

        CREATE TABLE IF NOT EXISTS mp_events (
            event_id VARCHAR(255) PRIMARY KEY,
            type VARCHAR(50) NOT NULL,
            processed_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS stripe_events (
            event_id VARCHAR(255) PRIMARY KEY,
            type VARCHAR(100) NOT NULL,
            processed_at TIMESTAMPTZ DEFAULT NOW()
        );
    `);

    // ==== 3. TABELAS DE PSICOTERAPIA COM REGRAS COMPLETAS (DO SCHEMA.SQL) ====
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS psychotherapy_patients (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            status VARCHAR(20) NOT NULL CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
            payment_type VARCHAR(20) CHECK (payment_type IN ('monthly', 'per_session')),
            default_session_price_cents INT CHECK (default_session_price_cents IS NULL OR default_session_price_cents >= 0),
            phone VARCHAR(255),
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_psychotherapy_patients_tenant ON psychotherapy_patients(tenant_id, name);

        CREATE TABLE IF NOT EXISTS psychotherapy_monthly_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            patient_id UUID REFERENCES psychotherapy_patients(id) ON DELETE SET NULL,
            month CHAR(7) NOT NULL CHECK (month ~ '^\\d{4}-\\d{2}$'),
            patient_name_snapshot VARCHAR(255) NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('weekly', 'biweekly', 'one_off', 'inactive')),
            payment_type VARCHAR(20) CHECK (payment_type IN ('monthly', 'per_session')),
            session_price_cents INT CHECK (session_price_cents IS NULL OR session_price_cents >= 0),
            expected_sessions INT NOT NULL DEFAULT 0 CHECK (expected_sessions >= 0),
            paid_sessions INT NOT NULL DEFAULT 0 CHECK (paid_sessions >= 0),
            absences INT NOT NULL DEFAULT 0 CHECK (absences >= 0),
            payment_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('paid', 'pending', 'partial')),
            notes TEXT,
            previous_month_paid_cents INT NOT NULL DEFAULT 0 CHECK (previous_month_paid_cents >= 0),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_psychotherapy_monthly_patient
            ON psychotherapy_monthly_records(tenant_id, month, patient_id)
            WHERE patient_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_psychotherapy_monthly_tenant_month
            ON psychotherapy_monthly_records(tenant_id, month);
    `);

    // ==== 4. TABELAS ADICIONADAS POSTERIORMENTE NO CÓDIGO ====
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS sarah_patient_profiles (
            tenant_id UUID NOT NULL,
            contact_jid VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            phone VARCHAR(255),
            city VARCHAR(255),
            modality VARCHAR(50),
            session_type VARCHAR(50),
            referral VARCHAR(255),
            notes TEXT,
            last_contact DATE,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenant_id, contact_jid)
        );

        CREATE TABLE IF NOT EXISTS psychotherapy_fixed_expenses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            description VARCHAR(255) NOT NULL,
            amount_cents INT NOT NULL,
            category VARCHAR(100),
            start_date DATE NOT NULL,
            end_date DATE,
            day_of_month INT NOT NULL,
            active BOOLEAN DEFAULT TRUE
        );

        CREATE TABLE IF NOT EXISTS psychotherapy_expenses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            date DATE NOT NULL,
            amount_cents INT NOT NULL,
            description VARCHAR(255) NOT NULL,
            category VARCHAR(100),
            fixed_expense_id UUID,
            reference_month VARCHAR(7),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS plans (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            stripe_price_id VARCHAR(255),
            mp_plan_id VARCHAR(255),
            price_cents INT NOT NULL,
            max_messages_per_month INT NOT NULL,
            features JSONB DEFAULT '{}',
            active BOOLEAN DEFAULT TRUE
        );

        INSERT INTO plans (id, name, mp_plan_id, price_cents, max_messages_per_month, features)
        VALUES ('business', 'Business', NULL, 19900, 5000, '{"whatsapp": true, "ai": true, "calendar": true, "reports": true}')
        ON CONFLICT (id) DO NOTHING;

        CREATE TABLE IF NOT EXISTS usage_tracking (
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            month VARCHAR(7) NOT NULL,
            messages_sent INT DEFAULT 0,
            messages_failed INT DEFAULT 0,
            PRIMARY KEY (tenant_id, month)
        );
    `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
    throw new Error('Irreversible baseline migration');
};
