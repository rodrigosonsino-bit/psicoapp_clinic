import { logger } from '../logger/logger';

export interface SarahParsedResponse {
    replyText: string;
    intent: string;
    conversationStage: string;
    summaryUpdate: string;
    preferences: {
        location?: 'online' | 'presencial' | null;
        patientName?: string;
        city?: string;
        [key: string]: any;
    };
    action: {
        type: 'none' | 'propose_slots' | 'create_event' | 'cancel_event' | 'notify_owner' | 'disable_ai';
        params: {
            patientName?: string;
            date?: string;
            time?: string;
            cancellationInfo?: string;
            reason?: string;
            [key: string]: any;
        };
        requiresConfirmation: boolean;
    };
    requiresHuman: boolean;
}

export function parseStructuredResponse(rawReply: string): SarahParsedResponse {
    let text = rawReply.trim();
    logger.info({ responseText: text }, 'Resposta bruta da Sarah (Gemini)');

    // Limpar blocos de código markdown
    if (text.startsWith('```')) {
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }

    try {
        const parsed = JSON.parse(text);
        return {
            replyText: parsed.replyText || 'Olá! Como posso ajudar você hoje?',
            intent: parsed.intent || '',
            conversationStage: parsed.conversationStage || 'greeting',
            summaryUpdate: parsed.summaryUpdate || '',
            preferences: parsed.preferences || {},
            action: parsed.action || { type: 'none', params: {}, requiresConfirmation: false },
            requiresHuman: parsed.requiresHuman || false
        };
    } catch (err) {
        logger.warn({ err, text }, 'Erro ao parsear JSON retornado pelo Gemini. Usando fallback.');
        
        let requiresHuman = false;
        let cleanedText = text;
        if (cleanedText.includes('[FIM_ATENDIMENTO]')) {
            requiresHuman = true;
            cleanedText = cleanedText.replace('[FIM_ATENDIMENTO]', '').trim();
        }

        let action: any = { type: 'none', params: {}, requiresConfirmation: false };
        const bookRegex = /\[ACTION\s*:\s*BOOK\s*\|([^\]]+)\]/i;
        const bookMatch = cleanedText.match(bookRegex);
        if (bookMatch) {
            const paramsStr = bookMatch[1];
            const patientMatch = paramsStr.match(/paciente\s*:\s*([^|]+)/i);
            const dateMatch = paramsStr.match(/data\s*:\s*([^|]+)/i);
            const timeMatch = paramsStr.match(/hora\s*:\s*([^|]+)/i);

            action = {
                type: 'create_event',
                params: {
                    patientName: patientMatch ? patientMatch[1].trim() : '',
                    date: dateMatch ? dateMatch[1].trim() : '',
                    time: timeMatch ? timeMatch[1].trim() : ''
                },
                requiresConfirmation: false
            };
            cleanedText = cleanedText.replace(bookRegex, '').trim();
        }

        const cancelRegex = /\[ACTION\s*:\s*CANCEL\s*(?:\|([^\]]+))?\]/i;
        const cancelMatch = cleanedText.match(cancelRegex);
        if (cancelMatch) {
            action = {
                type: 'cancel_event',
                params: {
                    cancellationInfo: cancelMatch[1] ? cancelMatch[1].trim() : 'Cancelamento confirmado'
                },
                requiresConfirmation: false
            };
            cleanedText = cleanedText.replace(cancelRegex, '').trim();
        }

        return {
            replyText: cleanedText || 'Olá! Como posso ajudar?',
            intent: 'general_chat',
            conversationStage: 'greeting',
            summaryUpdate: 'Fallback parsing activated.',
            preferences: {},
            action: action,
            requiresHuman: requiresHuman
        };
    }
}
