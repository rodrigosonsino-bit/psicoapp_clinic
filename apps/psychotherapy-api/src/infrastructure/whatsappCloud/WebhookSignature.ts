import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Valida a assinatura X-Hub-Signature-256 do webhook da Meta.
 *
 * CRÍTICO: a assinatura é calculada pela Meta sobre os BYTES BRUTOS do corpo da requisição —
 * nunca sobre `JSON.stringify(req.body)` depois de já parseado (a re-serialização pode diferir
 * byte a byte do original: ordem de chaves, espaçamento, escaping — qualquer diferença quebra a
 * validação silenciosamente ou, pior, aceita payloads forjados se a checagem for removida "porque
 * não bate"). Por isso o Express precisa entregar o Buffer bruto para esta função — ver a rota do
 * webhook, que usa express.raw() em vez de express.json() para este endpoint específico.
 */
export function isValidWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
        return false;
    }

    const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const expected = Buffer.from(expectedHex, 'utf8');
    const received = Buffer.from(signatureHeader.slice('sha256='.length), 'utf8');

    if (expected.length !== received.length) {
        return false;
    }

    return timingSafeEqual(expected, received);
}
