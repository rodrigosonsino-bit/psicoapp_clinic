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
    // Caso a tabela psychotherapy_patients exista de uma versão antiga que não tinha estas colunas
    pgm.sql(`
        ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
        ALTER TABLE psychotherapy_patients ADD COLUMN IF NOT EXISTS phone VARCHAR(255);
    `);

    // Caso a tabela sarah_patient_profiles exista de uma versão antiga sem estas colunas
    pgm.sql(`
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS phone VARCHAR(255);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS city VARCHAR(255);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS modality VARCHAR(50);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS session_type VARCHAR(50);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS referral VARCHAR(255);
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS last_contact DATE;
        ALTER TABLE sarah_patient_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);
    
    // Adicionar a restrição unique no psychotherapy_monthly_records caso falte (foi adicionada depois no schema.sql)
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_psychotherapy_monthly_patient
            ON psychotherapy_monthly_records(tenant_id, month, patient_id)
            WHERE patient_id IS NOT NULL;
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
