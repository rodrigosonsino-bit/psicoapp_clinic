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
import { logger as appLogger } from '../logger';

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
    tenantId: string,
    appName: string = 'default'
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {

    const logger = pino({ level: 'silent' });

    // Executor pode ser o pool (operações avulsas) ou um PoolClient dentro de transação.
    type Executor = { query: (text: string, params?: any[]) => Promise<any> };

    const readData = async (key: string) => {
        const prefixedKey = `${appName}:${key}`;
        try {
            const res = await dbPool.query(
                'SELECT value FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2',
                [tenantId, prefixedKey]
            );
            if (res.rows.length > 0) {
                return JSON.parse(JSON.stringify(res.rows[0].value), BufferJSON.reviver);
            }
            // Chave não existe — estado legítimo (Baileys interpreta como "sem valor").
            return null;
        } catch (error) {
            // Erro REAL de query (conexão caída, etc.) NÃO pode virar null: isso faria o
            // Baileys tratar como "chave inexistente" e corromper o handshake E2E. Propagar.
            console.error(`Erro ao ler chave [${key}] do banco de dados (tenant: ${tenantId}):`, error);
            throw error;
        }
    };

    const writeData = async (key: string, value: any, executor: Executor = dbPool) => {
        const prefixedKey = `${appName}:${key}`;
        try {
            const dataStr = JSON.stringify(value, BufferJSON.replacer);
            await executor.query(
                `INSERT INTO whatsapp_auth (tenant_id, key, value)
                 VALUES ($1::uuid, $2, $3::jsonb)
                 ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
                [tenantId, prefixedKey, dataStr]
            );
        } catch (error) {
            // Propagar SEMPRE (antes só 'creds' propagava). Engolir a falha fazia o cache do
            // makeCacheableSignalKeyStore acreditar que gravou — e chaves como tctoken/
            // lid-mapping/session sumiam após reinício, quebrando a entrega 1:1.
            console.error(`Erro ao salvar chave [${key}] no banco de dados (tenant: ${tenantId}):`, error);
            throw error;
        }
    };

    const removeData = async (key: string, executor: Executor = dbPool) => {
        const prefixedKey = `${appName}:${key}`;
        try {
            await executor.query(
                'DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2',
                [tenantId, prefixedKey]
            );
        } catch (error) {
            console.error(`Erro ao remover chave [${key}] do banco de dados (tenant: ${tenantId}):`, error);
            throw error;
        }
    };

    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    // Store bruto (leitura/escrita direta no banco)
    const rawKeyStore = {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
            const data: { [id: string]: SignalDataTypeMap[T] } = {};
            await Promise.all(
                ids.map(async (id) => {
                    const value = await readData(`${String(type)}-${id}`);
                    // Só incluir chaves realmente presentes — não poluir com null/undefined.
                    if (value !== null && value !== undefined) {
                        data[id] = value;
                    }
                })
            );
            return data;
        },
        set: async (data: any) => {
            // Cada chamada de set() representa uma atualização coesa do estado Signal (ex.: um
            // conjunto de pre-keys + session + tctoken). Persistir tudo numa transação evita
            // deixar o estado parcialmente gravado se uma das escritas falhar.
            const client = await dbPool.connect();
            try {
                await client.query('BEGIN');
                for (const category in data) {
                    const targets = data[category];
                    if (!targets) continue;
                    for (const id of Object.keys(targets)) {
                        const value = targets[id];
                        const key = `${category}-${id}`;
                        if (value === null || value === undefined) {
                            await removeData(key, client);
                        } else {
                            await writeData(key, value, client);
                        }
                    }
                    if (category === 'tctoken' || category === 'lid-mapping' || category === 'device-list') {
                        appLogger.info({ tenantId, category, idCount: Object.keys(targets).length }, '🔑 Persistindo categoria crítica de sessão 1:1');
                    }
                }
                await client.query('COMMIT');
            } catch (error) {
                try { await client.query('ROLLBACK'); } catch { }
                appLogger.error({ err: error, tenantId }, 'Falha ao persistir chaves Signal — rollback aplicado.');
                throw error;
            } finally {
                client.release();
            }
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
