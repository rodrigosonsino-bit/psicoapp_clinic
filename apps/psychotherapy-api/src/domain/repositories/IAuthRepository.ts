export interface TenantAuth {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    plan: string;
    status: string;
    totpSecret?: string | null;
    totpEnabled?: boolean;
    totpBackupCodes?: string[] | null;
}

export interface CreateTenantDTO {
    name: string;
    email: string;
    passwordHash: string;
}

export interface RefreshTokenRecord {
    tenantId: string;
    tokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
}

export interface IAuthRepository {
    findTenantByEmail(email: string): Promise<TenantAuth | null>;
    createTenant(data: CreateTenantDTO): Promise<TenantAuth>;
    findTenantById(id: string): Promise<TenantAuth | null>;
    saveRefreshToken(tenantId: string, tokenHash: string, expiresAt: Date): Promise<void>;
    findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
    revokeRefreshToken(tokenHash: string): Promise<void>;
    revokeAllRefreshTokens(tenantId: string): Promise<void>;
    saveTotpSecret(tenantId: string, secret: string, backupCodes: string[]): Promise<void>;
    enableTotp(tenantId: string): Promise<void>;
    disableTotp(tenantId: string): Promise<void>;
    consumeBackupCode(tenantId: string, code: string): Promise<boolean>;
    save2faChallenge(challengeHash: string, tenantId: string, expiresAt: Date): Promise<void>;
    rotateRefreshToken(
        oldTokenHash: string,
        newRefreshToken: string,
        newRefreshTokenHash: string,
        expiresAt: Date,
        newId: string
    ): Promise<{ tenantId: string; familyId: string } | null>;
}
