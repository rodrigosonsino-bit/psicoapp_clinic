import { AuthenticationState, AuthenticationCreds, BufferJSON, initAuthCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { Pool } from 'pg';

/**
 * Adaptador customizado para armazenar o estado de autenticação do Baileys no PostgreSQL.
 * Multi-tenant: requer tenantId para isolar sessões.
 */
export async function usePostgresAuthState(dbPool: Pool, tenantId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {

    const readData = async (key: string) => {
        try {
            const res = await dbPool.query('SELECT value FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2', [tenantId, key]);
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
                'INSERT INTO whatsapp_auth (tenant_id, key, value) VALUES ($1::uuid, $2, $3::jsonb) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value',
                [tenantId, key, dataStr]
            );
        } catch (error) {
            console.error(`Erro ao salvar chave [${key}] no banco de dados (tenant: ${tenantId}):`, error);
        }
    };

    const removeData = async (key: string) => {
        try {
            await dbPool.query('DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid AND key = $2', [tenantId, key]);
        } catch (error) {
            console.error(`Erro ao remover chave [${key}] do banco de dados (tenant: ${tenantId}):`, error);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        const targets = data[category as keyof typeof data];
                        if (targets) {
                            for (const id in targets) {
                                const value = targets[id];
                                const key = `${category}-${id}`;
                                if (value) {
                                    tasks.push(writeData(key, value));
                                } else {
                                    tasks.push(removeData(key));
                                }
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData('creds', creds);
        }
    };
}
