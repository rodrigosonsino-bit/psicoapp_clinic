import 'reflect-metadata';
process.env.JWT_SECRET = 'test-secret-key-very-secure';

import { RegisterTenantUseCase } from '../RegisterTenantUseCase';
import { IAuthRepository } from '../../../domain/repositories/IAuthRepository';
import { AppError } from '../../../domain/errors/AppError';

describe('RegisterTenantUseCase', () => {
    let mockRepository: jest.Mocked<IAuthRepository>;
    let useCase: RegisterTenantUseCase;

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

        useCase = new RegisterTenantUseCase(mockRepository);
    });

    it('deve registrar um novo tenant com sucesso', async () => {
        const input = {
            name: 'John Doe',
            email: 'john.doe@example.com',
            password: 'password123'
        };

        mockRepository.findTenantByEmail.mockResolvedValue(null);
        mockRepository.createTenant.mockResolvedValue({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            passwordHash: 'hashed-password',
            plan: 'starter',
            status: 'trial'
        });

        const result = await useCase.execute(input);

        expect(result).toHaveProperty('accessToken');
        expect(result).toHaveProperty('refreshToken');
        expect(result.tenant).toEqual({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            plan: 'starter'
        });
        expect(mockRepository.createTenant).toHaveBeenCalledTimes(1);
        expect(mockRepository.saveRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('deve lançar AppError se o email já estiver cadastrado', async () => {
        const input = {
            name: 'John Doe',
            email: 'john.doe@example.com',
            password: 'password123'
        };

        mockRepository.findTenantByEmail.mockResolvedValue({
            id: 'existing-id',
            name: 'John Doe',
            email: 'john.doe@example.com',
            passwordHash: 'somehash',
            plan: 'starter',
            status: 'trial'
        });

        await expect(useCase.execute(input)).rejects.toThrow(AppError);
        await expect(useCase.execute(input)).rejects.toThrow('Email já cadastrado');
    });
});
