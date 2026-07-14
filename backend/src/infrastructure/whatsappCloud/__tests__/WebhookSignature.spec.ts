import { createHmac } from 'crypto';
import { isValidWebhookSignature } from '../WebhookSignature';

describe('isValidWebhookSignature', () => {
    const appSecret = 'test-app-secret';
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

    function sign(body: Buffer, secret: string): string {
        return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    }

    it('accepts a signature computed correctly over the exact raw bytes', () => {
        const signature = sign(rawBody, appSecret);
        expect(isValidWebhookSignature(rawBody, signature, appSecret)).toBe(true);
    });

    it('rejects a signature computed with the wrong secret', () => {
        const signature = sign(rawBody, 'wrong-secret');
        expect(isValidWebhookSignature(rawBody, signature, appSecret)).toBe(false);
    });

    it('rejects when the raw body was tampered after signing (byte-level check, not re-serialized JSON)', () => {
        const signature = sign(rawBody, appSecret);
        const tamperedBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{}] }));
        expect(isValidWebhookSignature(tamperedBody, signature, appSecret)).toBe(false);
    });

    it('rejects when the header is missing', () => {
        expect(isValidWebhookSignature(rawBody, undefined, appSecret)).toBe(false);
    });

    it('rejects when the header does not start with sha256=', () => {
        const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
        expect(isValidWebhookSignature(rawBody, digest, appSecret)).toBe(false);
    });

    it('rejects a signature of different length without throwing (timingSafeEqual length mismatch)', () => {
        expect(isValidWebhookSignature(rawBody, 'sha256=deadbeef', appSecret)).toBe(false);
    });
});
