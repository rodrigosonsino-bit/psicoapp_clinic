const { Client } = require('pg');

const connectionString = 'postgresql://neondb_owner:npg_OilvbUx97fWr@ep-curly-hill-af1mhb7g-pooler.c-2.us-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require';

const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        await client.connect();
        console.log("Connected to Neon DB!");

        const query = `
            SELECT id, tenant_id, patient_id, scheduled_at, duration_minutes, status, google_event_id, google_event_url 
            FROM psychotherapy_appointments 
            WHERE scheduled_at >= '2026-06-05T00:00:00Z' AND scheduled_at <= '2026-06-10T23:59:59Z'
            ORDER BY scheduled_at DESC;
        `;
        const result = await client.query(query);
        console.log(`Found ${result.rows.length} appointments:`);
        result.rows.forEach(row => {
            console.log(`- ID: ${row.id}, tenant_id: ${row.tenant_id}, patient_id: ${row.patient_id}, scheduled_at: ${row.scheduled_at}, status: ${row.status}, google_event_id: ${row.google_event_id}`);
        });

    } catch (err) {
        console.error("Error:", err);
    } finally {
        await client.end();
    }
}

check();
