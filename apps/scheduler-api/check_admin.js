const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAdmin() {
    const res = await pool.query(
        "SELECT id, email, is_admin, plan, status FROM tenants WHERE email = 'rodrigosonsino@gmail.com'"
    );
    console.log(JSON.stringify(res.rows[0], null, 2));
    await pool.end();
}

checkAdmin();
