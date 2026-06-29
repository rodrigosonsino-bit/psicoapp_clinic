import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, Browsers } from '@whiskeysockets/baileys';
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

// Receipt real de entrega/leitura do WhatsApp para uma mensagem que nós enviamos.
export interface MessageStatusUpdate {
    tenantId: string;
    waMessageId: string;
    status: 'delivered' | 'read';
}
export type MessageStatusHandler = (update: MessageStatusUpdate) => Promise<void> | void;

export interface WhatsappClientOptions {
    onIncomingMessage?: IncomingMessageHandler;
    onMessageStatusUpdate?: MessageStatusHandler;
}

export class WhatsappClient {
    private sock: any = null;
    private isReady: boolean = false;
    private reconnectAttempts: number = 0;
    private isReconnecting: boolean = false; // guarda contra initialize() simultâneos
    private loggedOutReinits: number = 0; // cap de reinicializações automáticas pós-deslogue remoto
    private dbPool: Pool | null = null;
    private contactsCache: Map<string, string> = new Map();
    private aiSentMessagesJid: Set<string> = new Set();
    // Cache de mensagens próprias enviadas recentemente, indexado por message id.
    // Necessário para o getMessage do Baileys conseguir reenviar o conteúdo real
    // quando o destinatário pede retry por falha de descriptografia (ver getMessage abaixo).
    private sentMessageStore: Map<string, any> = new Map();
    private processedMessageIds: Set<string> = new Set();
    private messageBuffers: Map<string, {
        timer: NodeJS.Timeout;
        messages: string[];
        name: string;
        isAudio: boolean;
        isImage: boolean;
        isDocument: boolean;
        mediaData?: { mimeType: string; data: string };
    }> = new Map();
    private lastMessageReceivedAt: number = Date.now();
    private tenantId: string;
    private lastQrDataUrl: string | null = null;
    private readonly onIncomingMessage?: IncomingMessageHandler;
    private readonly onMessageStatusUpdate?: MessageStatusHandler;

    constructor(tenantId: string, options?: WhatsappClientOptions) {
        this.tenantId = tenantId;
        this.onIncomingMessage = options?.onIncomingMessage;
        this.onMessageStatusUpdate = options?.onMessageStatusUpdate;
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

            const logLevel = (process.env.WHATSAPP_LOG_LEVEL || 'silent') as pino.Level;
            
            this.sock = makeWASocket({
                version,
                auth: state,
                logger: pino({ level: logLevel }) as any,
                browser: Browsers.ubuntu('Chrome'),
                connectTimeoutMs: 90000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 10000,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,
                shouldIgnoreJid: (jid: string) => jid.includes('@broadcast'),
                markOnlineOnConnect: true,
                // getMessage é obrigatório para que o WhatsApp faça retry correto de
                // mensagens que falharam na descriptografia ("Aguardando mensagem").
                // Sem ele, o receptor envia um retry receipt e o remetente não consegue
                // reenviar a mensagem com as chaves corretas — a mensagem fica marcada
                // como "sent" no nosso banco, mas nunca chega de fato ao destinatário.
                getMessage: async (key) => {
                    if (!key.id) return undefined;
                    return this.sentMessageStore.get(key.id);
                },
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
                        // Guarda contra reconexões simultâneas (watchdog + zombie + close handler)
                        if (this.isReconnecting) {
                            logger.warn({ statusCode, tenantId: this.tenantId }, '⏸️ Reconexão já em andamento — ignorando disparo duplicado.');
                            return;
                        }

                        const isRestartRequired = statusCode === DisconnectReason.restartRequired;
                        const delayMs = isRestartRequired ? 500 : Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);

                        if (!isRestartRequired) this.reconnectAttempts++;

                        logger.warn({
                            statusCode,
                            reason: lastDisconnect?.error?.message,
                            reattempt: this.reconnectAttempts,
                            delayMs
                        }, `🔄 Queda detectada. Auto-reconectando WhatsApp em ${delayMs / 1000} segundos...`);

                        this.isReconnecting = true;
                        setTimeout(() => {
                            // Destruir o socket antigo por completo antes de criar um novo.
                            // Sem isso, os listeners do socket velho continuam emitindo
                            // creds.update e sobrescrevem as chaves novas no banco.
                            this.destroySocket();
                            this.isReconnecting = false;
                            this.initialize(dbPool).catch(err => {
                                logger.error({ err }, 'Erro critico durante tentativa de auto-reconexão.');
                                this.isReconnecting = false;
                            });
                        }, delayMs);

                    } else {
                        logger.fatal(`🚫 Sessão Deslogada para tenant ${this.tenantId}!`);

                        // Apagar as chaves Signal do banco para forçar sessão limpa na próxima conexão.
                        // Sem isso, o próximo initialize() carrega chaves inválidas e gera
                        // mensagens "Aguardando mensagem" nos destinatários.
                        const cleanupTasks: Promise<unknown>[] = [];
                        if (this.dbPool) {
                            cleanupTasks.push(
                                this.dbPool.query('DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid', [this.tenantId])
                                    .then(() => logger.info({ tenantId: this.tenantId }, '🗑️ Chaves Signal removidas do banco após deslogue remoto.'))
                                    .catch(err => logger.error({ err }, 'Erro ao limpar whatsapp_auth após deslogue')),
                                this.dbPool.query('UPDATE tenants SET whatsapp_connected = FALSE WHERE id = $1::uuid', [this.tenantId])
                                    .catch(err => logger.error({ err }, 'Erro ao atualizar whatsapp_connected no banco no deslogue'))
                            );
                        }

                        // Deslogue REMOTO (não iniciado por logout(), que seta isReconnecting=true):
                        // reinicializar com sessão limpa para emitir um novo QR. Sem isso o cliente
                        // fica zumbi na memória — sem QR e sem reconexão — e o frontend gira em
                        // "Gerando QR Code..." para sempre. Cap de tentativas evita loop contra
                        // o WhatsApp caso o deslogue se repita imediatamente.
                        if (!this.isReconnecting && this.loggedOutReinits < 3) {
                            this.loggedOutReinits++;
                            this.isReconnecting = true;
                            logger.warn({ tenantId: this.tenantId, attempt: this.loggedOutReinits }, '♻️ Reinicializando sessão limpa após deslogue remoto para gerar novo QR...');
                            setTimeout(async () => {
                                try { await Promise.all(cleanupTasks); } catch { }
                                this.destroySocket();
                                this.isReconnecting = false;
                                this.initialize(dbPool).catch(err => {
                                    logger.error({ err }, 'Erro ao reinicializar sessão após deslogue remoto.');
                                    this.isReconnecting = false;
                                });
                            }, 1000);
                        }
                    }
                } else if (connection === 'open') {
                    this.isReady = true;
                    this.reconnectAttempts = 0;
                    this.loggedOutReinits = 0;
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

            // Receipts de entrega/leitura das mensagens que NÓS enviamos. Sem isso, o status
            // "sent" no banco só reflete que o WhatsApp aceitou a mensagem no servidor — não
            // que ela chegou ao aparelho do destinatário.
            this.sock.ev.on('messages.update', async (updates: any[]) => {
                if (!this.onMessageStatusUpdate) return;
                for (const { key, update } of updates) {
                    if (!key?.fromMe || !key?.id || update?.status === undefined) continue;
                    // Baileys/WAProto status: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
                    let status: 'delivered' | 'read' | null = null;
                    if (update.status === 3) status = 'delivered';
                    else if (update.status >= 4) status = 'read';
                    if (!status) continue;
                    try {
                        await this.onMessageStatusUpdate({ tenantId: this.tenantId, waMessageId: key.id, status });
                    } catch (err) {
                        logger.error({ err, waMessageId: key.id, status }, 'Erro ao processar receipt de status de mensagem.');
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
                            const reenableMinutes = parseInt(process.env.SARAH_AUTO_REENABLE_MINUTES || '15', 10);
                            logger.info(`👤 Enviou mensagem para ${from}. Desativando IA para este contato (cooldown ${reenableMinutes} min).`);
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
                                    const reenableMinutes = parseInt(process.env.SARAH_AUTO_REENABLE_MINUTES || '15', 10);
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

                                // Download media immediately if present
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

                                // Debounce logic: accumulate text messages and flags by JID (from)
                                let buffer = this.messageBuffers.get(from);
                                if (buffer) {
                                    clearTimeout(buffer.timer);
                                    logger.info(`⏳ Mensagem de ${name} (${from}) adicionada ao buffer de debounce. Reiniciando timer.`);
                                } else {
                                    logger.info(`⏳ Iniciando buffer de debounce para ${name} (${from}) com timer de 2.5s.`);
                                    buffer = {
                                        timer: null as any,
                                        messages: [],
                                        name: name,
                                        isAudio: false,
                                        isImage: false,
                                        isDocument: false,
                                        mediaData: undefined
                                    };
                                    this.messageBuffers.set(from, buffer);
                                }

                                buffer.messages.push(text);
                                if (isAudio) buffer.isAudio = true;
                                if (isImage) buffer.isImage = true;
                                if (isDocument) buffer.isDocument = true;
                                if (mediaData) buffer.mediaData = mediaData;

                                buffer.timer = setTimeout(async () => {
                                    try {
                                        const finalBuffer = this.messageBuffers.get(from);
                                        this.messageBuffers.delete(from);
                                        if (!finalBuffer) return;

                                        const concatenatedText = finalBuffer.messages.join(' ');
                                        logger.info(`⏳ Debounce expirado para ${finalBuffer.name} (${from}). Processando mensagens acumuladas:\n${concatenatedText}`);

                                        try {
                                            await this.sock.sendPresenceUpdate('composing', from);
                                        } catch (presErr) {
                                            logger.warn({ presErr }, 'Erro ao enviar presence update composing');
                                        }

                                        try {
                                            const replyText = await this.onIncomingMessage!({
                                                tenantId: this.tenantId,
                                                from,
                                                name: finalBuffer.name,
                                                text: concatenatedText,
                                                isAudio: finalBuffer.isAudio,
                                                isImage: finalBuffer.isImage,
                                                isDocument: finalBuffer.isDocument,
                                                mediaData: finalBuffer.mediaData,
                                            });

                                            if (replyText) {
                                                let finalReply = replyText;
                                                if (finalReply.includes('[FIM_ATENDIMENTO]')) {
                                                    finalReply = finalReply.replace('[FIM_ATENDIMENTO]', '').trim();
                                                    logger.info(`🚫 Tag [FIM_ATENDIMENTO] detectada. Desativando IA para ${finalBuffer.name} (${from}).`);
                                                    await this.disableAIForContact(from);
                                                    await this.notifyHumanHandoff(finalBuffer.name, from, 'O paciente encerrou o fluxo automatizado ou solicitou ajuda.');
                                                }

                                                logger.info(`🤖 Enviando auto-resposta via WhatsApp para ${finalBuffer.name}: "${finalReply}"`);
                                                await this.sendMessage(from, finalReply);
                                            }
                                        } finally {
                                            try {
                                                await this.sock.sendPresenceUpdate('paused', from);
                                            } catch (presErr) {
                                                logger.warn({ presErr }, 'Erro ao limpar presence update (paused)');
                                            }
                                        }
                                    } catch (processErr) {
                                        logger.error({ processErr }, 'Erro ao processar mensagens acumuladas no timer de debounce.');
                                    }
                                }, 2500);

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

    async sendMessage(recipientIdOrJid: string, text: string, imageUrl?: string): Promise<string | undefined> {
        if (!this.isReady || !this.sock) {
            throw new Error('Canal de transmissão Fechado: Sockets desconectados.');
        }

        const recipientJid = await this.resolveJid(recipientIdOrJid);

        if (recipientJid) {
            this.aiSentMessagesJid.add(recipientJid);
        }

        try {
            let sentMsg: any;
            if (imageUrl) {
                const fullImagePath = path.join(__dirname, '../../../public', imageUrl);
                if (fs.existsSync(fullImagePath)) {
                    logger.info({ fullImagePath }, '[Baileys] Enviando imagem a partir de buffer...');
                    const imageBuffer = fs.readFileSync(fullImagePath);
                    sentMsg = await this.sock.sendMessage(recipientJid, { image: imageBuffer, caption: text });
                } else {
                    logger.warn({ fullImagePath }, '⚠️ Imagem não encontrada. Enviando apenas o texto como fallback.');
                    sentMsg = await this.sock.sendMessage(recipientJid, { text });
                }
            } else {
                sentMsg = await this.sock.sendMessage(recipientJid, { text });
            }

            if (sentMsg?.key?.id && sentMsg.message) {
                this.cacheSentMessage(sentMsg.key.id, sentMsg.message);
            }

            return sentMsg?.key?.id as string | undefined;
        } finally {
            if (recipientJid) {
                setTimeout(() => {
                    this.aiSentMessagesJid.delete(recipientJid);
                }, 2000);
            }
        }
    }

    private cacheSentMessage(id: string, content: any): void {
        this.sentMessageStore.set(id, content);
        // Retries de descriptografia chegam em poucos segundos/minutos; não há
        // necessidade de guardar indefinidamente.
        setTimeout(() => {
            this.sentMessageStore.delete(id);
        }, 10 * 60 * 1000);
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
            logger.info('📱 Iniciando busca de grupos do WhatsApp...');
            // Add an explicit timeout since groupFetchAllParticipating can hang
            const timeoutMs = 15000;
            const fetchPromise = this.sock.groupFetchAllParticipating();
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Timeout de ${timeoutMs}ms ao buscar grupos`)), timeoutMs);
            });

            const groups = await Promise.race([fetchPromise, timeoutPromise]);
            const groupList = Object.values(groups as any);

            logger.info('📱 BUSCA DE GRUPOS CONCLUÍDA:');
            groupList.forEach((g: any) => {
                logger.info(`👥 GRUPO: "${g.subject}" | ID p/ Agendar: ${g.id}`);
            });

            if (groupList.length === 0) {
                logger.info('Este número não participa de nenhum grupo no momento.');
            }
        } catch (error) {
            logger.error({ err: error }, 'Erro ou Timeout ao mapear grupos do WhatsApp.');
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

    /**
     * Destrói o socket atual por completo: remove todos os listeners e fecha o WebSocket.
     * Deve ser chamado ANTES de criar um novo socket (reconexão ou logout) para evitar
     * que handlers do socket antigo continuem emitindo creds.update e sobrescrevam
     * as chaves Signal novas no banco — causa direta das mensagens "Aguardando mensagem".
     */
    private destroySocket(): void {
        if (!this.sock) return;
        try {
            this.sock.ev.removeAllListeners('connection.update');
            this.sock.ev.removeAllListeners('creds.update');
            this.sock.ev.removeAllListeners('messages.upsert');
            this.sock.ev.removeAllListeners('messages.update');
            this.sock.ev.removeAllListeners('messaging-history.set');
            this.sock.ev.removeAllListeners('contacts.upsert');
            this.sock.ev.removeAllListeners('contacts.update');
        } catch (err) {
            logger.warn({ err }, '[destroySocket] Erro ao remover listeners do socket antigo.');
        }
        try {
            this.sock.ws?.close();
        } catch { }
        this.sock = null;
    }

    public async checkZombieConnection(): Promise<void> {
        if (!this.isReady) return;

        // Probe ativo: testa a conexão de verdade em vez de confiar apenas no silêncio de
        // mensagens RECEBIDAS. Uma sessão majoritariamente de envio (ex: lembretes agendados)
        // pode passar dias sem receber nada e ainda assim estar morta por dentro — o socket
        // fica "open" mas trava na hora de transmitir. Isso causou falha real de envio sem
        // detecção por quase 48h (ver incidente de 2026-06-23).
        const probeTimeoutMs = parseInt(process.env.SARAH_WATCHDOG_PROBE_TIMEOUT_MS || '8000', 10);
        try {
            await Promise.race([
                this.sock.sendPresenceUpdate('available'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Watchdog probe timeout')), probeTimeoutMs))
            ]);
            this.lastMessageReceivedAt = Date.now();
            logger.debug('💓 [Watchdog] Probe ativo respondeu OK. Conexão saudável.');
        } catch (err) {
            logger.warn({ err }, `🧟 [Watchdog] Probe ativo falhou ou expirou (${probeTimeoutMs}ms). Conexão parece zumbi. Forçando reconexão...`);
            this.isReady = false;
            try { this.sock?.ws?.close(); } catch { }
        }
    }

    public async cleanupExpiredAiBlocks(): Promise<void> {
        if (!this.dbPool) return;
        try {
            const reenableMinutes = parseInt(process.env.SARAH_AUTO_REENABLE_MINUTES || '15', 10);
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
        this.isReconnecting = true; // impede reconexão automática durante logout

        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (err) {
                logger.error({ err }, 'Erro ao chamar sock.logout()');
            }
            this.destroySocket();
        }

        if (this.dbPool) {
            // Apagar as chaves Signal do banco para forçar sessão completamente
            // limpa na próxima conexão — evita que chaves velhas causem
            // mensagens "Aguardando mensagem" nos destinatários.
            try {
                await this.dbPool.query('DELETE FROM whatsapp_auth WHERE tenant_id = $1::uuid', [this.tenantId]);
                logger.info({ tenantId: this.tenantId }, '🗑️ Chaves Signal (whatsapp_auth) apagadas do banco após logout.');
            } catch (err) {
                logger.error({ err }, 'Erro ao limpar whatsapp_auth no logout');
            }
            await this.dbPool.query('UPDATE tenants SET whatsapp_connected = FALSE WHERE id = $1::uuid', [this.tenantId]);
        }

        this.isReconnecting = false;
    }

    public async close() {
        logger.info(`Fechando socket WhatsApp (shutdown) para tenant ${this.tenantId}...`);
        this.clearWatchdog();
        this.isReady = false;
        this.isReconnecting = true; // impede reconexão automática durante shutdown
        this.destroySocket();
    }
}
