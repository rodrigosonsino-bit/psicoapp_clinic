import { google } from 'googleapis';
import { Pool } from 'pg';
import { logger } from '../logger/logger';
import { GoogleCalendarClient } from './GoogleCalendarClient';
import { encrypt } from '../utils/cryptoUtils';

export interface ContactsSyncResult {
    totalGoogleContacts: number;
    withPhone: number;
    matchedUpdated: number;
    inserted: number;
}

/**
 * Sincroniza os contatos do Google (People API) com a tabela whatsapp_contacts,
 * preenchendo a coluna google_name. A exibição prioriza google_name sobre o nome
 * sincronizado via WhatsApp (que pode ser o apelido do perfil do contato).
 *
 * Reutiliza os tokens OAuth já salvos em google_calendar_configs — requer que a
 * conta tenha sido (re)conectada com o escopo contacts.readonly.
 */
export class GoogleContactsClient {
    constructor(
        private readonly dbPool: Pool,
        private readonly calendarClient: GoogleCalendarClient
    ) {}

    /**
     * Normaliza um telefone para o formato internacional usado nos JIDs do WhatsApp
     * (apenas dígitos, com DDI). Retorna null para números inválidos/curtos demais.
     */
    private normalizePhone(raw: string): string | null {
        if (!raw) return null;
        let digits = raw.replace(/\D/g, '');
        if (!digits) return null;

        // Remove prefixo de discagem internacional "00" (ex: 0055...)
        if (digits.startsWith('00')) digits = digits.slice(2);
        // Remove zero de discagem nacional (ex: 018 99699-4225)
        if (digits.startsWith('0')) digits = digits.slice(1);

        // Número brasileiro sem DDI: DDD (2) + fixo (8) ou celular (9)
        if (digits.length === 10 || digits.length === 11) {
            digits = `55${digits}`;
        }

        // Curto demais para ser um número internacional válido
        if (digits.length < 11) return null;

        return digits;
    }

    /**
     * Para números brasileiros, gera as variantes com e sem o nono dígito,
     * pois o JID do WhatsApp pode estar em qualquer um dos dois formatos
     * dependendo da idade da conta.
     */
    private brVariants(normalized: string): string[] {
        const variants = [normalized];
        if (normalized.startsWith('55')) {
            const local = normalized.slice(4); // depois de 55 + DDD
            const ddd = normalized.slice(2, 4);
            if (normalized.length === 13 && local.startsWith('9')) {
                variants.push(`55${ddd}${local.slice(1)}`); // sem o 9
            } else if (normalized.length === 12) {
                variants.push(`55${ddd}9${local}`); // com o 9
            }
        }
        return variants;
    }

    public async syncContacts(userId: string): Promise<ContactsSyncResult> {
        const config = await this.calendarClient.getConfig(userId);
        if (!config) {
            throw new Error('Conecte sua conta Google primeiro.');
        }

        const emptyResult: ContactsSyncResult = { totalGoogleContacts: 0, withPhone: 0, matchedUpdated: 0, inserted: 0 };

        if (config.accessToken === 'mock_access_token') {
            logger.info('[GoogleContacts] Modo mock detectado — sincronização de contatos ignorada.');
            return emptyResult;
        }

        const client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        client.setCredentials({
            access_token: config.accessToken,
            refresh_token: config.refreshToken,
            expiry_date: config.expiryDate
        });

        client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                try {
                    await this.dbPool.query(
                        'UPDATE google_calendar_configs SET access_token = $1, expiry_date = $2, updated_at = NOW() WHERE user_id = $3;',
                        [encrypt(tokens.access_token), tokens.expiry_date || config.expiryDate, userId]
                    );
                    logger.info('[GoogleContacts] Token do Google atualizado automaticamente.');
                } catch (err) {
                    logger.error({ err }, '[GoogleContacts] Erro ao persistir token atualizado.');
                }
            }
        });

        const people = google.people({ version: 'v1', auth: client });

        // Buscar todos os contatos paginadamente
        const googleContacts: { name: string; phones: string[] }[] = [];
        let totalGoogleContacts = 0;
        let pageToken: string | undefined = undefined;

        try {
            do {
                const response: any = await people.people.connections.list({
                    resourceName: 'people/me',
                    personFields: 'names,phoneNumbers',
                    pageSize: 1000,
                    pageToken
                });

                const connections = response.data.connections || [];
                totalGoogleContacts += connections.length;

                for (const person of connections) {
                    const name = person.names?.[0]?.displayName;
                    const phones = (person.phoneNumbers || [])
                        .map((p: any) => p.canonicalForm || p.value)
                        .filter((p: any): p is string => !!p);
                    if (name && phones.length > 0) {
                        googleContacts.push({ name, phones });
                    }
                }

                pageToken = response.data.nextPageToken || undefined;
            } while (pageToken);
        } catch (err: any) {
            logger.error({ err, userId }, '[GoogleContacts] Erro ao listar contatos do Google.');
            if (err?.code === 403 || err?.response?.status === 403) {
                throw new Error('Sem permissão para ler contatos. Desconecte e reconecte sua conta Google para autorizar o acesso aos contatos.');
            }
            throw new Error('Falha ao buscar contatos do Google. Tente reconectar sua conta.');
        }

        // Carregar JIDs já conhecidos do tenant para casar variantes (com/sem nono dígito)
        const existingRes = await this.dbPool.query(
            'SELECT id FROM whatsapp_contacts WHERE tenant_id = $1::uuid;',
            [userId]
        );
        const existingIds = new Set<string>(existingRes.rows.map((r: any) => r.id));

        let matchedUpdated = 0;
        let inserted = 0;
        let withPhone = 0;

        for (const contact of googleContacts) {
            withPhone++;
            const processedJids = new Set<string>();

            for (const rawPhone of contact.phones) {
                const normalized = this.normalizePhone(rawPhone);
                if (!normalized) continue;

                const candidateJids = this.brVariants(normalized).map(n => `${n}@s.whatsapp.net`);
                const matchedJid = candidateJids.find(jid => existingIds.has(jid));
                const targetJid = matchedJid || `${normalized}@s.whatsapp.net`;

                if (processedJids.has(targetJid)) continue;
                processedJids.add(targetJid);

                try {
                    await this.dbPool.query(
                        `INSERT INTO whatsapp_contacts (tenant_id, id, name, google_name)
                         VALUES ($1::uuid, $2, $3, $3)
                         ON CONFLICT (tenant_id, id)
                         DO UPDATE SET google_name = EXCLUDED.google_name;`,
                        [userId, targetJid, contact.name]
                    );
                    if (matchedJid) {
                        matchedUpdated++;
                    } else {
                        existingIds.add(targetJid);
                        inserted++;
                    }
                } catch (err) {
                    logger.error({ err, jid: targetJid, name: contact.name }, '[GoogleContacts] Erro ao gravar contato.');
                }
            }
        }

        logger.info(
            `[GoogleContacts] Sincronização concluída para ${userId}: ${totalGoogleContacts} contatos no Google, ` +
            `${withPhone} com telefone, ${matchedUpdated} atualizados, ${inserted} novos.`
        );

        return { totalGoogleContacts, withPhone, matchedUpdated, inserted };
    }
}
