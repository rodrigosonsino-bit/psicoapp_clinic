import { WhatsappClient } from './src/infrastructure/whatsapp/WhatsappClient';
import { Pool } from 'pg';

async function run() {
    const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require' });
    
    // Pega o id do tenant
    const res = await pool.query('SELECT id FROM tenants LIMIT 1');
    const tenantId = res.rows[0].id;
    
    console.log('Inicializando cliente para o tenant:', tenantId);
    const client = new WhatsappClient(tenantId, pool);
    
    client.on('qr', () => console.log('QR Code requisitado'));
    client.on('ready', async () => {
        console.log('WhatsApp conectado!');
        try {
            console.log('Tentando enviar mensagem...');
            const id = await client.sendMessage('+5518996797983', 'teste13 (debug local direto)');
            console.log('Mensagem enviada! ID:', id);
        } catch (e) {
            console.error('ERRO AO ENVIAR MENSAGEM:', e);
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
