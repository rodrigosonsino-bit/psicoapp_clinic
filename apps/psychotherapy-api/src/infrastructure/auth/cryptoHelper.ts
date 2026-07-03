import crypto from 'crypto';

const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY || 'default-secret-key-must-be-32-bytes!';

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
