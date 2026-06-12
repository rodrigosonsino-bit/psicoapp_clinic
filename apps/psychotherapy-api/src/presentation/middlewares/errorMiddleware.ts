import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../domain/errors/AppError';
import { logger } from '../../infrastructure/logger';

/**
 * Middleware global de tratamento de erros do Express.
 * Deve ser registrado como o último middleware na aplicação para capturar todos os erros
 * lançados ou encaminhados via next(err).
 */
export function errorHandler(
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) {
    const isProduction = process.env.NODE_ENV === 'production';

    // Log detalhado usando Pino
    logger.error({
        err: err.message || 'Erro sem mensagem',
        name: err.name || 'Error',
        statusCode: err.statusCode || 500,
        method: req.method,
        url: req.originalUrl,
        stack: isProduction ? undefined : err.stack
    }, '❌ [Express Global Error]');

    // Se a resposta já foi enviada, passa o erro adiante para o Express tratar
    if (res.headersSent) {
        return next(err);
    }

    // 1. Trata erros previstos da aplicação (AppError)
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: 'error',
            message: err.message
        });
    }

    // 2. Trata erros do Zod (validação de schemas)
    if (err.name === 'ZodError' || (err.issues && Array.isArray(err.issues))) {
        return res.status(400).json({
            status: 'error',
            message: 'Erro de validação de dados',
            details: err.issues || err.message
        });
    }

    // 3. Fallback para erros imprevistos de sistema (Erros 500)
    const statusCode = err.statusCode || 500;
    const message = isProduction 
        ? 'Ocorreu um erro interno no servidor.' 
        : err.message || 'Erro inesperado do servidor.';

    return res.status(statusCode).json({
        status: 'error',
        message,
        ...(isProduction ? {} : { stack: err.stack })
    });
}
