import 'reflect-metadata';
import { TranscriptionController } from '../TranscriptionController';
import { TranscriptionService } from '../../../infrastructure/services/TranscriptionService';
import { ClinicalAIService } from '../../../infrastructure/services/ClinicalAIService';
import { Pool } from 'pg';
import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authMiddleware';

describe('TranscriptionController Unit Tests', () => {
    let mockPool: jest.Mocked<Pool>;
    let mockTranscriptionService: jest.Mocked<TranscriptionService>;
    let mockClinicalAIService: jest.Mocked<ClinicalAIService>;
    let controller: TranscriptionController;

    beforeEach(() => {
        mockPool = {
            query: jest.fn()
        } as unknown as jest.Mocked<Pool>;

        mockTranscriptionService = {
            transcribe: jest.fn()
        } as unknown as jest.Mocked<TranscriptionService>;

        mockClinicalAIService = {
            generateSummaryDraft: jest.fn()
        } as unknown as jest.Mocked<ClinicalAIService>;

        controller = new TranscriptionController(
            mockTranscriptionService,
            mockClinicalAIService,
            mockPool
        );
    });

    it('deve processar transcrição e resumo com sucesso e salvar no banco', async () => {
        mockTranscriptionService.transcribe.mockResolvedValue('Transcrição simulada');
        mockClinicalAIService.generateSummaryDraft.mockResolvedValue('Resumo simulado');
        (mockPool.query as any).mockResolvedValue({ rowCount: 1, rows: [] } as any);

        const req = {
            tenantId: '123e4567-e89b-12d3-a456-426614174000',
            params: { id: '123e4567-e89b-12d3-a456-426614174001' },
            file: {
                buffer: Buffer.from('audio'),
                mimetype: 'audio/wav'
            }
        } as unknown as AuthenticatedRequest;

        const jsonMock = jest.fn();
        const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
        const res = {
            status: statusMock
        } as unknown as Response;

        await controller.transcribeSession(req, res);

        expect(mockTranscriptionService.transcribe).toHaveBeenCalledWith(req.file?.buffer, req.file?.mimetype);
        expect(mockClinicalAIService.generateSummaryDraft).toHaveBeenCalledWith('Transcrição simulada');
        expect(mockPool.query).toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith({
            transcript: 'Transcrição simulada',
            summary: 'Resumo simulado'
        });
    });

    it('deve retornar a transcrição existente do banco de dados', async () => {
        (mockPool.query as any).mockResolvedValue({
            rows: [{ raw_transcript: 'Histórico', summary_draft: 'Notas' }]
        } as any);

        const req = {
            tenantId: '123e4567-e89b-12d3-a456-426614174000',
            params: { id: '123e4567-e89b-12d3-a456-426614174001' }
        } as unknown as AuthenticatedRequest;

        const jsonMock = jest.fn();
        const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
        const res = {
            status: statusMock
        } as unknown as Response;

        await controller.getTranscription(req, res);

        expect(mockPool.query).toHaveBeenCalled();
        expect(statusMock).toHaveBeenCalledWith(200);
        expect(jsonMock).toHaveBeenCalledWith({
            transcript: 'Histórico',
            summary: 'Notas'
        });
    });
});
