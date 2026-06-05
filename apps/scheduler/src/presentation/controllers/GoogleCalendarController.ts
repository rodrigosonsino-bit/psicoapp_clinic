import { Request, Response } from 'express';
import { GoogleCalendarClient } from '../../infrastructure/google/GoogleCalendarClient';
import { SyncGoogleCalendarUseCase } from '../../application/useCases/SyncGoogleCalendarUseCase';
import { logger } from '../../infrastructure/logger/logger';

export class GoogleCalendarController {
    constructor(
        private readonly googleClient: GoogleCalendarClient,
        private readonly syncUseCase: SyncGoogleCalendarUseCase
    ) {}

    async getAuthUrl(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const authUrl = this.googleClient.getAuthUrl(userId);
            res.json({ url: authUrl });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao gerar URL de autenticação do Google');
            res.status(500).json({ error: error.message });
        }
    }

    async handleCallback(req: Request, res: Response): Promise<void> {
        try {
            const code = req.query.code as string;
            const isMock = req.query.mock === 'true';
            const stateUserId = req.query.state as string;

            await this.googleClient.handleCallback(code, isMock, stateUserId);

            // Redirecionar de volta para o frontend (Expo Web ou app mobile se soubermos, ou uma página simples de sucesso)
            res.send(`
                <html>
                    <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #E8F5E9; color: #2E7D32;">
                        <div style="text-align: center; padding: 30px; border-radius: 12px; background: white; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
                            <h1>📅 Google Calendar Conectado!</h1>
                            <p>Sua agenda foi integrada com sucesso ao WhatsApp Scheduler.</p>
                            <p style="color: #666; font-size: 14px;">Você já pode fechar esta aba e voltar ao aplicativo.</p>
                            <button onclick="window.close()" style="background: #2E7D32; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin-top: 10px;">Fechar Janela</button>
                        </div>
                    </body>
                </html>
            `);
        } catch (error: any) {
            logger.error({ error }, 'Erro no callback do Google Calendar');
            res.status(500).send(`Erro na autenticação: ${error.message}`);
        }
    }

    async getStatus(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const config = await this.googleClient.getConfig(userId);
            if (!config) {
                res.json({ connected: false });
                return;
            }
            res.json({
                connected: true,
                email: config.email,
                isEnabled: config.isEnabled,
                calendarId: config.calendarId || 'primary',
                calendarName: config.calendarName || 'Principal'
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async listCalendars(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const calendars = await this.googleClient.listCalendars(userId);
            res.json({ calendars });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao listar calendários do Google');
            res.status(500).json({ error: error.message });
        }
    }

    async selectCalendar(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const { calendarId, calendarName } = req.body;
            if (!calendarId) {
                res.status(400).json({ error: 'calendarId é obrigatório.' });
                return;
            }
            await this.googleClient.selectCalendar(userId, calendarId, calendarName || calendarId);
            res.json({ success: true, message: `Agenda "${calendarName || calendarId}" selecionada com sucesso!` });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao selecionar calendário');
            res.status(500).json({ error: error.message });
        }
    }

    async disconnect(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            await this.googleClient.deleteConfig(userId);
            res.json({ success: true, message: 'Google Calendar desconectado com sucesso.' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async triggerSync(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            await this.syncUseCase.execute(userId);
            res.json({ success: true, message: 'Sincronização forçada concluída.' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    async getEvents(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const events = await this.googleClient.getEventsWithPreferences(userId);
            res.json({ events });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao buscar eventos');
            res.status(500).json({ error: error.message });
        }
    }

    async toggleEventAutoSend(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).userId;
            const { eventId, autoSend, eventSummary, eventStart } = req.body;
            if (!eventId || autoSend === undefined) {
                res.status(400).json({ error: 'eventId e autoSend são obrigatórios.' });
                return;
            }
            await this.googleClient.setEventPreference(userId, eventId, autoSend, eventSummary, eventStart);
            res.json({ success: true, eventId, autoSend });
        } catch (error: any) {
            logger.error({ error }, 'Erro ao alterar preferência de evento');
            res.status(500).json({ error: error.message });
        }
    }
}
