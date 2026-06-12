import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodIssue } from 'zod';

export function validateBody(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body);
        
        if (!result.success) {
            const errorDetails = result.error.issues.map((err: ZodIssue) => ({
                field: err.path.join('.'),
                message: err.message
            }));
            
            return res.status(400).json({
                error: 'Erro de validação de dados',
                details: errorDetails
            });
        }
        
        // Substitui o req.body pelo resultado sanitizado e parseado (remove propriedades não mapeadas no schema)
        req.body = result.data;
        next();
    };
}
