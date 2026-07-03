const { Pool } = require('pg');
require('dotenv').config();

async function check() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const { rows } = await pool.query("SELECT id, name, email, password_hash, status FROM tenants WHERE email = 'rodrigosonsino@gmail.com';");
        console.log('User Rodrigo details:', rows);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

check();
