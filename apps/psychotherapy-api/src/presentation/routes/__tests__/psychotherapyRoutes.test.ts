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
 * Execução real deste teste (03/07/2026) encontrou uma TERCEIRA duplicata não citada
 * pela revisão do Codex: `DELETE /psychotherapy/groups/:groupId/members/:patientId`
 * (linhas 259 e 559). Diferente de GET/POST members, as duas cópias do DELETE são
 * idênticas (mesmo `validateParams(groupMemberParamSchema)`, mesmo handler) — é
 * duplicação redundante e inofensiva, não um bypass de validação. Documentado abaixo
 * distinguindo os dois casos.
 *
 * Detecção de validação: `validateBody`/`validateQuery`/`validateParams` retornam
 * arrow functions ANÔNIMAS (sem `.name`), então checar `handler.name` não funciona
 * (tentativa inicial deste teste confirmou isso na prática — sempre dava falso negativo).
 * A heurística usada aqui é o TAMANHO da cadeia de middlewares: a rota com Zod tem um
 * middleware a mais do que a rota sem — comparação relativa, não detecção por nome.
 *
 * Este teste documenta o estado ATUAL (duplicatas existem) e serve de critério de
 * aceite para a fase 5 do plano de correções ("consolidar rotas duplicadas de grupo"):
 * quando a duplicação for removida, os asserts marcados "← comportamento errado,
 * documentado" devem ser invertidos.
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

    it('BUG: a primeira rota registrada de POST members (com cadeia MENOR, ou seja menos validação) é a que o Express de fato executa — a versão com validateBody é código morto', () => {
        const matches = findAll('POST', '/psychotherapy/groups/:groupId/members');
        expect(matches.length).toBeGreaterThan(1);

        // Express sempre executa a PRIMEIRA rota que casa (método, path) — as demais nunca
        // são alcançadas para esse par exato.
        const winner = matches[0];
        const shadowed = matches.slice(1);

        // Comportamento ATUAL (com bug): a rota vencedora tem MENOS middlewares (sem
        // validateBody) do que pelo menos uma das rotas sombreadas (com validateBody).
        // Pós-fix: só deve sobrar 1 rota, com a cadeia MAIOR (validada).
        expect(shadowed.some(r => r.stackLength > winner.stackLength)).toBe(true);
    });

    it('BUG: GET members com validateQuery também é sombreado pela versão sem validação', () => {
        const matches = findAll('GET', '/psychotherapy/groups/:groupId/members');
        expect(matches.length).toBeGreaterThan(1);

        const winner = matches[0];
        const shadowed = matches.slice(1);
        expect(shadowed.some(r => r.stackLength > winner.stackLength)).toBe(true);
    });

    it('sanity check: mapeia TODAS as duplicatas de (método, path) hoje — 3 conhecidas, 1 delas inofensiva', () => {
        const seen = new Map<string, number>();
        for (const r of routes) {
            const key = `${r.method} ${r.path}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
        }
        const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
        const duplicateKeys = duplicates.map(([key]) => key).sort();

        // Lista fechada do que sabemos estar duplicado hoje: GET/POST members (bug real —
        // validação sombreada, ver testes acima) + DELETE members/:patientId (duplicata
        // redundante mas INÓFENSIVA — as duas cópias são idênticas, mesmo validateParams).
        // Se este teste falhar porque apareceu uma chave NOVA aqui, é uma duplicata adicional
        // não documentada — investigar antes de simplesmente atualizar a lista.
        expect(duplicateKeys).toEqual([
            'DELETE /psychotherapy/groups/:groupId/members/:patientId',
            'GET /psychotherapy/groups/:groupId/members',
            'POST /psychotherapy/groups/:groupId/members',
        ]);

        // Confirma que o DELETE duplicado é de fato inofensivo (cadeias de mesmo tamanho,
        // nenhuma validação extra sendo sombreada) — distingue do caso GET/POST.
        const deleteMatches = findAll('DELETE', '/psychotherapy/groups/:groupId/members/:patientId');
        const stackLengths = deleteMatches.map(r => r.stackLength);
        expect(new Set(stackLengths).size).toBe(1); // todas as cópias têm a mesma cadeia
    });
});
