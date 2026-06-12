import { AppError } from '../AppError';
import { BusinessError } from '../BusinessError';
import { NotFoundError } from '../NotFoundError';

describe('Errors', () => {
  describe('AppError', () => {
    it('deve criar um erro com mensagem e status code', () => {
      const error = new AppError('Recurso não encontrado', 404);
      
      expect(error.message).toBe('Recurso não encontrado');
      expect(error.statusCode).toBe(404);
    });

    it('deve ter status code padrão de 400', () => {
      const error = new AppError('Erro genérico');
      
      expect(error.statusCode).toBe(400);
    });

    it('deve ser uma instância de Error', () => {
      const error = new AppError('Teste', 500);
      
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('BusinessError', () => {
    it('deve criar um erro com status 422 e nome correto', () => {
      const error = new BusinessError('Regra de negócio violada');
      expect(error.statusCode).toBe(422);
      expect(error.message).toBe('Regra de negócio violada');
      expect(error.name).toBe('BusinessError');
    });
  });

  describe('NotFoundError', () => {
    it('deve criar um erro com status 404 e nome correto', () => {
      const error = new NotFoundError('Não encontrado');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('Não encontrado');
      expect(error.name).toBe('NotFoundError');
    });
  });
});
