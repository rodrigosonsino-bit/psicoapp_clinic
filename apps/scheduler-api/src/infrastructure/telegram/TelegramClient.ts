import { Telegraf } from 'telegraf';
import { logger } from '../logger/logger';

// Retries rápidos no início; depois de esgotados, cai para um retry longo e
// INDEFINIDO (em vez de desistir pra sempre) — assim, se o erro era transitório
// (rede, instabilidade do Telegram) ou o token foi corrigido e o serviço redeployado,
// a conexão se autorrecupera sem precisar reiniciar o processo manualmente.
const FAST_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
const LONG_RETRY_DELAY_MS = 5 * 60 * 1000;

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

            // Handle polling-loop errors. bot.catch() is the right place — bot.launch().catch()
            // only fires when launch() rejects, but individual getUpdates errors (409 Conflict,
            // 401 Unauthorized, timeouts de rede, etc.) são roteados aqui pelo Telegraf.
            // Qualquer erro aqui derruba o polling, então TODO erro precisa de retry — não só o 409.
            // Sem isso, um 401 (token revogado/rotacionado) deixa o bot morto pra sempre até
            // o processo reiniciar (incidente de 2026-06-23).
            this.bot.catch((err: any) => {
                const code = err?.response?.error_code ?? err?.code;
                this.isReady = false;
                this.bot?.stop('ERROR');
                if (code === 401) {
                    logger.error({ err }, '🔑 Telegram 401 Unauthorized: o TELEGRAM_BOT_TOKEN está inválido ou foi revogado/rotacionado no @BotFather. Atualize a variável de ambiente. Tentando novamente com backoff por precaução.');
                } else if (code === 409) {
                    logger.error('Telegram 409 Conflict: instância concorrente detectada.');
                } else {
                    logger.error({ err }, 'Erro no loop de polling do Telegram.');
                }
                this.scheduleRelaunch();
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
            this.scheduleRelaunch();
        });
        this.isReady = true;
        logger.info('✅ Conexão com Telegram (Telegraf) ATIVA.');
    }

    private scheduleRelaunch() {
        const delay = FAST_RETRY_DELAYS_MS[this.launchAttempts] ?? LONG_RETRY_DELAY_MS;
        this.launchAttempts += 1;
        logger.warn(`Telegram: tentando reconectar em ${delay}ms (tentativa ${this.launchAttempts}).`);
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
