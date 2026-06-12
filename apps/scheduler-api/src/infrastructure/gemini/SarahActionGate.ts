import { logger } from '../logger/logger';

export function isExplicitConfirmation(message: string): boolean {
    const normalized = message
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[^a-z0-9\s]/g, '') // remove punctuation
        .trim();
    
    const rejectionOrChangePhrases = [
        'nao', 'nao quero', 'melhor outro', 'outro dia', 'outro horario',
        'valor', 'qual valor', 'preco', 'preço', 'quanto custa', 'duvida'
    ];

    if (rejectionOrChangePhrases.some(phrase => normalized.includes(phrase))) {
        return false;
    }

    const confirmationPhrases = [
        'sim', 'confirmo', 'confirmado', 'pode marcar', 'pode agendar',
        'pode confirmar', 'pode ser', 'isso mesmo', 'ok pode marcar',
        'ok confirmado', 'combinado', 'esta correto', 'esta certo',
        'perfeito pode marcar', 'com certeza pode marcar', 'pode sim'
    ];
    
    return confirmationPhrases.some(phrase => {
        // Match either exact word or contains phrase
        if (phrase.includes(' ')) {
            return normalized.includes(phrase);
        }
        const words = normalized.split(/\s+/);
        return words.includes(phrase);
    });
}

export function hasValidParamsForType(type: string, params: any): boolean {
    if (!params) return false;
    if (type === 'create_event') {
        return !!(params.date && params.time);
    }
    if (type === 'cancel_event') {
        return !!(params.cancellationInfo || (params.date && params.time));
    }
    return false;
}

export interface GateResult {
    finalAction: {
        type: string;
        params: any;
        requiresConfirmation: boolean;
    };
    updatedPendingAction: any;
    warning?: string;
}

export function evaluateActionWithGate(
    action: any,
    context: any,
    clientMessage: string
): GateResult {
    if (!action || action.type === 'none') {
        return {
            finalAction: { type: 'none', params: {}, requiresConfirmation: false },
            updatedPendingAction: context?.pending_action || null
        };
    }

    // Only gate create_event and cancel_event
    if (action.type !== 'create_event' && action.type !== 'cancel_event') {
        return {
            finalAction: action,
            updatedPendingAction: null
        };
    }

    const pending = context?.pending_action || null;
    const hasPendingAction = pending && pending.type === action.type;

    // If requiresConfirmation is true, save in pending_action and return none for final action
    if (action.requiresConfirmation === true) {
        // Overwrite pending action ONLY if the new action has complete/valid parameters (requirement 4)
        const hasCompleteParams = hasValidParamsForType(action.type, action.params);
        const updatedPending = hasCompleteParams ? action : (pending || action);
        
        return {
            finalAction: { type: 'none', params: {}, requiresConfirmation: true },
            updatedPendingAction: updatedPending
        };
    }

    // If the model set requiresConfirmation to false (wants direct execution):
    // Validate against the server gate:
    // 1. Pending action must exist
    // 2. Types must match
    // 3. User message must contain explicit confirmation
    // 4. Params must be compatible
    const isConfirmed = isExplicitConfirmation(clientMessage);
    
    let isCompatible = false;
    let finalParams = { ...(action.params || {}) };

    if (hasPendingAction && isConfirmed) {
        if (action.type === 'create_event') {
            const pDate = pending.params?.date || '';
            const pTime = pending.params?.time || '';
            const aDate = action.params?.date || '';
            const aTime = action.params?.time || '';

            // Compatible if parameters match or if action params are empty/omitted (restore from pending)
            if ((!aDate || aDate === pDate) && (!aTime || aTime === pTime)) {
                isCompatible = true;
                finalParams = { ...pending.params, ...action.params };
            } else if (aDate === pDate && aTime === pTime) {
                isCompatible = true;
            }
        } else if (action.type === 'cancel_event') {
            // Requirement 5: cancel_event needs to be more conservative
            const pInfo = pending.params?.cancellationInfo || '';
            const aInfo = action.params?.cancellationInfo || '';
            const pDate = pending.params?.date || '';
            const pTime = pending.params?.time || '';
            const aDate = action.params?.date || '';
            const aTime = action.params?.time || '';
            
            // Normalize for comparison
            const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const normPInfo = norm(pInfo);
            const normAInfo = norm(aInfo);

            if (normAInfo === normPInfo && normPInfo !== '') {
                isCompatible = true;
            } else if (aDate === pDate && aTime === pTime && pDate !== '') {
                isCompatible = true;
            } else if (!aInfo && !aDate && !aTime) {
                // Restore parameters if new ones are empty
                isCompatible = true;
                finalParams = { ...pending.params, ...action.params };
            }
        }
    }

    if (isCompatible) {
        // Execute final action
        return {
            finalAction: { ...action, params: finalParams, requiresConfirmation: false },
            updatedPendingAction: null
        };
    } else {
        // Intercept, block direct execution, force requiresConfirmation = true
        // Only overwrite pending if new action has complete parameters (requirement 4)
        const hasCompleteParams = hasValidParamsForType(action.type, action.params);
        
        let updatedPending = pending;
        if (hasCompleteParams) {
            updatedPending = { ...action, requiresConfirmation: true };
        } else if (!pending) {
            updatedPending = { ...action, requiresConfirmation: true };
        }
        
        return {
            finalAction: { type: 'none', params: {} as any, requiresConfirmation: true },
            updatedPendingAction: updatedPending,
            warning: `Block unconfirmed direct action. pending: ${pending ? pending.type : 'none'}, isConfirmed: ${isConfirmed}, isCompatible: ${isCompatible}`
        };
    }
}
