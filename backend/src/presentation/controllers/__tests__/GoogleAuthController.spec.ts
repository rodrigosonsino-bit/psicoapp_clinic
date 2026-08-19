import 'reflect-metadata';
import { GoogleAuthController } from '../GoogleAuthController';
import { GoogleCalendarService } from '../../../infrastructure/google/GoogleCalendarService';
import { IPsychotherapyRepository } from '../../../domain/repositories/IPsychotherapyRepository';
import { Request, Response } from 'express';

describe('GoogleAuthController — callback (ativação da transcrição do Meet)', () => {
    let googleCalendar: jest.Mocked<GoogleCalendarService>;
    let repository: jest.Mocked<IPsychotherapyRepository>;
    let controller: GoogleAuthController;

    const makeRes = (): jest.Mocked<Response> => ({
        redirect: jest.fn()
    } as unknown as jest.Mocked<Response>);

    beforeEach(() => {
        googleCalendar = {
            exchangeCodeForTokens: jest.fn()
        } as unknown as jest.Mocked<GoogleCalendarService>;

        repository = {
            activateMeetTranscription: jest.fn(),
            updateTenantProfile: jest.fn(),
            upsertTranscriptionIntegration: jest.fn()
        } as unknown as jest.Mocked<IPsychotherapyRepository>;

        controller = new GoogleAuthController(googleCalendar, repository);
    });

    it('chama activateMeetTranscription (1 escrita atômica), não as 2 chamadas soltas antigas', async () => {
        googleCalendar.exchangeCodeForTokens.mockResolvedValue({
            tenantId: 'tenant-1', intent: 'meet_transcription', tokens: {}
        });

        const req = { query: { code: 'abc', state: 'xyz' } } as unknown as Request;
        const res = makeRes();

        await controller.callback(req, res);

        expect(repository.activateMeetTranscription).toHaveBeenCalledWith('tenant-1');
        expect(repository.updateTenantProfile).not.toHaveBeenCalled();
        expect(repository.upsertTranscriptionIntegration).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(
            expect.stringContaining('google=connected&intent=meet_transcription')
        );
    });

    it('não ativa transcrição pra outros intents (ex: conexão normal do Calendar)', async () => {
        googleCalendar.exchangeCodeForTokens.mockResolvedValue({
            tenantId: 'tenant-1', intent: 'calendar', tokens: {}
        });

        const req = { query: { code: 'abc', state: 'xyz' } } as unknown as Request;
        const res = makeRes();

        await controller.callback(req, res);

        expect(repository.activateMeetTranscription).not.toHaveBeenCalled();
    });

    it('redireciona com erro se activateMeetTranscription falhar (não deixa estado parcial)', async () => {
        googleCalendar.exchangeCodeForTokens.mockResolvedValue({
            tenantId: 'tenant-1', intent: 'meet_transcription', tokens: {}
        });
        repository.activateMeetTranscription.mockRejectedValue(new Error('boom'));

        const req = { query: { code: 'abc', state: 'xyz' } } as unknown as Request;
        const res = makeRes();

        await controller.callback(req, res);

        expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('google=error'));
    });
});
