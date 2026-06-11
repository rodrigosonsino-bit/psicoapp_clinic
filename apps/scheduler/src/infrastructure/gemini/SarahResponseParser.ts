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

    // Limpar blocos de código markdown se o Gemini os retornar apesar do responseMimeType
    if (text.startsWith('```')) {
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    }

    try {
        const parsed = JSON.parse(text);
        const action = parsed.action || {};
        return {
            replyText: parsed.replyText || 'Olá! Como posso ajudar você hoje?',
            intent: parsed.intent || '',
            conversationStage: parsed.conversationStage || 'greeting',
            summaryUpdate: parsed.summaryUpdate || '',
            preferences: parsed.preferences || {},
            action: {
                type: action.type || 'none',
                params: action.params || {},
                requiresConfirmation: typeof action.requiresConfirmation === 'boolean' ? action.requiresConfirmation : false
            },
            requiresHuman: typeof parsed.requiresHuman === 'boolean' ? parsed.requiresHuman : false
        };
    } catch (err) {
        logger.error({ err, text }, 'Erro fatal ao parsear JSON retornado pelo Gemini.');
        return {
            replyText: 'Desculpe, tive um problema temporário ao processar sua resposta. Como posso ajudar?',
            intent: 'general_chat',
            conversationStage: 'greeting',
            summaryUpdate: 'Fatal JSON parsing error.',
            preferences: {},
            action: { type: 'none', params: {}, requiresConfirmation: false },
            requiresHuman: true
        };
    }
}
