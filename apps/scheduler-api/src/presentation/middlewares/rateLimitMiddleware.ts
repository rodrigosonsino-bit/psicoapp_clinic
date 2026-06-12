import { rateLimit } from 'express-rate-limit';

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 5, // Limite de 5 requisições por IP
    standardHeaders: 'draft-7', // Retorna informações de limite nos cabeçalhos RateLimit-*
    legacyHeaders: false, // Desativa os cabeçalhos X-RateLimit-* legados
    message: {
        error: 'Muitas tentativas de login ou registro. Por favor, tente novamente após 15 minutos.'
    }
});

export const webhookLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    limit: 100, // Limite de 100 requisições por IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Limite de requisições de webhook excedido.'
    }
});

export const globalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    limit: 1000, // Limite de 1000 requisições por IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Muitas requisições vindas deste IP. Por favor, tente novamente mais tarde.'
    }
});
