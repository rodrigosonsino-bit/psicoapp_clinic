import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import * as qrcodeTerminal from 'qrcode-terminal';
import * as QRCode from 'qrcode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';
import pino from 'pino';
import { Pool } from 'pg';
import { usePostgresAuthState } from '../database/PostgresAuthState';

export interface IncomingMessageContext {
    tenantId: string;
    from: string;
    name: string;
    text: string;
    isAudio: boolean;
    isImage: boolean;
    isDocument: boolean;
    mediaData?: { mimeType: string; data: string };
}

// Retorna o texto de resposta a enviar, ou null para não responder
export type IncomingMessageHandler = (ctx: IncomingMessageContext) => Promise<string | null | undefined>;

export interface WhatsappClientOptions {
    onIncomingMessage?: IncomingMessageHandler;
}

export class WhatsappClient {
    private sock: any = null;
    private isReady: boolean = false;
    private reconnectAttempts: number = 0;
    private dbPool: Pool | null = null;
    private contactsCache: Map<string, string> = new Map();
    private aiSentMessagesJid: Set<string> = new Set();
    private processedMessageIds: Set<string> = new Set();
    private lastMessageReceivedAt: number = Date.now();
    private tenantId: string;
    private lastQrDataUrl: string | null = null;
    private readonly onIncomingMessage?: IncomingMessageHandler;

    constructor(tenantId: string, options?: WhatsappClientOptions) {
        this.tenantId = tenantId;
        this.onIncomingMessage = options?.onIncomingMessage;
    }

    public getLastQrDataUrl(): string | null {
        return this.lastQrDataUrl;
    }

    public async getPairingCode(phoneNumber: string): Promise<string> {
        if (!this.sock) {
            throw new Error('Conexão do WhatsApp não inicializada. Tente novamente em alguns segundos.');
        }

        const cleanNumber = phoneNumber.replace(/\D/g, '');
        if (!cleanNumber) {
            throw new Error('Número de telefone inválido. Insira apenas números.');
        }

        logger.info(`[Baileys] Solicitando código de pareamento para o número: ${cleanNumber}`);
        try {
            const code = await this.sock.requestPairingCode(cleanNumber);
            return code;
        } catch (err: any) {
            logger.error({ err, cleanNumber }, 'Erro ao obter código de pareamento do Baileys');
            throw new Error('Falha ao obter código de emparelhamento. Certifique-se de que o número do WhatsApp está correto e inclui o DDI (ex: 55 para Brasil).');
        }
    }

    private connectionTimeoutTimer: NodeJS.Timeout | null = null;

    public isConnected(): boolean {
        return this.isReady;
    }

    public getMyJid(): string | null {
        if (!this.sock || !this.sock.user) return null;
        const rawJid = this.sock.user.id;
        if (rawJid.includes(':')) {
            return `${rawJid.split(':')[0]}@s.whatsapp.net`;
        }
        return rawJid;
    }

    async initialize(dbPool: Pool) {
        this.dbPool = dbPool;
        try {
            logger.debug('Iniciando ciclo de conexão com processo Multidevice (Baileys)...');

            const { version, isLatest } = await fetchLatestBaileysVersion();
            logger.info(`Usando versão do WhatsApp: ${version.join('.')} (Latest: ${isLatest})`);

            const { state, saveCreds } = await usePostgresAuthState(dbPool, this.tenantId);

            this.sock = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: 'silent' }) as any,
                browser: ['Ubuntu', 'Chrome', '121.0.6167.85'],
                connectTimeoutMs: 90000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                printQRInTerminal: true,
                syncFullHistory: true,
                generateHighQualityLinkPreview: false,
                shouldIgnoreJid: (jid: string) => jid.includes('@broadcast'),
                markOnlineOnConnect: true,
            });

            this.resetWatchdog();

            this.sock.ev.on('connection.update', (update: any) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    logger.info(`💡 Novo QR Code disponível para tenant ${this.tenantId} no terminal.`);
                    console.log('\n======================================================');
                    console.log(`📱 ESCANEIE O QR CODE DO TENANT ${this.tenantId} NO WHATSAPP`);
                    console.log('======================================================\n');
                    qrcodeTerminal.generate(qr, { small: true });

                    QRCode.toDataURL(qr, (err, url) => {
                        if (err) {
                            logger.error({ err }, 'Erro ao gerar Data URL do QR Code.');
                        } else {
                            this.lastQrDataUrl = url;
                        }
                    });
                }

                if (connection === 'close') {
                    this.isReady = false;
                    this.clearWatchdog();

                    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        const isRestartRequired = statusCode === DisconnectReason.restartRequired;
                        const delayMs = isRestartRequired ? 500 : Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

                        if (!isRestartRequired) this.reconnectAttempts++;

                        logger.warn({
                            statusCode,
                            reason: lastDisconnect?.error?.message,
                            reattempt: this.reconnectAttempts,
                            delayMs
                        }, `🔄 Queda detectada. Auto-reconectando WhatsApp em ${delayMs / 1000} segundos...`);

                        setTimeout(() => {
                            try { this.sock?.ws?.close(); } catch { }
                            this.initialize(dbPool).catch(err => {
                                logger.error({ err }, 'Erro critico durante tentativa de auto-reconexão.');
                            });
                        }, delayMs);

                    } else {
                        logger.fatal(`🚫 Sessão Deslogada para tenant ${this.tenantId}!`);
                        if (this.dbPool) {
                            this.dbPool.query('UPDATE tenants SET whatsapp_connected = FALSE WHERE id = $1::uuid', [this.tenantId])
                                .catch(err => logger.error({ err }, 'Erro ao atualizar whatsapp_connected no banco no deslogue'));
                        }
                    }
                } else if (connection === 'open') {
                    this.isReady = true;
                    this.reconnectAttempts = 0;
                    this.clearWatchdog();
                    this.lastQrDataUrl = null;
                    logger.info(`✅ Conexão com WhatsApp ESTÁVEL e ATIVA para tenant ${this.tenantId}.`);

                    if (this.dbPool) {
                        this.dbPool.query('UPDATE tenants SET whatsapp_connected = TRUE WHERE id = $1::uuid', [this.tenantId])
                            .catch(err => logger.error({ err }, 'Erro ao atualizar whatsapp_connected no banco'));
                    }

                    this.logGroups().catch((err: any) => {
                        logger.warn({ err }, 'Falha ao listar grupos.');
                    });
                }
            });

            this.sock.ev.on('creds.update', saveCreds);

            this.sock.ev.on('messaging-history.set', async (history: any) => {
                const { contacts } = history;
                if (contacts) {
                    for (const c of contacts) {
                        if (c.id && c.id.endsWith('@s.whatsapp.net')) {
                            const name = c.name || c.notify || c.verifiedName;
                            if (name) {
                                await this.upsertContact(c.id, name);
                            }
                        }
                    }
                }
            });

            this.sock.ev.on('contacts.upsert', async (contacts: any[]) => {
                for (const c of contacts) {
                    if (c.id && c.id.endsWith('@s.whatsapp.net')) {
                        const name = c.name || c.notify || c.verifiedName;
                        if (name) {
                            await this.upsertContact(c.id, name);
                        }
                    }
                }
            });

            this.sock.ev.on('contacts.update', async (updates: any[]) => {
                for (const u of updates) {
                    if (u.id && u.id.endsWith('@s.whatsapp.net')) {
                        const name = u.name || u.notify || u.verifiedName;
                        if (name) {
                            await this.upsertContact(u.id, name);
                        }
                    }
                }
            });

            this.sock.ev.on('messages.upsert', async (m: any) => {
                const msg = m.messages[0];
                if (!msg) return;

                const msgId = msg.key?.id;
                if (msgId) {
                    if (this.processedMessageIds.has(msgId)) {
                        logger.debug(`⏭️ Ignorando evento de mensagem duplicada (id: ${msgId}).`);
                        return;
                    }
                    this.processedMessageIds.add(msgId);
                    setTimeout(() => {
                        this.processedMessageIds.delete(msgId);
                    }, 10 * 60 * 1000);
                }

                const from = msg.key.remoteJid;
                const rawTimestamp = Number(msg.messageTimestamp || 0);
                const messageTimestampMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();
                const messageAgeMs = Math.abs(Date.now() - messageTimestampMs);

                logger.debug({
                    upsertType: m.type,
                    from,
                    fromMe: msg.key.fromMe,
                    messageAgeMs
                }, 'Evento messages.upsert recebido do WhatsApp');

                this.lastMessageReceivedAt = Date.now();

                if (msg.key.fromMe) {
                    const isRealContact = from && !from.endsWith('@g.us') && !from.endsWith('@newsletter') && !from.endsWith('@broadcast');
                    if (isRealContact) {
                        if (this.aiSentMessagesJid.has(from)) {
                            logger.debug(`⏭️ Ignorando evento fromMe para ${from} pois foi um envio automático da IA.`);
                        } else {
                            logger.info(`👤 Enviou mensagem para ${from}. Desativando IA para este contato (cooldown 60 min).`);
                            await this.disableAIForContact(from);
                        }
                    }
                    return;
                }

                const ACCEPT_WINDOW_MS = 10 * 60 * 1000;
                const isAcceptable = !msg.key.fromMe && messageAgeMs <= ACCEPT_WINDOW_MS;

                if (isAcceptable) {
                    let messageContent = msg.message;
                    if (messageContent?.ephemeralMessage) messageContent = messageContent.ephemeralMessage.message;
                    if (messageContent?.viewOnceMessage) messageContent = messageContent.viewOnceMessage.message;
                    if (messageContent?.viewOnceMessageV2) messageContent = messageContent.viewOnceMessageV2.message;
                    if (messageContent?.documentWithCaptionMessage) messageContent = messageContent.documentWithCaptionMessage.message;

                    const isAudio = !!messageContent?.audioMessage;
                    const isImage = !!messageContent?.imageMessage;
                    const isDocument = !!messageContent?.documentMessage;
                    const isMedia = isAudio || isImage || isDocument;
                    const isReaction = !!messageContent?.reactionMessage;

                    const rawText = messageContent?.conversation ||
                        messageContent?.extendedTextMessage?.text ||
                        messageContent?.imageMessage?.caption ||
                        messageContent?.documentMessage?.caption || '';
                    const cleanText = rawText.trim();

                    const textWithoutEmojis = isMedia ? "media" : cleanText
                        .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, '')
                        .replace(/[\s\p{Punctuation}\p{Symbol}]/gu, '')
                        .trim();

                    const isEmojiOnly = !isMedia && cleanText.length > 0 && textWithoutEmojis.length === 0;

                    if (isReaction || isEmojiOnly || (!isMedia && !cleanText)) {
                        logger.debug(`⏭️ Ignorando mensagem de ${msg.pushName || 'Desconhecido'} (${from}) — emoji, reação ou vazia.`);
                        return;
                    }

                    const name = msg.pushName || 'Desconhecido';

                    let text = cleanText;
                    let logType = 'Texto';
                    if (isAudio) {
                        text = "[Mensagem de Áudio]";
                        logType = 'Áudio';
                    } else if (isImage) {
                        text = cleanText ? `[Imagem/Comprovante] - Legenda: ${cleanText}` : "[Imagem/Comprovante]";
                        logType = 'Imagem/Comprovante';
                    } else if (isDocument) {
                        text = cleanText ? `[Documento/Comprovante] - Legenda: ${cleanText}` : "[Documento/Comprovante]";
                        logType = 'Documento/Comprovante';
                    }

                    logger.info(`📩 Mensagem recebida de [${name}] | ID para Agendamento: ${from} | Tipo: ${logType}`);

                    if (this.onIncomingMessage && this.dbPool && text) {
                        if (from && from.endsWith('@g.us')) {
                            logger.debug(`⏭️ Ignorando auto-resposta para o grupo: ${from}`);
                        } else {
                            try {
                                const contactRes = await this.dbPool.query(
                                    'SELECT ai_disabled, ai_disabled_at FROM whatsapp_contacts WHERE tenant_id = $1::uuid AND id = $2;',
                                    [this.tenantId, from]
                                );
                                const row = contactRes.rows[0];
                                let isAiDisabled = row?.ai_disabled === true;
                                const aiDisabledAt = row?.ai_disabled_at;

                                if (isAiDisabled) {
                                    const reenableMinutes = parseInt(process.env.SARAH_AUTO_REENABLE_MINUTES || '60', 10);
                                    const reenableMs = reenableMinutes * 60 * 1000;
                                    const disabledRefTime = aiDisabledAt ? new Date(aiDisabledAt).getTime() : (Date.now() - reenableMs);
                                    const elapsedMs = Date.now() - disabledRefTime;
                                    if (elapsedMs >= reenableMs) {
                                        logger.info(`⏰ Cooldown expirado para ${name} (${from}). Reativando IA automaticamente.`);
                                        await this.dbPool.query(
                                            'UPDATE whatsapp_contacts SET ai_disabled = FALSE, ai_disabled_at = NULL WHERE tenant_id = $1::uuid AND id = $2;',
                                            [this.tenantId, from]
                                        );
                                        isAiDisabled = false;
                                    } else {
                                        const remainingMinutes = Math.round((reenableMs - elapsedMs) / 60000);
                                        logger.info(`⏭️ Ignorando auto-resposta para ${name} (${from}) — cooldown ativo (${remainingMinutes} min restantes).`);
                                        return;
                                    }
                                }

                                let mediaData: { mimeType: string; data: string } | undefined = undefined;
                                if (isMedia) {
                                    try {
                                        logger.info(`🎙️/📷 Fazendo download da mídia de ${name}...`);
                                        const buffer = await downloadMediaMessage(
                                            msg,
                                            'buffer',
                                            {},
                                            { logger: pino({ level: 'silent' }) as any, reuploadRequest: this.sock.updateMediaMessage }
                                        );

                                        let mimeType = 'application/octet-stream';
                                        if (isAudio) mimeType = messageContent.audioMessage.mimetype || 'audio/ogg; codecs=opus';
                                        else if (isImage) mimeType = messageContent.imageMessage.mimetype || 'image/jpeg';
                                        else if (isDocument) mimeType = messageContent.documentMessage.mimetype || 'application/pdf';

                                        mediaData = { mimeType, data: buffer.toString('base64') };
                                    } catch (downloadErr) {
                                        logger.error({ downloadErr }, 'Erro ao baixar mídia do WhatsApp.');
                                    }
                                }

                                try {
                                    await this.sock.sendPresenceUpdate('composing', from);
                                } catch (presErr) {
                                    logger.warn({ presErr }, 'Erro ao enviar presence update composing');
                                }

                                const replyText = await this.onIncomingMessage({
                                    tenantId: this.tenantId,
                                    from,
                                    name,
                                    text,
                                    isAudio,
                                    isImage,
                                    isDocument,
                                    mediaData,
                                });

                                if (replyText) {
                                    let finalReply = replyText;
                                    if (finalReply.includes('[FIM_ATENDIMENTO]')) {
                                        finalReply = finalReply.replace('[FIM_ATENDIMENTO]', '').trim();
                                        logger.info(`🚫 Tag [FIM_ATENDIMENTO] detectada. Desativando IA para ${name} (${from}).`);
                                        await this.disableAIForContact(from);
                                        await this.notifyHumanHandoff(name, from, 'O paciente encerrou o fluxo automatizado ou solicitou ajuda.');
                                    }

                                    logger.info(`🤖 Enviando auto-resposta via WhatsApp para ${name}: "${finalReply}"`);
                                    await this.sendMessage(from, finalReply);
                                }
                            } catch (err) {
                                logger.error({ err }, 'Erro ao processar auto-resposta inteligente');
                            }
                        }
                    }
                }
            });

        } catch (error) {
            logger.error({ err: error }, 'Falha profunda na matriz ao inicializar o Socket do WhatsApp.');
        }
    }

    public async resolveJid(recipientId: string): Promise<string> {
        if (!recipientId) {
            throw new Error('Destinatário inválido.');
        }

        if (recipientId.endsWith('@g.us')) {
            return recipientId;
        }

        let cleanNumber = recipientId;
        if (cleanNumber.includes('@')) {
            cleanNumber = cleanNumber.split('@')[0];
        }
        cleanNumber = cleanNumber.replace(/\D/g, '');

        if (!this.sock || !this.isReady) {
            logger.warn({ cleanNumber }, 'WhatsApp não conectado ou pronto. Retornando JID padrão estrutural.');
            return `${cleanNumber}@s.whatsapp.net`;
        }

        try {
            logger.debug({ cleanNumber }, 'Consultando JID real no WhatsApp via onWhatsApp...');
            const results = await this.sock.onWhatsApp(cleanNumber);
            if (results && results.length > 0 && results[0].exists) {
                logger.info({ original: recipientId, resolved: results[0].jid }, 'JID resolvido com sucesso via onWhatsApp');
                return results[0].jid;
            }
            logger.warn({ cleanNumber }, 'Número não encontrado via onWhatsApp. Usando formato padrão.');
            return `${cleanNumber}@s.whatsapp.net`;
        } catch (err: any) {
            logger.error({ err: err.message, cleanNumber }, 'Erro ao resolver JID via onWhatsApp. Usando formato padrão.');
            return `${cleanNumber}@s.whatsapp.net`;
        }
    }

    async sendMessage(recipientIdOrJid: string, text: string, imageUrl?: string) {
        if (!this.isReady || !this.sock) {
            throw new Error('Canal de transmissão Fechado: Sockets desconectados.');
        }

        const recipientJid = await this.resolveJid(recipientIdOrJid);

        if (recipientJid) {
            this.aiSentMessagesJid.add(recipientJid);
        }

        try {
            if (imageUrl) {
                const fullImagePath = path.join(__dirname, '../../../public', imageUrl);
                if (fs.existsSync(fullImagePath)) {
                    logger.info({ fullImagePath }, '[Baileys] Enviando imagem a partir de buffer...');
                    const imageBuffer = fs.readFileSync(fullImagePath);
                    await this.sock.sendMessage(recipientJid, { image: imageBuffer, caption: text });
                } else {
                    logger.warn({ fullImagePath }, '⚠️ Imagem não encontrada. Enviando apenas o texto como fallback.');
                    await this.sock.sendMessage(recipientJid, { text });
                }
            } else {
                await this.sock.sendMessage(recipientJid, { text });
            }
        } finally {
            if (recipientJid) {
                setTimeout(() => {
                    this.aiSentMessagesJid.delete(recipientJid);
                }, 2000);
            }
        }
    }

    public async getGroups() {
        if (!this.sock) {
            throw new Error('WhatsApp não está conectado.');
        }

        try {
            const groups = await this.sock.groupFetchAllParticipating();
            return Object.values(groups).map((g: any) => ({
                id: g.id,
                name: g.subject
            }));
        } catch (error) {
            logger.error({ err: error }, 'Erro ao buscar grupos do WhatsApp.');
            throw new Error('Não foi possível buscar os grupos.');
        }
    }

    public async getContacts() {
        if (!this.dbPool) {
            throw new Error('Banco de dados não inicializado no WhatsappClient.');
        }

        try {
            const result = await this.dbPool.query('SELECT id, name FROM whatsapp_contacts WHERE tenant_id = $1::uuid ORDER BY name ASC;', [this.tenantId]);
            return result.rows;
        } catch (error) {
            logger.error({ err: error }, 'Erro ao buscar contatos do WhatsApp no banco.');
            throw new Error('Não foi possível buscar os contatos.');
        }
    }

    private async upsertContact(id: string, name: string) {
        if (!this.dbPool) return;
        try {
            await this.dbPool.query(
                `INSERT INTO whatsapp_contacts (tenant_id, id, name)
                 VALUES ($1::uuid, $2, $3)
                 ON CONFLICT (tenant_id, id)
                 DO UPDATE SET name = EXCLUDED.name;`,
                [this.tenantId, id, name]
            );
        } catch (error) {
            logger.error({ err: error, id, name }, 'Erro ao salvar contato no banco.');
        }
    }

    public async disableAIForContact(id: string) {
        if (!this.dbPool) return;
        try {
            await this.dbPool.query(
                `INSERT INTO whatsapp_contacts (tenant_id, id, name, ai_disabled, ai_disabled_at)
                 VALUES ($1::uuid, $2, $3, TRUE, NOW())
                 ON CONFLICT (tenant_id, id)
                 DO UPDATE SET ai_disabled = TRUE, ai_disabled_at = NOW();`,
                [this.tenantId, id, 'Contato do WhatsApp']
            );
        } catch (error) {
            logger.error({ err: error, id }, 'Erro ao desativar IA para o contato no banco.');
        }
    }

    private async logGroups() {
        if (!this.sock) return;

        try {
            const groups = await this.sock.groupFetchAllParticipating();
            const groupList = Object.values(groups);

            logger.info('📱 BUSCA DE GRUPOS CONCLUÍDA:');
            groupList.forEach((g: any) => {
                logger.info(`👥 GRUPO: "${g.subject}" | ID p/ Agendar: ${g.id}`);
            });

            if (groupList.length === 0) {
                logger.info('Este número não participa de nenhum grupo no momento.');
            }
        } catch (error) {
            logger.error({ err: error }, 'Erro ao mapear grupos do WhatsApp.');
        }
    }

    public async notifyHumanHandoff(contactName: string, contactJid: string, reason: string = 'O paciente precisa de atendimento humano.') {
        try {
            const adminNumber = process.env.ADMIN_WHATSAPP_NUMBER;
            const adminJid = adminNumber ? await this.resolveJid(adminNumber) : this.getMyJid();
            if (adminJid) {
                const notifyMsg = `🚨 *Atendimento Humano Solicitado*\n\nO contato *${contactName}* (${contactJid.replace('@s.whatsapp.net', '')}) precisa de sua atenção.\nMotivo: ${reason}\n\n_A IA foi pausada temporariamente para este contato._`;
                await this.sendMessage(adminJid, notifyMsg);
                logger.info(`📢 Notificação de handoff enviada ao admin para o contato ${contactName}.`);
            }
        } catch (err) {
            logger.error({ err, contactJid }, 'Erro ao enviar notificação de handoff para o admin.');
        }
    }

    private resetWatchdog() {
        this.clearWatchdog();
        this.connectionTimeoutTimer = setTimeout(() => {
            if (!this.isReady) {
                logger.error('⏱️ Watchdog Timeout: Evento de conexão do WhatsApp congelou. Forçando reinício...');
                this.sock?.ws?.close();
            }
        }, 120_000);
    }

    private clearWatchdog() {
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
        }
    }

    public checkZombieConnection(): void {
        if (!this.isReady) return;
        const zombieTimeoutMin = parseInt(process.env.SARAH_ZOMBIE_TIMEOUT_MINUTES || '10', 10);
        const silenceMs = Date.now() - this.lastMessageReceivedAt;
        const silenceMin = Math.round(silenceMs / 60000);
        if (silenceMs > zombieTimeoutMin * 60 * 1000) {
            logger.warn(`🧟 [Watchdog] Socket parece ZUMBI: ${silenceMin} min sem mensagens com conexão 'open'. Forçando reconexão...`);
            this.isReady = false;
            try { this.sock?.ws?.close(); } catch { }
        } else {
            logger.debug(`💓 [Watchdog] Socket saudável. Última mensagem há ${silenceMin} min.`);
        }
    }

    public async cleanupExpiredAiBlocks(): Promise<void> {
        if (!this.dbPool) return;
        try {
            const reenableMinutes = parseInt(process.env.SARAH_AUTO_REENABLE_MINUTES || '60', 10);
            const res1 = await this.dbPool.query(`
                UPDATE whatsapp_contacts
                SET ai_disabled = FALSE, ai_disabled_at = NULL
                WHERE tenant_id = $1::uuid
                  AND ai_disabled = TRUE
                  AND ai_disabled_at IS NOT NULL
                  AND ai_disabled_at < NOW() - INTERVAL '${reenableMinutes} minutes'
                RETURNING id;
            `, [this.tenantId]);
            const res2 = await this.dbPool.query(`
                UPDATE whatsapp_contacts
                SET ai_disabled = FALSE, ai_disabled_at = NULL
                WHERE tenant_id = $1::uuid
                  AND ai_disabled = TRUE
                  AND ai_disabled_at IS NULL
                  AND id NOT LIKE '%@newsletter'
                RETURNING id;
            `, [this.tenantId]);
            const total = (res1.rowCount ?? 0) + (res2.rowCount ?? 0);
            if (total > 0) {
                logger.info(`♻️ [Cleanup] ${total} bloqueio(s) de AI expirado(s) reabilitado(s) automaticamente.`);
            }
        } catch (err) {
            logger.error({ err }, '[Cleanup] Erro ao limpar bloqueios expirados da Sarah.');
        }
    }

    public async logout() {
        logger.info(`Encerrando sessão WhatsApp (logout) para tenant ${this.tenantId}...`);
        this.clearWatchdog();
        this.isReady = false;

        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (err) {
                logger.error({ err }, 'Erro ao chamar sock.logout()');
            }
            try {
                await this.sock.ws.close();
            } catch { }
        }

        if (this.dbPool) {
            await this.dbPool.query('UPDATE tenants SET whatsapp_connected = FALSE WHERE id = $1::uuid', [this.tenantId]);
        }
    }

    public async close() {
        logger.info(`Fechando socket WhatsApp (shutdown) para tenant ${this.tenantId}...`);
        this.clearWatchdog();
        this.isReady = false;

        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ev.removeAllListeners('creds.update');
                this.sock.ev.removeAllListeners('messages.upsert');
                await this.sock.ws.close();
            } catch (err) {
                logger.error({ err }, 'Erro ao fechar o socket do WhatsApp de forma limpa');
            }
        }
    }
}
