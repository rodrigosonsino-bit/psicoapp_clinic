const { Pool } = require('pg');
require('dotenv').config();

async function resolve() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        console.log('Resolvendo agendamentos sobrepostos...');
        await client.query("UPDATE psychotherapy_appointments SET status = 'canceled' WHERE id = '917403b6-0ff8-44ac-877e-2bd503281120';");
        console.log('Concluído!');
    } finally {
        client.release();
        await pool.end();
    }
}

resolve();
