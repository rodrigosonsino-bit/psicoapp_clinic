const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'whatsapp_scheduler',
  password: 'secretpassword',
  port: 5432
});

pool.query("SELECT id, substring(content,1,50) as content_preview, status FROM scheduled_messages WHERE status='pending' LIMIT 3")
  .then(res => {
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error(err.message);
    process.exit(1);
  });
