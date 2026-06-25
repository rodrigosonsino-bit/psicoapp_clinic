import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('ENCRYPTION_KEY precisa ter exatamente 64 caracteres hexadecimais (32 bytes).');
        }
        return crypto.scryptSync(key || 'default-secret-key-12345', 'salt', 32);
    }
    return Buffer.from(key, 'hex');
}

export function encrypt(text: string): string {
    if (!text) return text;
    
    // Evita encriptar duas vezes
    if (text.includes(':') && text.split(':').length === 3) {
        return text;
    }
    
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Formato: iv:authTag:encryptedText
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
    if (!encryptedData || !encryptedData.includes(':')) return encryptedData;

    const parts = encryptedData.split(':');
    if (parts.length !== 3) return encryptedData;

    try {
        const key = getEncryptionKey();
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e: any) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(`Falha crítica na decriptação: chave inválida ou dados corrompidos. (${e.message})`);
        }
        return '';
    }
}
