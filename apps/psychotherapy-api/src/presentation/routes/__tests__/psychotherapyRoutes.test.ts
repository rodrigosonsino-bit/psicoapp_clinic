/**
 * psychotherapyRoutes.test.ts
 *
 * Teste de CARACTERIZAÇÃO (não de correção) do bug de rotas duplicadas encontrado na
 * auditoria de 03/07/2026 e confirmado por revisão externa (Codex CLI): várias rotas de
 * `/psychotherapy/groups/:groupId/members` são registradas duas vezes em
 * `psychotherapyRoutes.ts`. No Express, a primeira rota registrada para um dado
 * (método, path) sempre vence — a segunda nunca é alcançada, mesmo que tenha validação
 * Zod (`validateBody`/`validateQuery`) que a primeira não tem.
 *
 * Este teste documenta o estado ATUAL (duplicatas existem) e serve de critério de
 * aceite para a fase 5 do plano de correções ("consolidar rotas duplicadas de grupo"):
 * quando a duplicação for removida, os asserts abaixo devem ser invertidos
 * (`toHaveLength(1)` / `toBe(true)` para "handler validado é alcançável").
 */

import 'reflect-metadata';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-jest';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/test_db';

import { Router } from 'express';
import { createPsychotherapyRoutes } from '../psychotherapyRoutes';

interface RouteEntry {
    method: string;
    path: string;
    /** true se algum middleware de validação (validateBody/validateQuery/validateParams) está na cadeia */
    hasValidation: boolean;
}

/** Extrai (método, path) de cada rota registrada no router, na ORDEM de registro. */
function extractRoutes(router: Router): RouteEntry[] {
    const entries: RouteEntry[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack = (router as any).stack as any[];

    for (const layer of stack) {
        if (!layer.route) continue;
        const path = layer.route.path as string;
        const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m]);
        // handlers da rota incluem os middlewares registrados + o handler final (asyncHandler)
        const handlerNames = (layer.route.stack as any[]).map(h => h.name || h.handle?.name || '');
        const hasValidation = handlerNames.some(name =>
            /validate/i.test(name)
        );
        for (const method of methods) {
            entries.push({ method: method.toUpperCase(), path, hasValidation });
        }
    }
    return entries;
}

describe('[CARACTERIZAÇÃO] psychotherapyRoutes — rotas de grupo duplicadas', () => {
    const router = createPsychotherapyRoutes();
    const routes = extractRoutes(router);

    function findAll(method: string, path: string): RouteEntry[] {
        return routes.filter(r => r.method === method && r.path === path);
    }

    it('BUG: POST /psychotherapy/groups/:groupId/members está registrada mais de uma vez', () => {
        const matches = findAll('POST', '/psychotherapy/groups/:groupId/members');
        // Comportamento ATUAL (com bug): 2 registros para o mesmo (método, path).
        // Pós-fix (fase 5 do plano): deve haver exatamente 1.
        expect(matches.length).toBeGreaterThan(1);
    });

    it('BUG: GET /psychotherapy/groups/:groupId/members está registrada mais de uma vez', () => {
        const matches = findAll('GET', '/psychotherapy/groups/:groupId/members');
        expect(matches.length).toBeGreaterThan(1);
    });

    it('BUG: a primeira rota registrada de POST members (sem validação) é a que o Express de fato executa — a versão validada é código morto', () => {
        const matches = findAll('POST', '/psychotherapy/groups/:groupId/members');
        expect(matches.length).toBeGreaterThan(1);

        // Express sempre executa a PRIMEIRA rota que casa (método, path) — as demais nunca
        // são alcançadas para esse par exato.
        const winner = matches[0];
        const shadowed = matches.slice(1);

        // Comportamento ATUAL (com bug): a rota vencedora NÃO tem validateBody.
        // Pós-fix: só deve sobrar 1 rota, e ela DEVE ter validação.
        expect(winner.hasValidation).toBe(false);
        expect(shadowed.some(r => r.hasValidation)).toBe(true); // a validação existe, mas é inalcançável
    });

    it('sanity check: não há OUTRAS duplicatas de (método, path) além das já conhecidas em grupos', () => {
        const seen = new Map<string, number>();
        for (const r of routes) {
            const key = `${r.method} ${r.path}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
        const duplicateKeys = duplicates.map(([key]) => key).sort();

        // Lista fechada do que já sabemos que está duplicado hoje (achado da auditoria).
        // Se este teste falhar porque apareceu uma chave NOVA aqui, é uma duplicata adicional
        // não documentada — investigar antes de simplesmente atualizar a lista.
        expect(duplicateKeys).toEqual([
            'GET /psychotherapy/groups/:groupId/members',
            'POST /psychotherapy/groups/:groupId/members',
        ]);
    });
});
