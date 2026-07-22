import 'dotenv/config';
import 'reflect-metadata';
import '../container';
import { container } from 'tsyringe';
import { Pool } from 'pg';
import { EmailBankStatementPollUseCase } from '../application/useCases/EmailBankStatementPollUseCase';

async function run() {
    const pool = container.resolve(Pool);
    console.log("Cleaning up rejected_sender bank statement email imports...");
    
    // Delete rejected_sender messages so they get re-processed
    const deleteRes = await pool.query(
        `DELETE FROM psychotherapy_bank_statement_email_imports WHERE status = 'rejected_sender'`
    );
    console.log(`Deleted ${deleteRes.rowCount} rejected_sender rows.`);

    console.log("Starting manual email poll...");
    const pollUseCase = container.resolve(EmailBankStatementPollUseCase);
    
    try {
        await pollUseCase.execute();
        console.log("Polling completed successfully.");

        // Check new status counts
        const statusRes = await pool.query(
            `SELECT status, COUNT(*) as count 
             FROM psychotherapy_bank_statement_email_imports 
             GROUP BY status`
        );
        console.log("New Email Imports Status Counts:");
        console.log(statusRes.rows);

        // Check new error details if any
        const errorsRes = await pool.query(
            `SELECT status, error_detail, COUNT(*) as count 
             FROM psychotherapy_bank_statement_email_imports 
             WHERE status != 'processed'
             GROUP BY status, error_detail`
        );
        console.log("New Error Details:");
        console.log(errorsRes.rows);
        
    } catch (err) {
        console.error("Error running poll:", err);
    }
    
    await pool.end();
    process.exit(0);
}

run();
