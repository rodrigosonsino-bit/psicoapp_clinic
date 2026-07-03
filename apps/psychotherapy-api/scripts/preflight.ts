import { Pool } from 'pg';
import 'dotenv/config';

async function runPreflight() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });
    const client = await pool.connect();
    
    try {
        console.log('Running preflight to check financial_payments uniqueness on group_payment_id...');
        const result = await client.query(`
            SELECT tenant_id, group_payment_id, COUNT(*) as qty
            FROM financial_payments
            WHERE group_payment_id IS NOT NULL
            GROUP BY tenant_id, group_payment_id
            HAVING COUNT(*) > 1;
        `);
        
        if (result.rows.length > 0) {
            console.error('❌ PREFLIGHT FAILED: Duplicates found in financial_payments for group_payment_id!');
            console.table(result.rows);
            process.exit(1);
        } else {
            console.log('✅ Preflight passed! No duplicates found.');
        }
    } finally {
        client.release();
        await pool.end();
    }
}

runPreflight().catch(err => {
    console.error('Preflight error:', err);
    process.exit(1);
});
