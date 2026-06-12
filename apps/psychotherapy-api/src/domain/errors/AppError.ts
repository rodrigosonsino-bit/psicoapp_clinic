/**
 * Classe customizada de erros da aplicação.
 * Usada para diferenciar erros previstos/operacionais (como validações, recursos não encontrados, etc.)
 * de erros imprevistos de sistema (como queda de conexão com banco de dados).
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        // Mantém a stack trace correta (relevante no V8 / Node.js)
        Error.captureStackTrace(this, this.constructor);
    }
}
