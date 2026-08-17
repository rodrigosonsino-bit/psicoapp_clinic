import { redactBookingToken } from '../urlRedaction';

describe('redactBookingToken', () => {
    it('redige o token de /api/book-public/:token', () => {
        expect(redactBookingToken('/api/book-public/b854e34e-ae58-4417-8999-7326be98c890'))
            .toBe('/api/book-public/:token');
    });

    it('redige o token de /api/book/:token', () => {
        expect(redactBookingToken('/api/book/b854e34e-ae58-4417-8999-7326be98c890'))
            .toBe('/api/book/:token');
    });

    it('redige mesmo um token malformado (não-UUID)', () => {
        expect(redactBookingToken('/api/book-public/not-a-real-uuid'))
            .toBe('/api/book-public/:token');
    });

    it('preserva sufixo de path após o token', () => {
        expect(redactBookingToken('/api/book-public/abc123/extra'))
            .toBe('/api/book-public/:token/extra');
    });

    it('não mexe em URLs sem token de agendamento', () => {
        expect(redactBookingToken('/api/psychotherapy/patients'))
            .toBe('/api/psychotherapy/patients');
    });

    it('preserva query string após o token', () => {
        expect(redactBookingToken('/api/book-public/abc123?foo=bar'))
            .toBe('/api/book-public/:token?foo=bar');
    });
});
