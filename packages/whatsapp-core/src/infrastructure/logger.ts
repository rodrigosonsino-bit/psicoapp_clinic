import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
        paths: [
            'password',
            'passwordHash',
            'password_hash',
            'token',
            'access_token',
            'refresh_token',
            'client_secret',
            'stripe_customer_id',
            'req.headers.authorization'
        ],
        censor: '***'
    },
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard'
        }
    }
});
