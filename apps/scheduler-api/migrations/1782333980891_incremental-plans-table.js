exports.shorthands = undefined;

exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_messages_per_month INT;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents INT;
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}';
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

    UPDATE plans
    SET max_messages_per_month = COALESCE(max_messages_per_month, 5000),
        price_cents = COALESCE(price_cents, 19900),
        features = COALESCE(features, '{"whatsapp": true, "ai": true, "calendar": true, "reports": true}'::jsonb),
        active = COALESCE(active, TRUE)
    WHERE id = 'business';

    UPDATE plans
    SET max_messages_per_month = COALESCE(max_messages_per_month, 500),
        price_cents = COALESCE(price_cents, 4900),
        features = COALESCE(features, '{"whatsapp": true, "ai": false, "calendar": true, "reports": false}'::jsonb),
        active = COALESCE(active, TRUE)
    WHERE id = 'starter';

    UPDATE plans
    SET max_messages_per_month = COALESCE(max_messages_per_month, 100),
        price_cents = COALESCE(price_cents, 0),
        features = COALESCE(features, '{"whatsapp": true, "ai": false, "calendar": false, "reports": false}'::jsonb),
        active = COALESCE(active, TRUE)
    WHERE id = 'trial';

    UPDATE plans
    SET max_messages_per_month = COALESCE(max_messages_per_month, 200),
        price_cents = COALESCE(price_cents, 0),
        features = COALESCE(features, '{}'::jsonb),
        active = COALESCE(active, TRUE);

    ALTER TABLE plans ALTER COLUMN max_messages_per_month SET NOT NULL;
    ALTER TABLE plans ALTER COLUMN price_cents SET NOT NULL;
  `);
};

exports.down = () => {
  throw new Error('Irreversible migration');
};
