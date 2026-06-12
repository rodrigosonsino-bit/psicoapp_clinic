import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgresql://postgres:XbKiVjSivAwaKAkJgpQqeBaUfDnoTfiW@mainline.proxy.rlwy.net:21626/railway' });
const res = await pool.query(
  "SELECT id, email, name, plan, status, is_admin FROM tenants WHERE email = 'rodrigosonsino@gmail.com'"
);
console.log(JSON.stringify(res.rows[0], null, 2));
await pool.end();
