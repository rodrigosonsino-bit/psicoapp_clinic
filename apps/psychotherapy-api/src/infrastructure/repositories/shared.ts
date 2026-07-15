const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helper compartilhado entre PostgresPsychotherapyRepository e seus sub-repositórios
 * (extração mecânica, ver .claude/plans/pendencias-tecnicas-pos-quitacao-2026-07.md item 1) —
 * centralizado aqui para não duplicar em cada sub-repositório.
 */
export function validateTenantId(tenantId: string): string {
    if (!UUID_REGEX.test(tenantId)) {
        throw new Error(`TenantId inválido: "${tenantId}". Esperado UUID v1-v5.`);
    }
    return tenantId;
}
