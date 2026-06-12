const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function main() {
  // Connect to default postgres DB to create the new database
  const client = new Client({
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'secretpassword',
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'postgres'
  });

  await client.connect();
  
  try {
    await client.query('CREATE DATABASE psychotherapy_dev');
    console.log('Database created');
  } catch(e) {
    console.log('Database already exists or error:', e.message);
  }
  
  await client.end();

  // Now connect to the new DB and apply migrations
  const appClient = new Client({
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'secretpassword',
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: 'psychotherapy_dev'
  });

  await appClient.connect();

  const migrationsDir = path.join(__dirname, 'scripts', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await appClient.query(sql);
  }

  // Also create default tenant if needed
  try {
      await appClient.query(`
        INSERT INTO tenants (id, name, email) 
        VALUES ('00000000-0000-0000-0000-000000000000', 'Admin', 'admin@admin.com')
        ON CONFLICT DO NOTHING;
      `);
      console.log('Default tenant seeded');
  } catch(e) {
      console.log('Error seeding tenant:', e.message);
  }

  await appClient.end();
  console.log('All migrations applied successfully');
}

main().catch(console.error);
