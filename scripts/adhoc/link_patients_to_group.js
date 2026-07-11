const { Client } = require('pg');
const fs = require('fs');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  const files = fs.readdirSync('.');
  const reportFiles = files.filter(f => f.startsWith('import_report_') && f.endsWith('.json'));
  if (reportFiles.length === 0) {
    console.log('Nenhum relatório encontrado');
    process.exit(1);
  }
  
  // Sort by name (which has timestamp) to get the latest
  reportFiles.sort();
  const reportFile = reportFiles[reportFiles.length - 1];
  console.log('Usando relatório:', reportFile);
  
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const groupId = report.groupId;
  
  if (!groupId) {
    console.log('Sem groupId no relatório');
    process.exit(1);
  }
  
  const patientIds = report.results
    .filter(r => r.status === 'created' || r.status === 'existing')
    .map(r => r.patientId)
    .filter(id => !!id);

  console.log(`Encontrados ${patientIds.length} pacientes para vincular ao grupo ${groupId}`);

  for (const pid of patientIds) {
    try {
      await client.query(`
        INSERT INTO therapy_group_members (group_id, patient_id)
        VALUES ($1, $2)
        ON CONFLICT (group_id, patient_id) DO UPDATE SET left_at = NULL
      `, [groupId, pid]);
      console.log(`Vinculado paciente ${pid}`);
    } catch (e) {
      console.log(`Erro ao vincular ${pid}:`, e.message);
    }
  }

  await client.end();
  console.log('Finalizado!');
}

run().catch(console.error);
