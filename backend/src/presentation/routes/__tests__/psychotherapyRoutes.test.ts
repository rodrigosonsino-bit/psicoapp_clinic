/**
 * psychotherapyRoutes.test.ts
 *
 * Teste de REGRESSÃO pro bug de rotas duplicadas encontrado na auditoria de 03/07/2026
 * e confirmado por revisão externa (Codex CLI): várias rotas de
 * `/psychotherapy/groups/:groupId/members` eram registradas duas vezes em
 * `psychotherapyRoutes.ts`. No Express, a primeira rota registrada para um dado
 * (método, path) sempre vence — a segunda nunca era alcançada, mesmo tendo validação
 * Zod (`validateBody`/`validateQuery`) que a primeira não tinha.
 *
 * Execução real deste teste (03/07/2026) encontrou uma TERCEIRA duplicata não citada
 * pela revisão do Codex: `DELETE /psychotherapy/groups/:groupId/members/:patientId`.
 * Diferente de GET/POST members, as duas cópias do DELETE eram idênticas (mesmo
 * `validateParams(groupMemberParamSchema)`, mesmo handler) — redundante mas inofensiva.
 *
 * Corrigido em 04/07/2026 (item 5 do plano pós-Codex): removidas as 3 duplicatas,
 * mantendo as versões mais completas (com validateQuery/validateBody). Este teste agora
 * é a garantia de que a duplicação não volta — se alguém reintroduzir um registro
 * duplicado (aqui ou em qualquer outra rota do arquivo), o "sanity check" abaixo falha.
 *
 * Detecção de validação: `validateBody`/`validateQuery`/`validateParams` retornam
 * arrow functions ANÔNIMAS (sem `.name`), então checar `handler.name` não funciona.
 * A heurística usada aqui é o TAMANHO da cadeia de middlewares.
 */

import 'reflect-metadata';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-jest';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/test_db';

import { Router } from 'express';
import { createPsychotherapyRoutes } from '../psychotherapyRoutes';

interface RouteEntry {
    method: string;
    path: string;
    /** número de middlewares na cadeia da rota (inclui o handler final) — usado como
     *  proxy pra "quantidade de validação", já que os middlewares de validação são
     *  arrow functions anônimas e não dá pra identificá-los por nome. */
    stackLength: number;
}

/** Extrai (método, path, tamanho da cadeia) de cada rota, na ORDEM de registro. */
function extractRoutes(router: Router): RouteEntry[] {
    const entries: RouteEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack = (router as any).stack as any[];

    for (const layer of stack) {
        if (!layer.route) continue;
        const path = layer.route.path as string;
        const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
        const stackLength = (layer.route.stack as any[]).length;
        for (const method of methods) {
            entries.push({ method: method.toUpperCase(), path, stackLength });
        }
    }
    return entries;
}

describe('[REGRESSÃO] psychotherapyRoutes — sem rotas de grupo duplicadas', () => {
    const router = createPsychotherapyRoutes();
    const routes = extractRoutes(router);

    function findAll(method: string, path: string): RouteEntry[] {
        return routes.filter(r => r.method === method && r.path === path);
    }

    it('POST /psychotherapy/groups/:groupId/members está registrada exatamente 1 vez, com validateBody', () => {
        const matches = findAll('POST', '/psychotherapy/groups/:groupId/members');
        expect(matches).toHaveLength(1);
        // stackLength 3 = validateParams + validateBody + asyncHandler(handler)
        expect(matches[0].stackLength).toBe(3);
    });

    it('GET /psychotherapy/groups/:groupId/members está registrada exatamente 1 vez, com validateQuery', () => {
        const matches = findAll('GET', '/psychotherapy/groups/:groupId/members');
        expect(matches).toHaveLength(1);
        // stackLength 3 = validateParams + validateQuery + asyncHandler(handler)
        expect(matches[0].stackLength).toBe(3);
    });

    it('DELETE /psychotherapy/groups/:groupId/members/:patientId está registrada exatamente 1 vez', () => {
        const matches = findAll('DELETE', '/psychotherapy/groups/:groupId/members/:patientId');
        expect(matches).toHaveLength(1);
    });

    it('sanity check: nenhuma combinação (método, path) está registrada mais de uma vez em todo o arquivo', () => {
        const seen = new Map<string, number>();
        for (const r of routes) {
            const key = `${r.method} ${r.path}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        const duplicates = [...seen.entries()].filter(([, count]) => count > 1);

        // Lista vazia = sem duplicatas. Se este teste falhar, alguém reintroduziu um
        // registro duplicado — investigue qual rota antes de "corrigir" o teste.
        expect(duplicates).toEqual([]);
    });
});
