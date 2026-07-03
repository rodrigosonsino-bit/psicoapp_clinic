import { WhatsappClient } from './src/infrastructure/whatsapp/WhatsappClient';
import { Pool } from 'pg';

async function run() {
    const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
    
    const res = await pool.query('SELECT id FROM tenants LIMIT 1');
    const tenantId = res.rows[0].id;
    
    console.log('Inicializando cliente para o tenant:', tenantId);
    const client = new WhatsappClient(tenantId, pool);
    
    client.on('qr', () => console.log('QR Code requisitado'));
    client.on('ready', async () => {
        console.log('WhatsApp conectado!');
        try {
            console.log('Testando onWhatsApp para +5518991498750...');
            const sock = (client as any).sock;
            
            const results13 = await sock.onWhatsApp('5518991498750');
            console.log('Resultado 13 digitos:', results13);
            
            const results12 = await sock.onWhatsApp('551891498750');
            console.log('Resultado 12 digitos:', results12);
            
        } catch (e) {
            console.error('ERRO:', e);
        } finally {
            client.close();
            await pool.end();
            process.exit(0);
        }
    });

    client.on('disconnected', () => {
        console.log('Desconectado');
        pool.end();
        process.exit(1);
    });

    await client.initialize();
}

run();
