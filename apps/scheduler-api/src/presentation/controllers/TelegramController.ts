import { Request, Response } from 'express';
import { TelegramClient } from '../../infrastructure/telegram/TelegramClient';

export class TelegramController {
    constructor(private readonly telegramClient: TelegramClient) {}

    getStatus = (_req: Request, res: Response) => {
        res.json({
            connected: this.telegramClient.isConnected(),
            botUsername: this.telegramClient.getBotUsername(),
        });
    };
}
