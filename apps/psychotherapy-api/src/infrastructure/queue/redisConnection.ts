import IORedis from 'ioredis';

let connection: IORedis | null = null;

/** Conexão Redis lazy e compartilhada pelas filas/worker de broadcast. */
export function getBroadcastRedisConnection(): IORedis {
    if (!connection) {
        connection = process.env.REDIS_URL
            ? new IORedis(process.env.REDIS_URL, {
                maxRetriesPerRequest: null,
                tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined
            })
            : new IORedis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379', 10),
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: null,
                tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined
            });
    }
    return connection;
}

export async function closeBroadcastRedisConnection(): Promise<void> {
    if (connection) {
        await connection.quit();
        connection = null;
    }
}
