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
        
        req.body = result.data;
        next();
    };
}

export function validateQuery(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query);
        
        if (!result.success) {
            const errorDetails = result.error.issues.map((err: ZodIssue) => ({
                field: err.path.join('.'),
                message: err.message
            }));
            
            return res.status(400).json({
                error: 'Erro de validação de query params',
                details: errorDetails
            });
        }
        
        req.query = result.data;
        next();
    };
}

export function validateParams(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.params);
        
        if (!result.success) {
            const errorDetails = result.error.issues.map((err: ZodIssue) => ({
                field: err.path.join('.'),
                message: err.message
            }));
            
            return res.status(400).json({
                error: 'Erro de validação de parâmetros de rota',
                details: errorDetails
            });
        }
        
        req.params = result.data;
        next();
    };
}
