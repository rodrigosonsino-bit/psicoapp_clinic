import { container } from 'tsyringe';
import { Pool } from 'pg';
import { PostgresPsychotherapyRepository } from './infrastructure/repositories/PostgresPsychotherapyRepository';
import { PostgresAuthRepository } from './infrastructure/repositories/PostgresAuthRepository';
import { MockPixProvider } from './infrastructure/pix/MockPixProvider';
import { EfiBankPixProvider } from './infrastructure/pix/EfiBankPixProvider';
import { GoogleCalendarService } from './infrastructure/google/GoogleCalendarService';
import { WhatsappSessionManager } from '@antigravity/whatsapp-core';

// Register DB Pool lazily using a factory to prevent side-effects/connections during module loading/imports
let dbPoolInstance: Pool | null = null;
container.register(Pool, {
    useFactory: () => {
        if (!dbPoolInstance) {
            dbPoolInstance = new Pool({ connectionString: process.env.DATABASE_URL });
        }
        return dbPoolInstance;
    }
});

// Register Repositories
container.registerSingleton('IPsychotherapyRepository', PostgresPsychotherapyRepository);
container.registerSingleton('IAuthRepository', PostgresAuthRepository);

// Register Pix Provider (mock em dev/test, Efí Bank em produção)
const useRealPix = process.env.PIX_PROVIDER === 'efibank';
container.registerSingleton('IPixProvider', useRealPix ? EfiBankPixProvider : MockPixProvider);

// Google Calendar Service
container.registerSingleton('GoogleCalendarService', GoogleCalendarService);

// WhatsApp Session Manager (singleton — inicializado em server.ts via initializeAll)
container.registerInstance('WhatsappSessionManager', new WhatsappSessionManager());

export { container };
