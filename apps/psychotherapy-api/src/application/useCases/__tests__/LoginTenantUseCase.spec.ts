import 'reflect-metadata';
process.env.JWT_SECRET = 'test-secret-key-very-secure';

import { LoginTenantUseCase } from '../LoginTenantUseCase';
import { IAuthRepository } from '../../../domain/repositories/IAuthRepository';
import { AppError } from '../../../domain/errors/AppError';
import bcrypt from 'bcrypt';

describe('LoginTenantUseCase', () => {
    let mockRepository: jest.Mocked<IAuthRepository>;
    let useCase: LoginTenantUseCase;

    beforeEach(() => {
        mockRepository = {
            findTenantByEmail: jest.fn(),
            createTenant: jest.fn(),
            findTenantById: jest.fn(),
            saveRefreshToken: jest.fn(),
            findRefreshToken: jest.fn(),
            revokeRefreshToken: jest.fn(),
            revokeAllRefreshTokens: jest.fn()
        } as unknown as jest.Mocked<IAuthRepository>;

        useCase = new LoginTenantUseCase(mockRepository);
    });

    it('deve realizar login com sucesso se credenciais forem corretas', async () => {
        const input = {
            email: 'john.doe@example.com',
            password: 'password123'
        };

        const passwordHash = await bcrypt.hash('password123', 12);

        mockRepository.findTenantByEmail.mockResolvedValue({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            passwordHash,
            plan: 'starter',
            status: 'trial'
        });

        const result = await useCase.execute(input);

        expect(result).toHaveProperty('accessToken');
        expect(result).toHaveProperty('refreshToken');
        expect((result as any).tenant).toEqual({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            plan: 'starter'
        });
        expect(mockRepository.revokeAllRefreshTokens).toHaveBeenCalledWith('tenant-uuid');
        expect(mockRepository.saveRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('deve lançar AppError se as credenciais forem inválidas (email não encontrado)', async () => {
        const input = {
            email: 'notfound@example.com',
            password: 'password123'
        };

        mockRepository.findTenantByEmail.mockResolvedValue(null);

        await expect(useCase.execute(input)).rejects.toThrow(AppError);
        await expect(useCase.execute(input)).rejects.toThrow('Credenciais inválidas');
    });

    it('deve lançar AppError se as credenciais forem inválidas (senha incorreta)', async () => {
        const input = {
            email: 'john.doe@example.com',
            password: 'wrongpassword'
        };

        const passwordHash = await bcrypt.hash('password123', 12);

        mockRepository.findTenantByEmail.mockResolvedValue({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            passwordHash,
            plan: 'starter',
            status: 'trial'
        });

        await expect(useCase.execute(input)).rejects.toThrow(AppError);
        await expect(useCase.execute(input)).rejects.toThrow('Credenciais inválidas');
    });
});
