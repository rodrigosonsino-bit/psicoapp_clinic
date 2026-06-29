import { Pool, PoolClient } from 'pg';
import { logger } from '../logger';

/**
 * Garante exatamente UMA conexão WhatsApp (socket Baileys) ativa por tenant em todo o
 * cluster, usando um advisory lock do Postgres (escopo de sessão/conexão).
 *
 * Sem isso, durante um rolling deploy do Railway o container antigo e o novo podem
 * coexistir por alguns segundos, ambos tentando abrir o mesmo socket WhatsApp para o
 * mesmo tenant — o que gera o erro "440 Stream Errored (conflict)" e pode fazer
 * mensagens serem enviadas/recebidas pela instância que está sendo desligada.
 *
 * O lock é de sessão (preso à conexão `PoolClient`, não a uma transação) e é liberado
 * automaticamente pelo Postgres se a conexão cair abruptamente (ex: container morto),
 * então não há risco de lock "travado" para sempre.
 */

// Namespace fixo (chave de classe do advisory lock de 2 argumentos) para não colidir
// com outros usos de pg_advisory_lock no monorepo (ex: runMigrations.ts usa a forma
// de 1 argumento, espaço de chaves totalmente separado).
const LOCK_NAMESPACE = 'whatsapp_tenant_socket_lock';

export interface TenantSocketLock {
    tenantId: string;
    release(): Promise<void>;
}

/**
 * Tenta adquirir o lock do tenant. Retorna null imediatamente se outra instância
 * já o detém (não bloqueia esperando).
 */
export async function acquireTenantSocketLock(pool: Pool, tenantId: string): Promise<TenantSocketLock | null> {
    const client: PoolClient = await pool.connect();
    try {
        const result = await client.query(
            'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired;',
            [LOCK_NAMESPACE, tenantId]
        );
        const acquired: boolean = result.rows[0]?.acquired === true;

        if (!acquired) {
            client.release();
            return null;
        }

        let released = false;
        return {
            tenantId,
            release: async () => {
                if (released) return;
                released = true;
                try {
                    await client.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2));', [LOCK_NAMESPACE, tenantId]);
                } catch (err) {
                    logger.warn({ err, tenantId }, 'Erro ao liberar advisory lock do tenant (a conexão será encerrada mesmo assim).');
                } finally {
                    client.release();
                }
            }
        };
    } catch (err) {
        client.release();
        throw err;
    }
}
