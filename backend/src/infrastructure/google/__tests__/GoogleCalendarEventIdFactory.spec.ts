import { GoogleCalendarEventIdFactory } from '../GoogleCalendarEventIdFactory';

describe('GoogleCalendarEventIdFactory', () => {
    const factory = new GoogleCalendarEventIdFactory();

    it('gera ID determinístico usando somente caracteres aceitos pelo Google', () => {
        const first = factory.create('tenant-1', 'appointment-1', 0);
        const second = factory.create('tenant-1', 'appointment-1', 0);

        expect(first).toBe(second);
        expect(first).toMatch(/^[a-v0-9]{5,1024}$/);
    });

    it('muda o ID quando a geração avança', () => {
        expect(factory.create('tenant-1', 'appointment-1', 0))
            .not.toBe(factory.create('tenant-1', 'appointment-1', 1));
    });

    it('rejeita geração inválida', () => {
        expect(() => factory.create('tenant-1', 'appointment-1', -1)).toThrow();
        expect(() => factory.create('tenant-1', 'appointment-1', 1.5)).toThrow();
    });
});
