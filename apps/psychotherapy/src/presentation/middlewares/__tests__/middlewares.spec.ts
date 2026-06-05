import { errorHandler } from '../errorMiddleware';
import { validateBody, validateQuery, validateParams } from '../validationMiddleware';
import { asyncHandler } from '../asyncHandler';
import { AppError } from '../../../domain/errors/AppError';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

describe('Middlewares', () => {
    describe('asyncHandler', () => {
        it('should wrap async functions and catch rejection', async () => {
            const error = new Error('Async failure');
            const handler = asyncHandler(async (req, res, next) => {
                throw error;
            });
            const req = {} as Request;
            const res = {} as Response;
            const next = jest.fn() as unknown as NextFunction;

            await handler(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('errorHandler', () => {
        let req: Partial<Request>;
        let res: any;
        let next: NextFunction;

        beforeEach(() => {
            req = {
                method: 'GET',
                originalUrl: '/test'
            };
            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis(),
                headersSent: false
            };
            next = jest.fn();
        });

        it('should pass error to next if headers are already sent', () => {
            res.headersSent = true;
            const error = new Error('Already sent');
            errorHandler(error, req as Request, res as Response, next);
            expect(next).toHaveBeenCalledWith(error);
        });

        it('should format and respond with AppError properties', () => {
            const appError = new AppError('Business violation', 422);
            errorHandler(appError, req as Request, res as Response, next);
            expect(res.status).toHaveBeenCalledWith(422);
            expect(res.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Business violation'
            });
        });

        it('should format and respond with ZodError properties', () => {
            const zodError = new z.ZodError([
                {
                    code: 'invalid_type',
                    expected: 'string',
                    received: 'number',
                    path: ['name'],
                    message: 'Expected string, received number'
                }
            ]);
            errorHandler(zodError, req as Request, res as Response, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: 'error',
                message: 'Erro de validação de dados'
            }));
        });

        it('should handle general server errors with fallback 500 status', () => {
            const generalError = new Error('Database connection timeout');
            errorHandler(generalError, req as Request, res as Response, next);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('validationMiddleware', () => {
        const schema = z.object({
            id: z.string().uuid(),
            age: z.number().min(18)
        });

        let req: Partial<Request>;
        let res: any;
        let next: NextFunction;

        beforeEach(() => {
            req = {};
            res = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            next = jest.fn();
        });

        describe('validateBody', () => {
            it('should validate body and call next on success', () => {
                req.body = { id: 'e3b0c442-98fc-11ee-b9d1-0242ac120002', age: 25 };
                const middleware = validateBody(schema);
                middleware(req as Request, res as Response, next);
                expect(next).toHaveBeenCalled();
                expect(req.body).toEqual({ id: 'e3b0c442-98fc-11ee-b9d1-0242ac120002', age: 25 });
            });

            it('should fail with status 400 on invalid body schema', () => {
                req.body = { id: 'invalid-uuid', age: 10 };
                const middleware = validateBody(schema);
                middleware(req as Request, res as Response, next);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    error: 'Erro de validação de dados'
                }));
            });
        });

        describe('validateQuery', () => {
            it('should validate query parameters and call next on success', () => {
                req.query = { id: 'e3b0c442-98fc-11ee-b9d1-0242ac120002', age: '30' as any };
                const schemaWithCoercion = z.object({
                    id: z.string().uuid(),
                    age: z.preprocess((val) => Number(val), z.number())
                });
                const middleware = validateQuery(schemaWithCoercion);
                middleware(req as Request, res as Response, next);
                expect(next).toHaveBeenCalled();
            });

            it('should fail on invalid query parameter schema', () => {
                req.query = { id: 'invalid' };
                const middleware = validateQuery(schema);
                middleware(req as Request, res as Response, next);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    error: 'Erro de validação de query params'
                }));
            });
        });

        describe('validateParams', () => {
            it('should validate route params and call next on success', () => {
                req.params = { id: 'e3b0c442-98fc-11ee-b9d1-0242ac120002', age: 20 as any };
                const middleware = validateParams(schema);
                middleware(req as Request, res as Response, next);
                expect(next).toHaveBeenCalled();
            });

            it('should fail on invalid route parameter schema', () => {
                req.params = { id: 'invalid' };
                const middleware = validateParams(schema);
                middleware(req as Request, res as Response, next);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                    error: 'Erro de validação de parâmetros de rota'
                }));
            });
        });
    });
});
