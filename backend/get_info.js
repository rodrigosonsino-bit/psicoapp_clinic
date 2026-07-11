const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const tenants = await client.query('SELECT * FROM tenants LIMIT 1');
  if (tenants.rows.length === 0) {
    console.log('Nenhum tenant encontrado.');
    process.exit(1);
  }
  const tenant = tenants.rows[0];
  console.log('Tenant ID:', tenant.id);

  const groups = await client.query('SELECT * FROM therapy_groups WHERE tenant_id = $1 LIMIT 1', [tenant.id]);
  let groupId;
  if (groups.rows.length > 0) {
    groupId = groups.rows[0].id;
    console.log('Grupo existente encontrado:', groupId, '-', groups.rows[0].name);
  } else {
    const res = await client.query(`
      INSERT INTO therapy_groups (tenant_id, name, session_price_cents, duration_minutes, is_active)
      VALUES ($1, 'Grupo de Estudo/Terapia', 15000, 90, true)
      RETURNING id
    `, [tenant.id]);
    groupId = res.rows[0].id;
    console.log('Novo grupo criado:', groupId);
  }

  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { tenantId: tenant.id, email: tenant.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  console.log('---TOKEN---');
  console.log(token);
  console.log('---GROUP_ID---');
  console.log(groupId);

  await client.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
