import crypto from 'crypto';

// Valor antigo hardcoded que servia de fallback silencioso — permanece aqui só como
// referência para REJEITAR explicitamente (nunca mais como fallback ativo). Produção
// rodou com esse valor até 2026-07-19 sem ninguém perceber (MASTER_ENCRYPTION_KEY nunca
// tinha sido configurada no Railway); os 2 tokens OAuth afetados (Google Calendar, Gmail)
// já foram revogados/removidos como parte da remediação. Ver docs/lgpd-data-mapping-2026-07-19.md.
const INSECURE_DEFAULT_MASTER_KEY = 'default-secret-key-must-be-32-bytes!';
const MIN_MASTER_KEY_LENGTH = 32;

function resolveMasterEncryptionKey(): string {
    const raw = process.env.MASTER_ENCRYPTION_KEY;

    // Mesmo padrão de fail-fast já usado para TRUST_PROXY_HOPS em server.ts: só
    // test/development podem cair no valor default (conveniência local), qualquer outro
    // NODE_ENV (incluindo ausente/desconhecido) exige a env var real e válida, derrubando
    // o processo no boot em vez de cifrar dado sensível com uma chave pública no repo.
    const isNonProdDefault = !raw && (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development');
    if (isNonProdDefault) return INSECURE_DEFAULT_MASTER_KEY;

    if (!raw) {
        throw new Error('MASTER_ENCRYPTION_KEY não configurada — obrigatória fora de test/development.');
    }
    if (raw === INSECURE_DEFAULT_MASTER_KEY) {
        throw new Error('MASTER_ENCRYPTION_KEY não pode usar o valor default inseguro conhecido.');
    }
    if (raw.length < MIN_MASTER_KEY_LENGTH) {
        throw new Error(`MASTER_ENCRYPTION_KEY muito curta (mínimo ${MIN_MASTER_KEY_LENGTH} caracteres).`);
    }
    return raw;
}

const MASTER_ENCRYPTION_KEY = resolveMasterEncryptionKey();

function getEncryptionKey(): Buffer {
    // Deriva chave de 32 bytes de forma determinística
    return crypto.createHash('sha256').update(MASTER_ENCRYPTION_KEY).digest();
}

export function encrypt(text: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 12 bytes para GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    const version = 'v1'; // Versão da chave mestra para suportar rotação futuramente
    
    // Retorna string empacotada no formato: gcm:version:iv:tag:ciphertext
    return `gcm:${version}:${iv.toString('hex')}:${tag}:${encrypted}`;
}

export function decrypt(packed: string): string {
    if (!packed.startsWith('gcm:')) {
        // Retorna em texto puro caso ainda não esteja criptografado (Fase de Transição/Compatibilidade)
        return packed;
    }
    
    const parts = packed.split(':');
    if (parts.length !== 5) {
        throw new Error('Formato de criptografia inválido.');
    }
    
    const [, version, ivHex, tagHex, ciphertextHex] = parts;
    const key = getEncryptionKey(); // Se a versão mudar, podemos selecionar chaves antigas aqui
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}
