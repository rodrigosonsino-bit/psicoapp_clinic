CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_tenant
    ON auth_refresh_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_hash
    ON auth_refresh_tokens(token_hash);
