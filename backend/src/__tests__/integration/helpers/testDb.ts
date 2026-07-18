/**
 * testDb.ts — Infraestrutura compartilhada de banco de dados para testes de integração.
 *
 * Sobe um container PostgreSQL isolado via Testcontainers, aplica todas as migrations
 * usando o runner real (runMigrations) e expõe um Pool pg para os testes.
 *
 * Uso:
 *   import { getTestPool, teardownTestDb } from '../helpers/testDb';
 *
 *   beforeAll(async () => { pool = await getTestPool(); });
 *   afterAll(async () => { await teardownTestDb(); });
 */

import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | null = null;
let pool: Pool | null = null;

/**
 * Obtém (criando se necessário) o pool de conexão com o banco de teste isolado.
 * O container é singleton — todas as suítes de integração do mesmo processo compartilham.
 *
 * Se `TEST_DATABASE_URL` estiver definida, usa esse banco diretamente (ex.: um projeto
 * Neon/Postgres real na nuvem) em vez de subir um container local — útil em ambientes sem
 * runtime de container (Docker) disponível. Ainda aplica as migrations normalmente; quem
 * define a env var é responsável por apontar pra um banco descartável, nunca produção.
 */
export async function getTestPool(): Promise<Pool> {
    if (pool) return pool;

    const externalUrl = process.env.TEST_DATABASE_URL;
    if (externalUrl) {
        console.log('[testDb] Usando TEST_DATABASE_URL (sem container local)...');
        pool = new Pool({ connectionString: externalUrl, ssl: { rejectUnauthorized: false } });
        await applyMigrations(externalUrl);
        return pool;
    }

    console.log('[testDb] Iniciando container PostgreSQL...');
    container = await new PostgreSqlContainer('postgres:15-alpine')
        .withDatabase('test_psychotherapy')
        .withUsername('test_user')
        .withPassword('test_pass')
        .start();

    const connectionString = container.getConnectionUri();
    console.log(`[testDb] Container iniciado: ${connectionString}`);

    // Criar pool sem SSL (container local)
    pool = new Pool({ connectionString });

    // Aplicar todas as migrations via runner real
    await applyMigrations(connectionString);

    return pool;
}

/**
 * Para o container (se houver) e fecha o pool. Chamar no afterAll da suíte raiz.
 */
export async function teardownTestDb(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
    if (container) {
        await container.stop();
        container = null;
    }
}

/**
 * Aplica todas as migrations usando o runner real do projeto.
 * Replica a lógica de runMigrations.ts de forma adequada para testes.
 */
async function applyMigrations(connectionString: string): Promise<void> {
    const { runMigrations } = await import('../../../runMigrations');
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = connectionString;
    try {
        await runMigrations();
    } finally {
        if (originalUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = originalUrl;
        }
    }
}

/**
 * Limpa apenas os dados de um conjunto de tabelas (truncate em cascata),
 * preservando o esquema. Útil no beforeEach para isolar testes.
 */
export async function truncateTables(pool: Pool, tables: string[]): Promise<void> {
    if (tables.length === 0) return;
    const list = tables.map(t => `"${t}"`).join(', ');
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}
