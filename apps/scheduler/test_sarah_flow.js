/**
 * Comprehensive Integration & Unit Test Suite for Sarah Virtual Secretary.
 * Targets the transpiled pure helper modules:
 * 1. SarahTimezoneHelper.ts -> America/Sao_Paulo timezone offsets and helpers
 * 2. SarahResponseParser.ts -> Robust JSON & Legacy Tag fallbacks
 * 3. SarahActionGate.ts     -> Strict server-side validation & double-confirmation gates
 */

const assert = require('assert');

// We import the transpiled JS files from the dist/ output folder
const { 
    buildSaoPauloDateTimeIso, 
    addMinutesToSaoPauloIso, 
    getSaoPauloTodayParts 
} = require('./dist/infrastructure/gemini/SarahTimezoneHelper');

const { 
    parseStructuredResponse 
} = require('./dist/infrastructure/gemini/SarahResponseParser');

const { 
    isExplicitConfirmation, 
    hasValidParamsForType, 
    evaluateActionWithGate 
} = require('./dist/infrastructure/gemini/SarahActionGate');

console.log('🧪 Starting Sarah AI Helper & Gate Validation Tests...\n');

// ==========================================
// 1. TIMEZONE HELPER TESTS
// ==========================================
console.log('--------------------------------------------');
console.log('Testing SarahTimezoneHelper...');
console.log('--------------------------------------------');

// Test buildSaoPauloDateTimeIso
const iso1 = buildSaoPauloDateTimeIso('2026-05-21', '14:30');
assert.strictEqual(iso1, '2026-05-21T14:30:00-03:00', 'buildSaoPauloDateTimeIso should construct correct ISO string');
console.log('✅ buildSaoPauloDateTimeIso: Passed!');

// Test addMinutesToSaoPauloIso
const isoFuture = addMinutesToSaoPauloIso(iso1, 50);
assert.strictEqual(isoFuture, '2026-05-21T15:20:00-03:00', 'addMinutesToSaoPauloIso should correctly add minutes with offset');
console.log('✅ addMinutesToSaoPauloIso: Passed!');

// Test getSaoPauloTodayParts
const todayParts = getSaoPauloTodayParts();
assert.ok(todayParts.year >= 2026, 'Year should be current or future');
assert.ok(todayParts.month >= 0 && todayParts.month <= 11, 'Month should be 0-indexed');
assert.ok(todayParts.day >= 1 && todayParts.day <= 31, 'Day should be valid');
console.log(`✅ getSaoPauloTodayParts: Passed! (Today: ${todayParts.year}-${todayParts.month + 1}-${todayParts.day})`);
console.log('');


// ==========================================
// 2. RESPONSE PARSER TESTS
// ==========================================
console.log('--------------------------------------------');
console.log('Testing SarahResponseParser...');
console.log('--------------------------------------------');

// Test Valid JSON Parsing
const validJson = `{
  "replyText": "Olá! Agendamento pré-confirmado.",
  "intent": "schedule_session",
  "conversationStage": "collecting_info",
  "summaryUpdate": "Paciente quer atendimento online",
  "preferences": {
    "location": "online"
  },
  "action": {
    "type": "create_event",
    "params": {
      "patientName": "Sarah Connor",
      "date": "2026-05-22",
      "time": "10:00"
    },
    "requiresConfirmation": true
  },
  "requiresHuman": false
}`;
const parsedJson = parseStructuredResponse(validJson);
assert.strictEqual(parsedJson.replyText, 'Olá! Agendamento pré-confirmado.');
assert.strictEqual(parsedJson.action.type, 'create_event');
assert.strictEqual(parsedJson.action.params.patientName, 'Sarah Connor');
assert.strictEqual(parsedJson.action.params.date, '2026-05-22');
assert.strictEqual(parsedJson.action.params.time, '10:00');
assert.strictEqual(parsedJson.action.requiresConfirmation, true);
console.log('✅ parseStructuredResponse (JSON): Passed!');

// Test Fallback Legacy Parsing - BOOK action
const legacyBookText = 'Com certeza! Seu agendamento foi iniciado. [ACTION: BOOK | paciente: João Silva | data: 2026-05-18 | hora: 10:00]';
const parsedLegacyBook = parseStructuredResponse(legacyBookText);
assert.strictEqual(parsedLegacyBook.replyText, 'Com certeza! Seu agendamento foi iniciado.');
assert.strictEqual(parsedLegacyBook.action.type, 'create_event');
assert.strictEqual(parsedLegacyBook.action.params.patientName, 'João Silva');
assert.strictEqual(parsedLegacyBook.action.params.date, '2026-05-18');
assert.strictEqual(parsedLegacyBook.action.params.time, '10:00');
assert.strictEqual(parsedLegacyBook.action.requiresConfirmation, false);
console.log('✅ parseStructuredResponse (Legacy BOOK): Passed!');

// Test Fallback Legacy Parsing - CANCEL action
const legacyCancelText = 'Sua sessão foi cancelada. [ACTION: CANCEL | cancelamento confirmado]';
const parsedLegacyCancel = parseStructuredResponse(legacyCancelText);
assert.strictEqual(parsedLegacyCancel.replyText, 'Sua sessão foi cancelada.');
assert.strictEqual(parsedLegacyCancel.action.type, 'cancel_event');
assert.strictEqual(parsedLegacyCancel.action.params.cancellationInfo, 'cancelamento confirmado');
console.log('✅ parseStructuredResponse (Legacy CANCEL): Passed!');

// Test Handoff Tag [FIM_ATENDIMENTO]
const handoffText = 'Certo, vou te passar para o Rodrigo falar diretamente! [FIM_ATENDIMENTO]';
const parsedHandoff = parseStructuredResponse(handoffText);
assert.strictEqual(parsedHandoff.replyText, 'Certo, vou te passar para o Rodrigo falar diretamente!');
assert.strictEqual(parsedHandoff.requiresHuman, true);
console.log('✅ parseStructuredResponse (Handoff Tag): Passed!');
console.log('');


// ==========================================
// 3. ACTION GATE & CONFIRMATION TESTS
// ==========================================
console.log('--------------------------------------------');
console.log('Testing SarahActionGate...');
console.log('--------------------------------------------');

// Test isExplicitConfirmation
assert.strictEqual(isExplicitConfirmation('Sim, por favor'), true, 'Should match sim');
assert.strictEqual(isExplicitConfirmation('pode marcar!'), true, 'Should match pode marcar');
assert.strictEqual(isExplicitConfirmation('Ok, combinado.'), true, 'Should match combinado');
assert.strictEqual(isExplicitConfirmation('está correto'), true, 'Should match está correto (accented)');
assert.strictEqual(isExplicitConfirmation('Não, melhor outro dia'), false, 'Should NOT match não');
assert.strictEqual(isExplicitConfirmation('Gostaria de saber o preço'), false, 'Should NOT match informational messages');
assert.strictEqual(isExplicitConfirmation('pode me dizer o valor?'), false, 'Should NOT match broad pode questions');
assert.strictEqual(isExplicitConfirmation('quero outro horário'), false, 'Should NOT match broad quero/change requests');
console.log('✅ isExplicitConfirmation: Passed!');

// Test hasValidParamsForType
assert.strictEqual(hasValidParamsForType('create_event', { date: '2026-05-22', time: '10:00' }), true);
assert.strictEqual(hasValidParamsForType('create_event', { date: '2026-05-22' }), false, 'create_event needs time');
assert.strictEqual(hasValidParamsForType('cancel_event', { cancellationInfo: 'Sessão de amanhã' }), true);
assert.strictEqual(hasValidParamsForType('cancel_event', { date: '2026-05-22', time: '10:00' }), true);
assert.strictEqual(hasValidParamsForType('cancel_event', {}), false);
console.log('✅ hasValidParamsForType: Passed!');

// Test evaluateActionWithGate - Proposing slots (No Confirmation Needed, type !== create_event/cancel_event)
const actionPropose = { type: 'propose_slots', params: {}, requiresConfirmation: false };
const gatePropose = evaluateActionWithGate(actionPropose, {}, 'Estou livre de tarde');
assert.deepStrictEqual(gatePropose.finalAction, actionPropose, 'Should pass propose_slots directly');
console.log('✅ evaluateActionWithGate (propose_slots): Passed!');

// Test evaluateActionWithGate - Step A: Action requires confirmation = true (should block & store in pending)
const actionBookPending = {
    type: 'create_event',
    params: { patientName: 'John', date: '2026-05-22', time: '10:00' },
    requiresConfirmation: true
};
const context1 = { pending_action: null };
const gateStepA = evaluateActionWithGate(actionBookPending, context1, 'Quero marcar na sexta');
assert.strictEqual(gateStepA.finalAction.type, 'none', 'Should return action type none when confirmation is required');
assert.deepStrictEqual(gateStepA.updatedPendingAction, actionBookPending, 'Should store the action in updatedPendingAction');
console.log('✅ evaluateActionWithGate (Step A: Save Pending): Passed!');

// Test evaluateActionWithGate - Step B: User confirms, Action comes with requiresConfirmation = false
const context2 = { pending_action: actionBookPending };
const actionBookConfirm = {
    type: 'create_event',
    params: { patientName: 'John', date: '2026-05-22', time: '10:00' },
    requiresConfirmation: false
};
const gateStepB = evaluateActionWithGate(actionBookConfirm, context2, 'Sim, confirmo!');
assert.strictEqual(gateStepB.finalAction.type, 'create_event', 'Should allow execution when confirmed');
assert.strictEqual(gateStepB.finalAction.requiresConfirmation, false);
assert.strictEqual(gateStepB.updatedPendingAction, null, 'Should clear pending action after success');
console.log('✅ evaluateActionWithGate (Step B: Successful Confirmation): Passed!');

// Test evaluateActionWithGate - Parameter Restoration when user confirms with empty/omitted params
const actionConfirmOmittedParams = {
    type: 'create_event',
    params: {},
    requiresConfirmation: false
};
const gateRestore = evaluateActionWithGate(actionConfirmOmittedParams, context2, 'pode marcar!');
assert.strictEqual(gateRestore.finalAction.type, 'create_event');
assert.deepStrictEqual(gateRestore.finalAction.params, actionBookPending.params, 'Parameters should be restored from pending action');
assert.strictEqual(gateRestore.updatedPendingAction, null);
console.log('✅ evaluateActionWithGate (Parameter Restoration): Passed!');

// Test evaluateActionWithGate - Server-side Gate interception (Direct execution bypass prevention)
// Case: Model output sets requiresConfirmation = false, but there is NO pending action in context
const actionBypassNoPending = {
    type: 'create_event',
    params: { patientName: 'John', date: '2026-05-22', time: '10:00' },
    requiresConfirmation: false
};
const gateBypass1 = evaluateActionWithGate(actionBypassNoPending, { pending_action: null }, 'Quero marcar direto');
assert.strictEqual(gateBypass1.finalAction.type, 'none', 'Gate must block direct execution if no pending action exists');
assert.strictEqual(gateBypass1.finalAction.requiresConfirmation, true, 'Gate must force confirmation required');
assert.deepStrictEqual(gateBypass1.updatedPendingAction.params, actionBypassNoPending.params, 'Gate must save incoming valid action to pending');
console.log('✅ evaluateActionWithGate (Bypass Interception - No Pending): Passed!');

// Case: Model output sets requiresConfirmation = false, pending action exists, but user message does NOT confirm
const gateBypass2 = evaluateActionWithGate(actionBookConfirm, context2, 'Qual o valor mesmo?');
assert.strictEqual(gateBypass2.finalAction.type, 'none', 'Gate must block execution if user message does not contain explicit confirmation phrase');
assert.strictEqual(gateBypass2.finalAction.requiresConfirmation, true);
assert.deepStrictEqual(gateBypass2.updatedPendingAction, actionBookPending, 'Should keep the current pending action');
console.log('✅ evaluateActionWithGate (Bypass Interception - Message not confirming): Passed!');

// ==========================================
// 4. PRESERVATION CRITERION TESTS
// ==========================================
console.log('--------------------------------------------');
console.log('Testing Preservation Criterion...');
console.log('--------------------------------------------');

// Case A: A blocked action comes with incomplete params. It must NOT overwrite a good existing pending action.
const contextGoodPending = { pending_action: actionBookPending };
const actionIncomplete = {
    type: 'create_event',
    params: { patientName: 'John' }, // Missing date and time!
    requiresConfirmation: false
};
const gatePreserve1 = evaluateActionWithGate(actionIncomplete, contextGoodPending, 'Qual o valor?');
assert.strictEqual(gatePreserve1.finalAction.type, 'none');
assert.deepStrictEqual(gatePreserve1.updatedPendingAction, actionBookPending, 'Good pending action should be preserved!');
console.log('✅ Preservation Criterion (Incomplete block does not overwrite): Passed!');

// Case B: A blocked action comes with complete params. It IS allowed to overwrite the pending action.
const actionNewComplete = {
    type: 'create_event',
    params: { patientName: 'John', date: '2026-05-25', time: '14:00' }, // New slot
    requiresConfirmation: true
};
const gatePreserve2 = evaluateActionWithGate(actionNewComplete, contextGoodPending, 'Não, melhor dia 25 às 14h');
assert.strictEqual(gatePreserve2.finalAction.type, 'none');
assert.deepStrictEqual(gatePreserve2.updatedPendingAction, actionNewComplete, 'Pending action should be updated with the new complete action');
console.log('✅ Preservation Criterion (Complete action updates pending): Passed!');
console.log('');


// ==========================================
// 5. CONSERVATIVE CANCELLATION TESTS
// ==========================================
console.log('--------------------------------------------');
console.log('Testing Conservative Cancellation...');
console.log('--------------------------------------------');

const pendingCancel = {
    type: 'cancel_event',
    params: { date: '2026-05-22', time: '10:00', cancellationInfo: 'Consulta de sexta' },
    requiresConfirmation: true
};
const contextCancelPending = { pending_action: pendingCancel };

// Case A: User confirms with matching params
const actionCancelConfirm = {
    type: 'cancel_event',
    params: { date: '2026-05-22', time: '10:00', cancellationInfo: 'Consulta de sexta' },
    requiresConfirmation: false
};
const gateCancel1 = evaluateActionWithGate(actionCancelConfirm, contextCancelPending, 'Sim, cancele');
assert.strictEqual(gateCancel1.finalAction.type, 'cancel_event');
assert.strictEqual(gateCancel1.updatedPendingAction, null);
console.log('✅ Conservative Cancel (Matching confirmation): Passed!');

// Case B: User confirms but with mismatched params (e.g. tries to cancel a different day/time)
const actionCancelMismatched = {
    type: 'cancel_event',
    params: { date: '2026-05-23', time: '11:00', cancellationInfo: 'Consulta de sábado' },
    requiresConfirmation: false
};
const gateCancel2 = evaluateActionWithGate(actionCancelMismatched, contextCancelPending, 'Sim, confirmo');
assert.strictEqual(gateCancel2.finalAction.type, 'none', 'Gate must block cancel due to parameter mismatch');
assert.deepStrictEqual(gateCancel2.updatedPendingAction, { ...actionCancelMismatched, requiresConfirmation: true }, 'Mismatched complete action becomes the new pending action');
console.log('✅ Conservative Cancel (Mismatched parameters blocked): Passed!');

// Case C: User confirms with empty params (params should be restored)
const actionCancelEmpty = {
    type: 'cancel_event',
    params: {},
    requiresConfirmation: false
};
const gateCancel3 = evaluateActionWithGate(actionCancelEmpty, contextCancelPending, 'Sim, pode cancelar');
assert.strictEqual(gateCancel3.finalAction.type, 'cancel_event');
assert.deepStrictEqual(gateCancel3.finalAction.params, pendingCancel.params, 'Cancellation params should be restored');
assert.strictEqual(gateCancel3.updatedPendingAction, null);
console.log('✅ Conservative Cancel (Empty confirmation restores params): Passed!');
console.log('');

console.log('🎉 ALL INTEGRATION AND UNIT TESTS PASSED SUCCESSFULLY! 100% CORRECT!');
