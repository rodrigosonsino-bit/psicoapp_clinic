import 'reflect-metadata';
process.env.JWT_SECRET = 'test-secret-key-very-secure';

import { RefreshTokenUseCase } from '../RefreshTokenUseCase';
import { IAuthRepository } from '../../../domain/repositories/IAuthRepository';
import { AppError } from '../../../domain/errors/AppError';

describe('RefreshTokenUseCase', () => {
    let mockRepository: jest.Mocked<IAuthRepository>;
    let useCase: RefreshTokenUseCase;

    beforeEach(() => {
        mockRepository = {
            findTenantByEmail: jest.fn(),
            createTenant: jest.fn(),
            findTenantById: jest.fn(),
            saveRefreshToken: jest.fn(),
            findRefreshToken: jest.fn(),
            revokeRefreshToken: jest.fn(),
            revokeAllRefreshTokens: jest.fn(),
            saveTotpSecret: jest.fn(),
            enableTotp: jest.fn(),
            disableTotp: jest.fn(),
            consumeBackupCode: jest.fn(),
            save2faChallenge: jest.fn(),
            rotateRefreshToken: jest.fn()
        } as unknown as jest.Mocked<IAuthRepository>;

        useCase = new RefreshTokenUseCase(mockRepository);
    });

    it('deve renovar o token com sucesso se o refresh token for válido', async () => {
        const refreshToken = '4df1a41b-41ad-4ca1-9e17-6a99e863aa9f'; // uuid format

        mockRepository.rotateRefreshToken.mockResolvedValue({
            tenantId: 'tenant-uuid',
            familyId: 'family-uuid'
        });

        mockRepository.findTenantById.mockResolvedValue({
            id: 'tenant-uuid',
            name: 'John Doe',
            email: 'john.doe@example.com',
            passwordHash: 'somehash',
            plan: 'starter',
            status: 'trial'
        });

        const result = await useCase.execute(refreshToken);

        expect(result).toHaveProperty('accessToken');
        expect(result).toHaveProperty('refreshToken');
        expect(mockRepository.rotateRefreshToken).toHaveBeenCalledTimes(1);
    });

    it('deve lançar AppError se o refresh token não for encontrado ou estiver expirado', async () => {
        const refreshToken = '4df1a41b-41ad-4ca1-9e17-6a99e863aa9f';
        mockRepository.rotateRefreshToken.mockResolvedValue(null);

        await expect(useCase.execute(refreshToken)).rejects.toThrow(AppError);
    });

    it('deve lançar AppError se o tenant não for encontrado', async () => {
        const refreshToken = '4df1a41b-41ad-4ca1-9e17-6a99e863aa9f';

        mockRepository.rotateRefreshToken.mockResolvedValue({
            tenantId: 'tenant-uuid',
            familyId: 'family-uuid'
        });

        mockRepository.findTenantById.mockResolvedValue(null);

        await expect(useCase.execute(refreshToken)).rejects.toThrow(AppError);
        await expect(useCase.execute(refreshToken)).rejects.toThrow('Tenant não encontrado');
    });
});
