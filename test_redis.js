const IORedis = require('ioredis');
const { Queue } = require('bullmq');

const redis = new IORedis(process.env.REDIS_URL || 'redis://default:nStiXFkPzCmsYqgUaALwIuJzBvwbIDzS@redis-68x2.railway.internal:6379');
const queue = new Queue('whatsapp-messages', { connection: redis });

async function checkQueue() {
    console.log("Waiting:", await queue.getWaitingCount());
    console.log("Active:", await queue.getActiveCount());
    console.log("Delayed:", await queue.getDelayedCount());
    console.log("Failed:", await queue.getFailedCount());
    
    const delayed = await queue.getDelayed();
    console.log("Delayed Jobs:", delayed.map(j => j.id));

    const waiting = await queue.getWaiting();
    console.log("Waiting Jobs:", waiting.map(j => j.id));

    const active = await queue.getActive();
    console.log("Active Jobs:", active.map(j => j.id));

    process.exit(0);
}

checkQueue().catch(console.error);
