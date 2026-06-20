import { Telegraf } from 'telegraf';
import { logger } from '../logger/logger';

const MAX_LAUNCH_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [5000, 15000, 30000];

export class TelegramClient {
    private bot: Telegraf | null = null;
    private isReady: boolean = false;
    private botUsername: string | null = null;
    private launchAttempts = 0;

    constructor(private readonly token: string) {
        if (token) {
            this.bot = new Telegraf(token);
        }
    }

    public isConnected(): boolean {
        return this.isReady;
    }

    public getBotUsername(): string | null {
        return this.botUsername;
    }

    async initialize() {
        if (!this.bot) {
            logger.warn('Token do Telegram não fornecido. O Bot do Telegram não será inicializado.');
            return;
        }

        try {
            const botInfo = await this.bot.telegram.getMe();
            this.botUsername = botInfo.username ?? null;
            logger.info(`🤖 Bot do Telegram iniciado como @${botInfo.username}`);

            this.bot.on('message', (ctx) => {
                const chat = ctx.chat;
                const from = ctx.from;
                const text = (ctx.message as any).text;

                if (chat.type === 'group' || chat.type === 'supergroup') {
                    logger.info(`📩 Telegram: Mensagem no grupo "${chat.title}" (ID: ${chat.id}) de ${from.first_name}: ${text}`);
                } else if (chat.type === 'private') {
                    logger.info(`📩 Telegram: Mensagem privada de ${from.first_name} (ID: ${chat.id}): ${text}`);
                }
            });

            // Handle polling-loop errors (e.g. 409 Conflict when another instance is still running).
            // bot.catch() is the right place — bot.launch().catch() only fires when launch() rejects,
            // but individual getUpdates errors are routed here by Telegraf internally.
            this.bot.catch((err: any) => {
                const code = err?.response?.error_code ?? err?.code;
                if (code === 409) {
                    this.isReady = false;
                    this.bot?.stop('CONFLICT');
                    this.scheduleRelaunch();
                } else {
                    logger.error({ err }, 'Erro no loop de polling do Telegram.');
                }
            });

            this.launchPolling();

        } catch (error) {
            logger.error({ err: error }, 'Falha ao inicializar o Bot do Telegram.');
            this.isReady = false;
        }
    }

    private launchPolling() {
        if (!this.bot) return;
        this.bot.launch().catch((err: any) => {
            logger.error({ err }, 'Polling do Telegram encerrado com erro.');
            this.isReady = false;
        });
        this.isReady = true;
        logger.info('✅ Conexão com Telegram (Telegraf) ATIVA.');
    }

    private scheduleRelaunch() {
        if (this.launchAttempts >= MAX_LAUNCH_ATTEMPTS) {
            logger.error('Telegram 409 Conflict persistente: desistindo após múltiplas tentativas.');
            return;
        }
        const delay = RETRY_DELAYS_MS[this.launchAttempts] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        this.launchAttempts += 1;
        logger.error(`Telegram 409 Conflict: instância concorrente detectada. Tentando de novo em ${delay}ms (tentativa ${this.launchAttempts}/${MAX_LAUNCH_ATTEMPTS}).`);
        setTimeout(() => this.launchPolling(), delay);
    }

    async sendMessage(chatId: string | number, text: string) {
        if (!this.isReady || !this.bot) {
            throw new Error('Telegram Bot não está pronto ou token não configurado.');
        }
        await this.bot.telegram.sendMessage(chatId, text);
    }

    async stop() {
        if (this.bot) {
            await this.bot.stop();
            this.isReady = false;
        }
    }
}
