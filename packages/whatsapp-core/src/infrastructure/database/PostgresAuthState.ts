import {
    AuthenticationState,
    AuthenticationCreds,
    BufferJSON,
    initAuthCreds,
    SignalDataTypeMap,
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Pool } from 'pg';
import pino from 'pino';

/**
 * Adaptador customizado para armazenar o estado de autenticação do Baileys no PostgreSQL.
 * Multi-tenant: requer tenantId para isolar sessões.
 *
 * IMPORTANTE: O `keys` store é obrigatoriamente envolto em `makeCacheableSignalKeyStore`.
 * Sem esse wrapper, o Baileys faz I/O no banco a cada leitura de chave Signal durante o
 * handshake E2E — race conditions e leituras inconsistentes quebram a descriptografia e
 * causam "Aguardando mensagem" nos destinatários.
 */
export async function usePostgresAuthState(
    dbPool: Pool,
    tenantId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {

    const logger = pino({ level: 'silent' });

    const readData = async (key: string) => {
        try {
            const res = await dbPool.query(
                'SELECT value FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2',
                [tenantId, key]
            );
            if (res.rows.length > 0) {
                return JSON.parse(JSON.stringify(res.rows[0].value), BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            console.error(`Erro ao ler chave [${key}] do banco de dados (tenant: ${tenantId}):`, error);
            return null;
        }
    };

    const writeData = async (key: string, value: any) => {
        try {
            const dataStr = JSON.stringify(value, BufferJSON.replacer);
            await dbPool.query(
                `INSERT INTO whatsapp_auth (tenant_id, key, value)
                 VALUES ($1::uuid, $2, $3::jsonb)
                 ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
                [tenantId, key, dataStr]
            );
        } catch (error) {
            console.error(`Erro ao salvar chave [${key}] no banco de dados (tenant: ${tenantId}):`, error);
            // Credenciais são críticas — relançar o erro para que o Baileys
            // e os logs percebam a falha em vez de prosseguir silenciosamente.
            if (key === 'creds') throw error;
        }
    };

    const removeData = async (key: string) => {
        try {
            await dbPool.query(
                'DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2',
                [tenantId, key]
            );
        } catch (error) {
            console.error(`Erro ao remover chave [${key}] do banco de dados (tenant: ${tenantId}):`, error);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    // Store bruto (leitura/escrita direta no banco)
    const rawKeyStore = {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
            const data: { [id: string]: SignalDataTypeMap[T] } = {};
            await Promise.all(
                ids.map(async (id) => {
                    const value = await readData(`${type}-${id}`);
                    data[id] = value;
                })
            );
            return data;
        },
        set: async (data: any) => {
            const tasks: Promise<void>[] = [];
            for (const category in data) {
                const targets = data[category];
                if (targets) {
                    for (const id in targets) {
                        const value = targets[id];
                        const key = `${category}-${id}`;
                        tasks.push(value ? writeData(key, value) : removeData(key));
                    }
                }
            }
            await Promise.all(tasks);
        },
    };

    // makeCacheableSignalKeyStore adiciona um cache NodeCache em memória (TTL 5 min)
    // que serializa as operações com um mutex interno — essencial para que as chaves
    // Signal permaneçam consistentes durante handshakes E2E e evitar "Aguardando mensagem".
    const cachedKeys = makeCacheableSignalKeyStore(rawKeyStore as any, logger as any);

    return {
        state: {
            creds,
            keys: cachedKeys,
        },
        saveCreds: () => writeData('creds', creds),
    };
}
