import IORedis from 'ioredis';
import { Queue } from 'bullmq';

async function run() {
    const redis = new IORedis('redis://default:AOBXxGvaFHsNEhlARGgpERbLWuiAWVvT@redis.railway.internal:6379');
    const queue = new Queue('whatsapp-messages', { connection: redis as any });
    
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const delayed = await queue.getDelayedCount();
    const failed = await queue.getFailedCount();
    
    console.log({ waiting, active, delayed, failed });
    
    const failedJobs = await queue.getFailed();
    for (const job of failedJobs) {
        console.log('Failed job:', job.id, job.failedReason);
    }
    
    process.exit(0);
}
run().catch(console.error);
