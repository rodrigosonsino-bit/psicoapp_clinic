const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'whatsapp_scheduler',
  password: 'secretpassword',
  port: 5432
});

pool.query("SELECT id, substring(content,1,60) as content, status, send_at FROM scheduled_messages WHERE id='1d70b553-306b-413f-9a10-9888cd6f4ea0'")
  .then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
