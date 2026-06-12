import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

describe('JwtService', () => {
  let jwtSecret: string;

  beforeEach(() => {
    jwtSecret = 'test-secret-key-very-secure';
  });

  describe('generateToken', () => {
    it('deve gerar um token JWT válido', () => {
      const payload = {
        tenantId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
        email: 'test@example.com',
        plan: 'premium',
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn: '7d' });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('deve incluir o tenantId no token', () => {
      const payload = {
        tenantId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
        email: 'test@example.com',
        plan: 'premium',
      };

      const token = jwt.sign(payload, jwtSecret);
      const decoded = jwt.verify(token, jwtSecret) as typeof payload;

      expect(decoded.tenantId).toBe(payload.tenantId);
    });
  });

  describe('verifyToken', () => {
    it('deve verificar um token válido', () => {
      const payload = {
        tenantId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
        email: 'test@example.com',
        plan: 'premium',
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn: '7d' });
      const decoded = jwt.verify(token, jwtSecret) as typeof payload;

      expect(decoded).toMatchObject(payload);
    });

    it('deve lançar erro para token inválido', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => {
        jwt.verify(invalidToken, jwtSecret);
      }).toThrow();
    });

    it('deve lançar erro para token expirado', () => {
      const payload = {
        tenantId: 'e3b0c442-98fc-11ee-b9d1-0242ac120002',
        email: 'test@example.com',
        plan: 'premium',
      };

      const expiredToken = jwt.sign(payload, jwtSecret, { expiresIn: '-1s' });

      expect(() => {
        jwt.verify(expiredToken, jwtSecret);
      }).toThrow();
    });
  });
});
