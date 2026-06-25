import { GoogleGenerativeAI } from '@google/generative-ai';
import { Pool } from 'pg';
import { logger } from '../logger/logger';
import { WhatsappSessionManager } from '../whatsapp/WhatsappSessionManager';
import { WhatsappClient } from '../whatsapp/WhatsappClient';
import { GoogleCalendarClient } from '../google/GoogleCalendarClient';
import { parseStructuredResponse as parseResponseHelper } from './SarahResponseParser';
import { evaluateActionWithGate } from './SarahActionGate';
import { buildSaoPauloDateTimeIso, addMinutesToSaoPauloIso, getSaoPauloTodayParts } from './SarahTimezoneHelper';

export interface GeminiResponse {
    action: 'schedule' | 'rewrite' | 'chat';
    data: {
        recipientId?: string;
        content?: string;
        sendAt?: string;
        platform?: 'whatsapp' | 'telegram';
    };
    explanation: string;
}

export class GeminiClient {
    private ai: GoogleGenerativeAI | null = null;

    private getAdminJid(): string {
        const num = process.env.ADMIN_WHATSAPP_NUMBER || '5518996994225';
        return num.includes('@') ? num : `${num}@s.whatsapp.net`;
    }

    private getAdminNumber(): string {
        const num = process.env.ADMIN_WHATSAPP_NUMBER || '5518996994225';
        return num.split('@')[0];
    }

    private getUserId(): string {
        if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEFAULT_USER !== 'true') {
            throw new Error('Vazamento prevenido: AI requer tenantId explicíto em produção.');
        }
        return process.env.DEFAULT_USER_ID || 'default-user-id';
    }


    constructor(
        private readonly dbPool: Pool,
        private readonly sessionManager: WhatsappSessionManager
    ) {
        const apiKey = process.env.GEMINI_API_KEY || '';
        if (apiKey) {
            try {
                this.ai = new (GoogleGenerativeAI as any)(apiKey, { apiVersion: 'v1beta' });
                logger.info('🤖 Módulo Gemini AI Secretária carregado com sucesso!');
            } catch (err) {
                logger.error({ err }, 'Erro ao instanciar o cliente GoogleGenerativeAI');
            }
        } else {
            logger.warn('⚠️ GEMINI_API_KEY não configurada no .env. A secretária de IA funcionará em modo simulação.');
        }

      }



    public async processPrompt(prompt: string, currentContent?: string, tenantId?: string): Promise<GeminiResponse> {
        if (!this.ai) {
            return this.getMockResponse(prompt);
        }

        try {
            // 1. Carregar contatos e grupos para injetar inteligência de nomes
            const contactsRes = tenantId
                ? await this.dbPool.query('SELECT name, id FROM whatsapp_contacts WHERE tenant_id = $1::uuid LIMIT 100;', [tenantId])
                : await this.dbPool.query('SELECT name, id FROM whatsapp_contacts LIMIT 100;');
            const contactsList = contactsRes.rows.map(c => `- Contato: "${c.name}" | ID: "${c.id}"`).join('\n');

            let groupsList = '';
            try {
                const whatsappClient = tenantId ? await this.sessionManager.getSession(tenantId) : null;
                if (whatsappClient && whatsappClient.isConnected()) {
                    const groups = await whatsappClient.getGroups();
                    groupsList = groups.slice(0, 100).map(g => `- Grupo: "${g.name}" | ID: "${g.id}"`).join('\n');
                }
            } catch (err) {
                logger.warn({ err }, 'Erro ao carregar grupos para o Gemini');
            }

            const now = new Date();
            const nowFormatted = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

            const systemInstruction = `
Você é a "Secretária Inteligente", a co-piloto de IA integrada ao WhatsApp Scheduler.
Seu objetivo é ler o comando em linguagem natural do usuário e realizar uma das seguintes ações:
1. "schedule": Agendar uma nova mensagem. Extraia o destinatário (procurando nos contatos/grupos fornecidos para obter o ID correto), a mensagem e a data de envio calculada.
2. "rewrite": Melhorar ou reescrever a mensagem atual informada pelo usuário.
3. "chat": Responder dúvidas ou conversar.

CONTEXTO ATUAL DE DATA/HORA (Fuso Horário do Brasil):
- Agora é exatamente: ${nowFormatted}
- ISO String (UTC): ${now.toISOString()}
Use isso para calcular datas relativas como "amanhã às 15h", "quarta que vem às 10h", "daqui a 30 minutos", etc.

CONTATOS DE WHATSAPP DO USUÁRIO:
${contactsList}

GRUPOS DE WHATSAPP DO USUÁRIO:
${groupsList}

REGRAS DE RESOLUÇÃO:
- Se o usuário pedir para enviar para um nome de contato ou grupo (ex: "avise no SAYONICOS"), procure na lista e coloque o ID do grupo exato correspondente no "recipientId".
- Se for um número de telefone direto no texto (ex: 5518996994225), use-o.
- Se o destinatário não for encontrado, deixe o campo "recipientId" em branco ou nulo.
- O campo "sendAt" deve ser SEMPRE retornado em formato ISO String UTC.

FORMATO DE RESPOSTA OBRIGATÓRIO (Retorne APENAS um JSON válido):
{
  "action": "schedule" | "rewrite" | "chat",
  "data": {
    "recipientId": "ID do contato ou grupo",
    "content": "Texto formatado da mensagem a ser enviada",
    "sendAt": "ISO String UTC calculada para o agendamento",
    "platform": "whatsapp"
  },
  "explanation": "Explicação amigável em português do que você fez."
}
`;

            const fullPrompt = `${systemInstruction}\n\n--- ENTRADA DO USUÁRIO ---\nMensagem Atual no formulário: "${currentContent || ''}"\nComando do usuário: "${prompt}"\n\nRetorne EXCLUSIVAMENTE o JSON de resposta:`;

            const apiKey = process.env.GEMINI_API_KEY || '';
            if (!apiKey) {
                return this.getMockResponse(prompt);
            }

            const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: fullPrompt
                        }]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "OBJECT",
                            properties: {
                                action: {
                                    type: "STRING",
                                    enum: ["schedule", "rewrite", "chat"]
                                },
                                data: {
                                    type: "OBJECT",
                                    properties: {
                                        recipientId: { type: "STRING" },
                                        content: { type: "STRING" },
                                        sendAt: { type: "STRING" },
                                        platform: { type: "STRING" }
                                    }
                                },
                                explanation: { type: "STRING" }
                            },
                            required: ["action", "data", "explanation"]
                        }
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Erro na API do Gemini (${response.status}): ${errText}`);
            }

            const resJson = await response.json() as any;
            let text = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            
            logger.info({ responseText: text }, 'Resposta bruta da Secretária Gemini');

            // Limpar blocos de codigo markdown
            if (text.startsWith('```')) {
                text = text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
            }

            return JSON.parse(text) as GeminiResponse;
        } catch (error: any) {
            logger.error({ 
                errMsg: error?.message, 
                errStack: error?.stack,
                error 
            }, 'Erro ao chamar a API do Gemini via REST');
            return this.getMockResponse(prompt);
        }
    }

    private getMockResponse(prompt: string): GeminiResponse {
        // Simulação inteligente de fallback caso a chave não esteja ativa ou ocorra erro
        const promptLower = prompt.toLowerCase();
        
        if (promptLower.includes('agend') || promptLower.includes('lembrete') || promptLower.includes('envi')) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(15, 0, 0, 0);

            return {
                action: 'schedule',
                data: {
                    recipientId: this.getAdminNumber(),
                    content: 'Olá! Passando para lembrar do nosso compromisso amanhã às 15:00.',
                    sendAt: tomorrow.toISOString(),
                    platform: 'whatsapp'
                },
                explanation: '🤖 [MOCK SECRETÁRIA] Detectei que você deseja agendar um lembrete. Preenchi os dados simulados para amanhã às 15h. (Configure sua GEMINI_API_KEY no .env para inteligência real!)'
            };
        }

        if (promptLower.includes('melhor') || promptLower.includes('reescrev') || promptLower.includes('simpatic') || promptLower.includes('formal')) {
            return {
                action: 'rewrite',
                data: {
                    content: 'Prezado(a), gostaríamos de lembrá-lo(a) gentilmente que o vencimento da sua fatura será amanhã. Permanecemos à total disposição!'
                },
                explanation: '🤖 [MOCK SECRETÁRIA] Reescrevi sua mensagem para deixá-la mais simpática e formal. (Configure sua GEMINI_API_KEY no .env para inteligência real!)'
            };
        }

        return {
            action: 'chat',
            data: {},
            explanation: `🤖 [MOCK SECRETÁRIA] Recebi seu comando: "${prompt}". Conecte sua GEMINI_API_KEY no arquivo .env para que eu possa executar agendamentos e reescritas em tempo real com toda a inteligência do Gemini!`
        };
    }

    public async getAISettings(userId: string) {
        const result = await this.dbPool.query(
            'SELECT ai_auto_reply_enabled, ai_auto_reply_instructions, office_hours, receive_weekly_report FROM system_settings WHERE user_id = $1;',
            [userId]
        );
        if (result.rows.length === 0) {
            return {
                enabled: false,
                instructions: 'Você é a Secretária Virtual do Rodrigo. Responda com simpatia, brevidade e de forma extremamente profissional em português.',
                officeHours: {},
                receiveWeeklyReport: false,
                weeklyReportDay: '1',
                weeklyReportTime: '08:00'
            };
        }
        return {
            enabled: result.rows[0].ai_auto_reply_enabled,
            instructions: result.rows[0].ai_auto_reply_instructions,
            officeHours: result.rows[0].office_hours || {},
            receiveWeeklyReport: result.rows[0].receive_weekly_report ?? false,
            weeklyReportDay: result.rows[0].weekly_report_day || '1',
            weeklyReportTime: result.rows[0].weekly_report_time || '08:00'
        };
    }

    public async updateAISettings(userId: string, enabled: boolean, instructions: string, officeHours?: any, receiveWeeklyReport?: boolean) {
        await this.dbPool.query(
            `INSERT INTO system_settings (user_id, ai_auto_reply_enabled, ai_auto_reply_instructions, office_hours, receive_weekly_report, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET ai_auto_reply_enabled = $2, ai_auto_reply_instructions = $3, office_hours = COALESCE($4, system_settings.office_hours), receive_weekly_report = COALESCE($5, system_settings.receive_weekly_report), updated_at = NOW();`,
            [userId, enabled, instructions, officeHours ? JSON.stringify(officeHours) : null, receiveWeeklyReport !== undefined ? receiveWeeklyReport : false]
        );
        logger.info('🤖 Configurações da Secretária salvas com sucesso!');
    }

    private async loadContactContext(contactJid: string, displayName: string, tenantId: string): Promise<any> {
        try {
            const res = await this.dbPool.query(
                `SELECT contact_jid, display_name, summary, current_intent, conversation_stage, pending_action, preferences
                 FROM whatsapp_ai_contact_contexts WHERE tenant_id = $1::uuid AND contact_jid = $2;`,
                [tenantId, contactJid]
            );

            // Buscar do perfil temporário da Sarah também
            const profileRes = await this.dbPool.query(
                `SELECT full_name, phone, city, modality, session_type, referral, notes 
                 FROM sarah_patient_profiles WHERE tenant_id = $1::uuid AND contact_jid = $2;`,
                [tenantId, contactJid]
            );
            const profile = profileRes.rows[0] || {};

            if (res.rows.length > 0) {
                const row = res.rows[0];
                const prefs = row.preferences || {};
                
                // Mesclar preferências do banco com o que está no perfil estruturado para garantir sincronia
                const mergedPreferences = {
                    location: profile.modality || prefs.location || null,
                    patientName: profile.full_name || prefs.patientName || null,
                    city: profile.city || prefs.city || null,
                    sessionType: profile.session_type || prefs.sessionType || null,
                    referral: profile.referral || prefs.referral || null,
                    ...prefs
                };

                return {
                    contact_jid: row.contact_jid,
                    display_name: row.display_name || displayName,
                    summary: row.summary || profile.notes || '',
                    current_intent: row.current_intent || '',
                    conversation_stage: row.conversation_stage || 'greeting',
                    pending_action: row.pending_action || null,
                    preferences: mergedPreferences
                };
            } else {
                // Caso não exista o contexto de chat ainda, mas exista um perfil estruturado anterior
                const mergedPreferences = {
                    location: profile.modality || null,
                    patientName: profile.full_name || null,
                    city: profile.city || null,
                    sessionType: profile.session_type || null,
                    referral: profile.referral || null
                };

                return {
                    contact_jid: contactJid,
                    display_name: displayName,
                    summary: profile.notes || '',
                    current_intent: '',
                    conversation_stage: 'greeting',
                    pending_action: null,
                    preferences: mergedPreferences
                };
            }
        } catch (err) {
            logger.error({ err, contactJid }, 'Erro ao carregar contexto de contato da IA');
        }
        return {
            contact_jid: contactJid,
            display_name: displayName,
            summary: '',
            current_intent: '',
            conversation_stage: 'greeting',
            pending_action: null,
            preferences: {}
        };
    }

    private async saveContactContext(context: any, tenantId: string): Promise<void> {
        try {
            // 1. Salvar no whatsapp_ai_contact_contexts
            await this.dbPool.query(
                `INSERT INTO whatsapp_ai_contact_contexts 
                 (tenant_id, contact_jid, display_name, summary, current_intent, conversation_stage, pending_action, preferences, last_interaction_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                 ON CONFLICT (tenant_id, contact_jid)
                 DO UPDATE SET 
                    display_name = COALESCE($3, whatsapp_ai_contact_contexts.display_name),
                    summary = COALESCE($4, whatsapp_ai_contact_contexts.summary),
                    current_intent = COALESCE($5, whatsapp_ai_contact_contexts.current_intent),
                    conversation_stage = COALESCE($6, whatsapp_ai_contact_contexts.conversation_stage),
                    pending_action = $7,
                    preferences = COALESCE($8, whatsapp_ai_contact_contexts.preferences),
                    last_interaction_at = NOW(),
                    updated_at = NOW();`,
                [
                    tenantId,
                    context.contact_jid,
                    context.display_name,
                    context.summary,
                    context.current_intent,
                    context.conversation_stage,
                    context.pending_action ? JSON.stringify(context.pending_action) : null,
                    context.preferences ? JSON.stringify(context.preferences) : null
                ]
            );

            // 2. Salvar/atualizar na sarah_patient_profiles
            const phone = context.contact_jid.split('@')[0];
            const fullName = context.preferences?.patientName || context.display_name || null;
            const city = context.preferences?.city || null;
            const modality = context.preferences?.location === 'online' || context.preferences?.location === 'presencial' ? context.preferences.location : null;
            const sessionType = context.preferences?.sessionType === 'psicoterapia' || context.preferences?.sessionType === 'pastoral' ? context.preferences.sessionType : null;
            const referral = context.preferences?.referral || null;
            const notes = context.summary || null;

            await this.dbPool.query(
                `INSERT INTO sarah_patient_profiles 
                 (tenant_id, contact_jid, full_name, phone, city, modality, session_type, referral, notes, last_contact, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, NOW())
                 ON CONFLICT (tenant_id, contact_jid)
                 DO UPDATE SET 
                    full_name = COALESCE($3, sarah_patient_profiles.full_name),
                    phone = COALESCE($4, sarah_patient_profiles.phone),
                    city = COALESCE($5, sarah_patient_profiles.city),
                    modality = COALESCE($6, sarah_patient_profiles.modality),
                    session_type = COALESCE($7, sarah_patient_profiles.session_type),
                    referral = COALESCE($8, sarah_patient_profiles.referral),
                    notes = COALESCE($9, sarah_patient_profiles.notes),
                    last_contact = CURRENT_DATE,
                    updated_at = NOW();`,
                [
                    tenantId,
                    context.contact_jid,
                    fullName,
                    phone,
                    city,
                    modality,
                    sessionType,
                    referral,
                    notes
                ]
            );
        } catch (err) {
            logger.error({ err, context }, 'Erro ao salvar contexto de contato da IA');
        }
    }

    public static parseStructuredResponse(rawReply: string): any {
        return parseResponseHelper(rawReply);
    }

    private buildSecretaryPrompt(
        contactName: string,
        context: any,
        freeSlotsStr: string,
        calendarActive: boolean,
        formattedOfficeHours: string,
        conversationHistory: string,
        instructions: string
    ): string {
        const aiName = process.env.SARAH_AI_NAME || 'Sarah';
        const now = new Date();
        const nowFormatted = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        
        return `Você é a **${aiName}**, a Secretária e Assistente Virtual inteligente do **Rodrigo Sonsino**.
Seu papel é interagir de forma acolhedora, inteligente, elegante, humana e pastoral com os contatos no WhatsApp.
O tom de voz deve ser equilibrado: maduro, acolhedor, profissional e caloroso.

---
### 📅 HORÁRIOS LIVRES NA AGENDA
- Integração da Agenda Google: ${calendarActive ? 'ATIVA' : 'DESATIVADA'}
${calendarActive ? `
Estes são os horários LIVRES e DISPONÍVEIS na agenda do Rodrigo nos próximos 14 dias (calculados a partir do cruzamento de seus horários de atendimento com eventos ocupados e fuso horário).
Sugira EXCLUSIVAMENTE estes horários para agendamento. Se o cliente pedir outro horário, informe gentilmente que não há disponibilidade:
${freeSlotsStr || 'Nenhum horário livre disponível nos próximos dias.'}
` : `
ATENÇÃO: A agenda Google do Rodrigo está desconectada no momento.
- NUNCA invente ou proponha horários de atendimento específicos.
- Informe gentilmente ao contato que a agenda automatizada está temporariamente em manutenção e pergunte qual é o dia e período de preferência da pessoa para que o Rodrigo possa verificar e confirmar manualmente depois.
`}

---
### 🕒 HORÁRIOS DE ATENDIMENTO REGULARES (Se a agenda estiver ativa)
Estes são os horários regulares em que o Rodrigo realiza atendimentos. Você deve sugerir sessões EXCLUSIVAMENTE dentro destes dias da semana e horários específicos:
${formattedOfficeHours}
As sessões duram sempre de 45 a 55 minutos.

---
### 👤 PERFIL DO RODRIGO SONSINO
1. **Pastor Rodrigo**: Aconselhamento espiritual e conversa pastoral. Foco em fé, oração, orientação pastoral e bíblica. As conversas pastorais são gratuitas/voluntárias.
2. **Psicoterapeuta Rodrigo**: Clínica psicológica (individual, online e presencial). Foco em saúde mental, autoconhecimento, superação de traumas. Atendimento profissional (pago).

---
### 🛠️ REGRAS DE ATENDIMENTO E FLUXOS
1. **Detecção de Intenção & Saudação**:
   - Use o nome da pessoa se disponível (ex: "Olá, ${contactName} 😊").
   - Identifique a dor/intenção e direcione:
     * Dores espirituais, oração, fé, casamento cristão, conselho bíblico -> Direcione para a **Conversa Pastoral** do *Pastor Rodrigo*.
     * Depressão, ansiedade, pânico, conflitos psicológicos, terapia -> Direcione para a **Psicoterapia** do *Psicoterapeuta Rodrigo*.
     * Caso contrário, apresente o Menu Inicial:
       1️⃣ Conversa Pastoral
       2️⃣ Psicoterapia / Clínico
       3️⃣ Outros assuntos

2. **Fluxo 1 — Conversa Pastoral**:
   - Pergunte se deseja agendar uma conversa ou deixar um recado.

3. **Fluxo 2 — Psicoterapia**:
   - Opções: 1️⃣ Agendar uma sessão | 2️⃣ Receber informações | 3️⃣ Cancelar uma sessão | 4️⃣ Deixar uma mensagem.
   - **Agendamento**: Colete de forma sutil (uma ou duas perguntas por vez) as informações:
     * Nome completo, Cidade/Estado, Online ou Presencial, Primeira sessão ou retorno, Indicação, Melhores dias/períodos.
     * Quando o paciente escolher um dia e horário exato e livre, você deve propor ou agendar.
   - **Informações**: "O atendimento clínico com o Psicoterapeuta Rodrigo Sonsino é realizado por meio de sessões individuais (Online ou Presenciais), integrando de forma ética e segura a saúde emocional, o autoconhecimento e a espiritualidade cristã. Cada sessão tem duração média de 50 minutos."
   - **Cancelamento**: Pergunte o dia e horário que deseja cancelar.

4. **Confirmação Estrita de Ações (CRÍTICO)**:
   - **NUNCA** marque ou cancele uma consulta diretamente sem que o usuário confirme explicitamente.
   - Para propor horários, utilize a ação "propose_slots".
   - Quando o usuário disser que deseja marcar em um horário X, primeiro responda perguntando "Confirma o agendamento para [Data] às [Hora]?" e defina a ação no JSON como "create_event" com "requiresConfirmation: true".
   - Quando o usuário disser "Sim", "Confirmo", ou similar em resposta a essa pergunta de confirmação, aí sim dispare a ação "create_event" com "requiresConfirmation: false".
   - O mesmo vale para cancelamento: antes de cancelar, responda "Confirma o cancelamento da sessão de [Data] às [Hora]?" com a ação "cancel_event" e "requiresConfirmation: true". Quando confirmado, envie com "requiresConfirmation: false".
   - Se houver um "pending_action" no contexto atual (ex: agendamento pendente), use essa informação para detectar se o usuário está confirmando esse agendamento.

5. **Contato Direto (📞 / Handoff)**:
   - Se o contato solicitar falar com o Rodrigo, pedir ajuda de um humano, transferir, demonstrar irritação, pedir para encerrar ou enviar o emoji "📞", defina "requiresHuman: true" no JSON e diga de forma acolhedora que o Rodrigo retornará pessoalmente assim que possível.

---
### 📏 ESTILO DE RESPOSTA E CONCISÃO (CRÍTICO)
- Responda de forma extremamente **acolhedora** e **objetiva**.
- **MÁXIMO 2 PARÁGRAFOS BREVES**. Evite menus gigantescos ou textos longos.
- **NUNCA** repita perguntas que já foram feitas no histórico. Verifique o histórico de conversa antes de perguntar novamente a mesma coisa.
- Adicione no rodapé da mensagem (de forma curta e discreta): 
  "*(Se preferir falar direto com o Rodrigo ou encerrar o autoatendimento, basta digitar 📞 ou 'falar com o Rodrigo' a qualquer momento!)*"

---
### 📁 COMPROVANTES DE PAGAMENTO
- Se o usuário enviou uma imagem ou documento que parece ser um comprovante de pagamento Pix ou transferência:
  - Não mostre menus. Apenas agradeça de forma gentil e direta.
  - Responda: "Muito obrigado pelo envio do comprovante! Já salvei aqui e o Rodrigo vai confirmar em breve. 🙏😊"

---
### 🚨 SEGURANÇA E CRISE EMOCIONAL (CRÍTICO)
- Se detectar sinais de crise aguda, desesperança extrema, automutilação ou ideação suicida, interrompa tudo imediatamente e responda exatamente com a nota:
  "Percebo que este pode ser um momento muito delicado and difícil. Quero que saiba que sua vida tem muito valor e você não está sozinho(a). Se houver risco imediato ou se precisar de apoio urgente, por favor procure ajuda emergencial em um pronto-socorro próximo de você, ligue para o CVV (Centro de Valorização da Vida) no número 188 (atendimento gratuito 24h) ou converse com alguém de sua inteira confiança agora mesmo. Estou orando por você e, assim que o Rodrigo visualizar esta mensagem, ele entrará em contato."

---
### 📥 CONTEXTO DA CONVERSA
- Nome do contato: ${contactName}
- Data/Hora atual de São Paulo: ${nowFormatted}
- Resumo persistente da conversa: ${context.summary || 'Nenhum resumo anterior.'}
- Intent atual: ${context.current_intent || 'greeting'}
- Estágio da conversa: ${context.conversation_stage || 'initial'}
- Ação Pendente: ${context.pending_action ? JSON.stringify(context.pending_action) : 'Nenhuma'}
- Preferências: ${context.preferences ? JSON.stringify(context.preferences) : '{}'}

---
### 💬 HISTÓRICO DE MENSAGENS RECENTES (Para continuidade natural)
${conversationHistory}

---
### INSTRUÇÕES ADICIONAIS DO RODRIGO:
"${instructions}"

---
### FORMATO DE RETORNO (OBRIGATÓRIO - RETORNE APENAS O JSON VÁLIDO):
Você deve responder EXCLUSIVAMENTE um objeto JSON válido, sem tags markdown (\`\`\`json ou \`\`\`), no formato abaixo:
{
  "replyText": "Texto acolhedor e conciso a ser enviado no WhatsApp (máximo 2 parágrafos breves + rodapé de encerramento)",
  "intent": "schedule_session" | "cancel_session" | "general_chat" | "spiritual_counseling",
  "conversationStage": "greeting" | "collecting_info" | "proposing_slots" | "waiting_confirmation" | "completed" | "cancellation_requested" | "cancellation_waiting_confirmation",
  "summaryUpdate": "Atualização curta do resumo persistente da conversa e do contato (ex: paciente quer presencial, mora em SP)",
  "preferences": {
    "location": "online" | "presencial" | null,
    "patientName": "Nome completo se souber",
    "city": "Cidade se souber"
  },
  "action": {
    "type": "none" | "propose_slots" | "create_event" | "cancel_event" | "notify_owner" | "disable_ai",
    "params": {
      "patientName": "Nome do paciente",
      "date": "AAAA-MM-DD",
      "time": "HH:MM",
      "cancellationInfo": "Data/hora ou info de cancelamento"
    },
    "requiresConfirmation": true | false
  },
  "requiresHuman": false | true
}
`;
    }

    private async executeSecretaryAction(contactJid: string, clientName: string, action: any, context: any, clientMessage: string, tenantId: string): Promise<void> {
        if (!action || action.type === 'none') return;
        
        logger.info({ action, contactJid }, 'Executando ação da secretária AI com Gate de Segurança');
        
        const gateResult = evaluateActionWithGate(action, context, clientMessage);
        
        // Save the updated pending action in context
        context.pending_action = gateResult.updatedPendingAction;

        if (gateResult.warning) {
            logger.warn({ gateResult, action }, `[SarahActionGate Warning] ${gateResult.warning}`);
        }

        const finalAction = gateResult.finalAction;
        if (!finalAction || finalAction.type === 'none') {
            return;
        }

        const whatsappClient = await this.sessionManager.getSession(tenantId);

        try {
            switch (finalAction.type) {
                case 'create_event': {
                    const { patientName, date, time } = finalAction.params || {};
                    const finalPatientName = patientName || context.preferences?.patientName || clientName;
                    if (date && time) {
                        await this.handleBookAction(contactJid, finalPatientName, date, time, tenantId);
                    } else {
                        logger.warn({ params: finalAction.params }, 'Ação create_event sem parâmetros necessários pós-gate');
                    }
                    break;
                }
                case 'cancel_event': {
                    const { cancellationInfo } = finalAction.params || {};
                    const finalInfo = cancellationInfo || 'cancelamento solicitado';
                    await this.handleCancelAction(contactJid, clientName, finalInfo, tenantId);
                    break;
                }
                case 'disable_ai': {
                    logger.info(`Desativando IA para o contato ${contactJid} via ação explícita.`);
                    if (whatsappClient) {
                        await whatsappClient.disableAIForContact(contactJid);
                    }
                    break;
                }
                case 'notify_owner': {
                    const adminJid = this.getAdminJid();
                    const reason = finalAction.params?.reason || 'solicitação de contato';
                    const notifyMsg = `📢 *Sarah Assistente Virtual*
Olá Rodrigo! 

O(A) contato *${clientName}* (${contactJid.split('@')[0]}) solicitou atenção manual.
Motivo/Ação: ${reason}`;
                    if (whatsappClient) {
                        await whatsappClient.sendMessage(adminJid, notifyMsg);
                    }
                    break;
                }
                case 'propose_slots': {
                    break;
                }
                default:
                    logger.warn({ type: finalAction.type }, 'Tipo de ação pós-gate desconhecido');
            }
        } catch (err) {
            logger.error({ err, finalAction }, 'Erro ao executar ação autorizada pós-gate');
        }
    }

    public async generateAutoReply(
        contactJid: string, 
        clientName: string, 
        clientMessage: string, 
        instructions: string,
        mediaData?: { mimeType: string; data: string },
        tenantId?: string
    ): Promise<string> {
        const safeTenantId = tenantId || this.getUserId();
        if (!this.ai) {
            return `Olá ${clientName}! Obrigado por entrar em contato. Estarei repassando sua mensagem ao Rodrigo em breve. (Modo Auto-Resposta Simulação)`;
        }

        try {
            await this.dbPool.query(
                'INSERT INTO whatsapp_ai_chats (tenant_id, contact_jid, role, message_text) VALUES ($1::uuid, $2, $3, $4);',
                [safeTenantId, contactJid, 'user', clientMessage]
            );

            const context = await this.loadContactContext(contactJid, clientName, safeTenantId);

            const maxHistory = parseInt(process.env.SARAH_MAX_HISTORY_MESSAGES || '10', 10);
            const chatHistoryRes = await this.dbPool.query(
                'SELECT role, message_text FROM whatsapp_ai_chats WHERE tenant_id = $1::uuid AND contact_jid = $2 ORDER BY created_at DESC LIMIT $3;',
                [safeTenantId, contactJid, maxHistory]
            );
            const chatHistory = chatHistoryRes.rows.reverse();

            let conversationContext = '';
            for (const msg of chatHistory) {
                const speaker = msg.role === 'user' ? 'Cliente' : 'Você (Secretária)';
                conversationContext += `${speaker}: ${msg.message_text}\n`;
            }

            const settings = await this.getAISettings(safeTenantId);
            
            let calendarActive = false;
            let freeSlotsStr = '';
            try {
                const calendarClient = new GoogleCalendarClient(this.dbPool);
                const config = await calendarClient.getConfig(safeTenantId);
                if (config && config.isEnabled) {
                    calendarActive = true;
                    // Obter slots livres nos próximos 14 dias
                    const officeHours = settings?.officeHours || {};
                    const freeSlots = await calendarClient.getFreeSlotsForNextDays(config, officeHours, 14);
                    
                    // Agrupar por data para exibição amigável
                    // Exemplo: "Terça (10/06): 09h, 10h, 11h"
                    const weekdayNamesShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                    const slotsByDate: Record<string, string[]> = {};
                    
                    for (const slot of freeSlots) {
                        if (!slotsByDate[slot.date]) {
                            slotsByDate[slot.date] = [];
                        }
                        slotsByDate[slot.date].push(slot.time);
                    }
                    
                    const formattedSlots: string[] = [];
                    for (const dateStr of Object.keys(slotsByDate).sort()) {
                        const [year, month, day] = dateStr.split('-').map(Number);
                        const d = new Date(year, month - 1, day);
                        const weekday = weekdayNamesShort[d.getDay()];
                        const formattedDate = `${weekday} (${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')})`;
                        
                        const hoursStr = slotsByDate[dateStr].map(h => h.replace(':00', 'h')).join(', ');
                        formattedSlots.push(`${formattedDate}: ${hoursStr}`);
                    }
                    
                    if (formattedSlots.length > 0) {
                        freeSlotsStr = formattedSlots.join('\n');
                    }
                }
            } catch (calErr) {
                logger.error({ calErr }, 'Erro ao carregar e calcular slots livres para o prompt do Gemini');
            }

            let formattedOfficeHours = `Atendo de segunda a quinta-feira.
Segundas-feiras - às 9h, às 10h, às 11, às 13h, às 14h
Terças-feiras - às 10h, às 11h, às 14h, às 15h
Quartas-feiras - às 10h, às 11h, às 14h, às 15h
Quintas-feiras - às 8h, às 9h, às 13h, às 14h`;

            if (settings && settings.officeHours) {
                try {
                    const oh = typeof settings.officeHours === 'string' ? JSON.parse(settings.officeHours) : settings.officeHours;
                    const daysMap: Record<string, string> = {
                        segunda: 'Segundas-feiras',
                        terca: 'Terças-feiras',
                        quarta: 'Quartas-feiras',
                        quinta: 'Quintas-feiras',
                        sexta: 'Sextas-feiras',
                        sabado: 'Sábados',
                        domingo: 'Domingos'
                    };
                    
                    const formattedDays = Object.keys(oh).map(day => {
                        const hours = oh[day] || [];
                        if (hours.length === 0) return null;
                        const formattedHours = hours.map((h: string) => `às ${h}`).join(', ');
                        return `${daysMap[day] || day} - ${formattedHours}`;
                    }).filter(Boolean);

                    if (formattedDays.length > 0) {
                        formattedOfficeHours = formattedDays.join('\n');
                    }
                } catch (ohErr) {
                    logger.error({ ohErr }, 'Erro ao formatar officeHours para o prompt.');
                }
            }

            const systemPrompt = this.buildSecretaryPrompt(
                clientName,
                context,
                freeSlotsStr,
                calendarActive,
                formattedOfficeHours,
                conversationContext,
                instructions
            );

            const apiKey = process.env.GEMINI_API_KEY || '';
            const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

            const parts: any[] = [{ text: systemPrompt }];
            if (mediaData) {
                parts.push({
                    inlineData: {
                        mimeType: mediaData.mimeType,
                        data: mediaData.data
                    }
                });
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: parts
                        }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: "OBJECT",
                                properties: {
                                    replyText: {
                                        type: "STRING",
                                        description: "Texto acolhedor e profissional a ser enviado de volta para o cliente no WhatsApp. Use pt-BR."
                                    },
                                    intent: {
                                        type: "STRING",
                                        description: "Intenção identificada do contato, como greeting, scheduling, canceling, human_handoff, general_chat, etc."
                                    },
                                    conversationStage: {
                                        type: "STRING",
                                        description: "Fase atual da conversa, como greeting, identifying_modality, check_slots, confirmation_pending, done."
                                    },
                                    summaryUpdate: {
                                        type: "STRING",
                                        description: "Resumo do que foi conversado ou acordado nesta interação para atualizar a memória persistente."
                                    },
                                    preferences: {
                                        type: "OBJECT",
                                        properties: {
                                            location: {
                                                type: "STRING",
                                                description: "Local/modalidade de preferência do paciente: 'online', 'presencial', ou nulo.",
                                                enum: ["online", "presencial"]
                                            },
                                            patientName: {
                                                type: "STRING",
                                                description: "Nome completo ou preferencial do paciente, caso informado."
                                            },
                                            city: {
                                                type: "STRING",
                                                description: "Cidade do paciente, caso informado."
                                            },
                                            sessionType: {
                                                type: "STRING",
                                                description: "Tipo de sessão: 'psicoterapia' ou 'pastoral', caso informado.",
                                                enum: ["psicoterapia", "pastoral"]
                                            },
                                            referral: {
                                                type: "STRING",
                                                description: "Como conheceu ou indicação, caso informado."
                                            }
                                        }
                                    },
                                    action: {
                                        type: "OBJECT",
                                        properties: {
                                            type: {
                                                type: "STRING",
                                                description: "Ação de agendamento a ser executada no sistema.",
                                                enum: ["none", "propose_slots", "create_event", "cancel_event", "notify_owner", "disable_ai"]
                                            },
                                            params: {
                                                type: "OBJECT",
                                                properties: {
                                                    patientName: {
                                                        type: "STRING",
                                                        description: "Nome do paciente para o evento no calendário."
                                                    },
                                                    date: {
                                                        type: "STRING",
                                                        description: "Data do agendamento em formato AAAA-MM-DD."
                                                    },
                                                    time: {
                                                        type: "STRING",
                                                        description: "Hora do agendamento em formato HH:MM."
                                                    },
                                                    cancellationInfo: {
                                                        type: "STRING",
                                                        description: "Informações de cancelamento (ex: data e hora do evento cancelado)."
                                                    },
                                                    reason: {
                                                        type: "STRING",
                                                        description: "Motivo da notificação ao dono ou cancelamento."
                                                    }
                                                }
                                            },
                                            requiresConfirmation: {
                                                type: "BOOLEAN",
                                                description: "Se a ação requer que o paciente ou o Rodrigo confirme explicitamente antes de executar no calendário."
                                            }
                                        },
                                        required: ["type", "params", "requiresConfirmation"]
                                    },
                                    requiresHuman: {
                                        type: "BOOLEAN",
                                        description: "Defina como true se a IA não puder resolver o problema ou se o usuário pediu especificamente para falar com o terapeuta humano, ou se for necessário desativar a IA."
                                    }
                                },
                                required: ["replyText", "intent", "conversationStage", "summaryUpdate", "preferences", "action", "requiresHuman"]
                            }
                        }
                    }),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Erro na API do Gemini (${response.status}): ${errText}`);
            }

            const resJson = await response.json() as any;
            let rawReply = resJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

            const parsedResponse = GeminiClient.parseStructuredResponse(rawReply);

            context.summary = parsedResponse.summaryUpdate || context.summary;
            context.current_intent = parsedResponse.intent || context.current_intent;
            context.conversation_stage = parsedResponse.conversationStage || context.conversation_stage;
            context.preferences = { ...context.preferences, ...parsedResponse.preferences };

            await this.executeSecretaryAction(contactJid, clientName, parsedResponse.action, context, clientMessage, safeTenantId);

            if (parsedResponse.requiresHuman === true) {
                logger.info(`🚫 [Sarah] requiresHuman detectado. Desativando a IA para o contato ${clientName} (${contactJid}).`);
                const whatsappClient = await this.sessionManager.getSession(safeTenantId);
                if (whatsappClient) {
                    await whatsappClient.disableAIForContact(contactJid);
                    await whatsappClient.notifyHumanHandoff(clientName, contactJid, 'Detectado requiresHuman no fluxo de conversa.');
                }
            }

            await this.saveContactContext(context, safeTenantId);

            let replyText = parsedResponse.replyText;

            if (replyText) {
                await this.dbPool.query(
                    'INSERT INTO whatsapp_ai_chats (tenant_id, contact_jid, role, message_text) VALUES ($1::uuid, $2, $3, $4);',
                    [safeTenantId, contactJid, 'model', replyText]
                );
            }

            return replyText;
        } catch (error: any) {
            logger.error({ errMsg: error?.message, errStack: error?.stack, error }, 'Erro ao gerar auto-resposta com o Gemini');
            return `Olá ${clientName}! Obrigado pela mensagem. Rodrigo retornará assim que possível!`;
        }
    }

    private async handleCancelAction(contactJid: string, clientName: string, actionInfo: string, tenantId: string) {
        try {
            logger.info(`🤖 [Sarah Assistente] Ação de Cancelamento disparada para: ${clientName} (${contactJid}). Detalhes: ${actionInfo}`);
            
            const whatsappClient = await this.sessionManager.getSession(tenantId);
            const calendarClient = new GoogleCalendarClient(this.dbPool);
            const config = await calendarClient.getConfig(tenantId);
            if (!config) {
                logger.warn(`⚠️ Google Calendar não configurado para ${tenantId}. Impossível cancelar.`);
                return;
            }

            const events = await calendarClient.getUpcomingEvents(config);
            logger.info(`📅 Buscando agendamentos de psicoterapia para cancelar. Total próximos: ${events.length}`);

            // Normalização robusta de texto (remove acentos, espaços extras, etc.)
            const normalizeText = (text: string) => {
                return text
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
            };

            // Função para extrair data e hora de uma string (ex: "hoje às 11:30", "amanhã às 14h")
            const parseDateTime = (info: string) => {
                const text = info.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                
                const todayParts = getSaoPauloTodayParts();
                let targetDate = new Date(todayParts.year, todayParts.month, todayParts.day);
                let textForTime = text;
                
                // Tratar "amanhã"
                if (text.includes('amanha')) {
                    targetDate.setDate(targetDate.getDate() + 1);
                    textForTime = textForTime.replace('amanha', '');
                } 
                // Tratar "dia XX" ou "dia XX/YY"
                else {
                    const dayMatch = text.match(/dia\s+(\d{1,2})(?:\/(\d{1,2}))?/i);
                    if (dayMatch) {
                        const day = parseInt(dayMatch[1], 10);
                        targetDate.setDate(day);
                        if (dayMatch[2]) {
                            const month = parseInt(dayMatch[2], 10) - 1; // 0-indexed
                            targetDate.setMonth(month);
                        }
                        textForTime = textForTime.replace(dayMatch[0], '');
                    }
                }

                // Tratar hora: "11:30", "11h30", "11h", "11:00"
                let hours = -1;
                let minutes = 0;

                const timeMatch = textForTime.match(/\b(\d{1,2})(?:[h:](\d{2})?)\b/i);
                if (timeMatch) {
                    hours = parseInt(timeMatch[1], 10);
                    if (timeMatch[2]) {
                        minutes = parseInt(timeMatch[2], 10);
                    }
                } else {
                    // Tentar encontrar qualquer padrão de hora simples como "11:30"
                    const colonMatch = textForTime.match(/\b(\d{1,2}):(\d{2})\b/);
                    if (colonMatch) {
                        hours = parseInt(colonMatch[1], 10);
                        minutes = parseInt(colonMatch[2], 10);
                    }
                }

                if (hours !== -1) {
                    return {
                        year: targetDate.getFullYear(),
                        month: targetDate.getMonth(), // 0-11
                        day: targetDate.getDate(),
                        hours,
                        minutes
                    };
                }
                return null;
            };

            const normalizedClientName = normalizeText(clientName);
            const cleanJidNumber = contactJid.replace(/[^0-9]/g, '');

            let matchedEvent: any = null;

            // 1. Tentar encontrar por data e hora exata (para casos em que o nome na agenda e o pushName do WhatsApp não batem)
            const parsedTarget = parseDateTime(actionInfo);
            logger.info({ parsedTarget, actionInfo }, '🤖 [Sarah Assistente] Parsing de data/hora concluído');

            if (parsedTarget) {
                for (const event of events) {
                    const eventStart = event.start?.dateTime || event.start?.date || '';
                    if (eventStart) {
                        try {
                            const eventDate = new Date(eventStart);
                            // Obter os componentes na timezone de São Paulo
                            const eventDateStr = eventDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                            // Formato típico de toLocaleString com pt-BR: "18/05/2026 11:30:00" ou "18/05/2026, 11:30:00"
                            const parts = eventDateStr.split(/[\s,]+/);
                            if (parts.length >= 2) {
                                const dateParts = parts[0].split('/');
                                const timeParts = parts[1].split(':');

                                const eventYear = parseInt(dateParts[2], 10);
                                const eventMonth = parseInt(dateParts[1], 10) - 1; // 0-indexed
                                const eventDay = parseInt(dateParts[0], 10);
                                const eventHours = parseInt(timeParts[0], 10);
                                const eventMinutes = parseInt(timeParts[1], 10);

                                const matchesDate = eventYear === parsedTarget.year && eventMonth === parsedTarget.month && eventDay === parsedTarget.day;
                                const matchesTime = eventHours === parsedTarget.hours && Math.abs(eventMinutes - parsedTarget.minutes) <= 5;

                                if (matchesDate && matchesTime) {
                                    logger.info(`📅 ENCONTRADO POR DATA/HORA EXATA! Evento: "${event.summary}" em ${eventDateStr} (ID: ${event.id})`);
                                    matchedEvent = event;
                                    break;
                                }
                            }
                        } catch (err) {
                            logger.error({ err, eventStart }, 'Erro ao analisar data do evento para comparação temporal');
                        }
                    }
                }
            }

            // 2. Se não encontrou por data/hora exata, tenta por JID ou por Nome (Fallback robusto)
            if (!matchedEvent) {
                logger.info('🔍 Evento não correspondido por hora exata. Iniciando busca por nome ou contato...');
                for (const event of events) {
                    const summary = normalizeText(event.summary || '');
                    const description = normalizeText(event.description || '');

                    // Critério A: Contém o nome do paciente no título/sumário do evento (ou vice-versa)
                    const matchesName = (normalizedClientName.length > 2) && (summary.includes(normalizedClientName) || normalizedClientName.includes(summary));
                    
                    // Critério B: Contém o telefone/JID do contato no sumário ou descrição
                    const matchesContact = cleanJidNumber.length > 5 && (summary.includes(cleanJidNumber) || description.includes(cleanJidNumber));

                    if (matchesName || matchesContact) {
                        logger.info(`📅 ENCONTRADO POR NOME/CONTATO! Evento: "${event.summary}" (ID: ${event.id})`);
                        matchedEvent = event;
                        break;
                    }
                }
            }

            if (!matchedEvent) {
                logger.warn(`⚠️ Nenhum agendamento futuro encontrado para o paciente: ${clientName} (${contactJid})`);
                
                // Enviar notificação de alerta para o Rodrigo no WhatsApp avisando que tentou cancelar mas não achou na agenda
                const alertMsg = `📢 *Sarah Assistente Virtual*
⚠️ O(A) paciente *${clientName}* (${contactJid.split('@')[0]}) cancelou a sessão (${actionInfo}), mas não localizei o evento correspondente na sua Agenda do Google. 

Por favor, verifique manualmente se há um horário marcado para ele(a).`;
                if (whatsappClient) {
                    await whatsappClient.sendMessage(this.getAdminJid(), alertMsg);
                }
                return;
            }

            // Deletar o evento
            const eventId = matchedEvent.id;
            const eventStart = matchedEvent.start?.dateTime || matchedEvent.start?.date || '';
            const eventSummary = matchedEvent.summary || 'Consulta/Sessão';
            
            // Formatando data para exibição humana (ex: 2026-05-20T17:10:00Z -> 20/05/2026 às 17:10)
            let formattedDateStr = eventStart;
            try {
                if (eventStart) {
                    const dateObj = new Date(eventStart);
                    formattedDateStr = dateObj.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                }
            } catch (err) {}

            logger.info(`📅 Evento encontrado! Cancelando "${eventSummary}" em ${formattedDateStr} (ID: ${eventId})`);
            await calendarClient.deleteEvent(tenantId, eventId);

            // Avisar o Rodrigo no WhatsApp
            const notificationMsg = `📢 *Sarah Assistente Virtual*
Olá Rodrigo! 

O(A) paciente *${clientName}* (${contactJid.split('@')[0]}) cancelou a consulta.

📅 *Sessão Cancelada na Agenda:*
- *Paciente:* ${clientName}
- *Horário:* ${formattedDateStr}
- *Título do Evento:* ${eventSummary}

O evento correspondente foi cancelado e removido automaticamente da sua Agenda do Google! 🗓️✅`;

            if (whatsappClient) {
                await whatsappClient.sendMessage(this.getAdminJid(), notificationMsg);
            }
            logger.info(`✅ Notificação de cancelamento enviada com sucesso para Rodrigo (+${this.getAdminNumber()})`);

        } catch (error) {
            logger.error({ error, clientName, contactJid }, 'Erro fatal ao processar cancelamento automático de sessão');
        }
    }

    private async handleBookAction(contactJid: string, patientName: string, dateStr: string, timeStr: string, tenantId: string) {
        try {
            logger.info(`🤖 [Sarah Assistente] Ação de Agendamento disparada para: ${patientName} (${contactJid}). Data: ${dateStr}, Hora: ${timeStr}`);

            const whatsappClient = await this.sessionManager.getSession(tenantId);
            const calendarClient = new GoogleCalendarClient(this.dbPool);
            const config = await calendarClient.getConfig(tenantId);
            if (!config) {
                logger.warn(`⚠️ Google Calendar não configurado para ${tenantId}. Impossível agendar.`);
                return;
            }

            // Construir data e hora explícita com o fuso horário de Brasília (-03:00) usando o helper
            const startTimeIso = buildSaoPauloDateTimeIso(dateStr, timeStr);
            const startMoment = new Date(startTimeIso);

            if (isNaN(startMoment.getTime())) {
                logger.error({ dateStr, timeStr }, 'Data ou hora inválida para agendamento.');
                return;
            }

            const endTimeIso = addMinutesToSaoPauloIso(startTimeIso, 50);
            const endMoment = new Date(endTimeIso);

            // --- SEGURANÇA CONTRA DUPLICIDADE/OVER-BOOKING EM TEMPO REAL ---
            let conflictingEvent: any = null;
            let checkFailed = false;
            try {
                const events = await calendarClient.getUpcomingEvents(config);
                for (const event of events) {
                    const eventStartStr = event.start?.dateTime || event.start?.date || '';
                    const eventEndStr = event.end?.dateTime || event.end?.date || '';
                    if (eventStartStr) {
                        const eventStart = new Date(eventStartStr);
                        const eventEnd = eventEndStr ? new Date(eventEndStr) : new Date(eventStart.getTime() + 60 * 60 * 1000); // 1 hora de fallback se sem fim

                        // Verificar se há sobreposição de horários (startMoment < eventEnd E endMoment > eventStart)
                        if (startMoment < eventEnd && endMoment > eventStart) {
                            conflictingEvent = event;
                            break;
                        }
                    }
                }
            } catch (checkErr) {
                logger.error({ checkErr }, 'Erro ao realizar checagem de conflitos de agenda em tempo real.');
                checkFailed = true;
            }

            if (checkFailed) {
                logger.warn(`⚠️ [Sarah] Falha na checagem de conflito da agenda. Bloqueando agendamento às cegas.`);

                // Enviar alerta para o Rodrigo no WhatsApp avisando do erro
                const alertMsg = `📢 *Sarah Assistente Virtual*
⚠️ O(A) paciente *${patientName}* tentou agendar para o horário *${startMoment.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}*, mas a checagem automática com o Google Agenda falhou devido a um erro técnico (rede/API).

Por segurança, *bloqueiei o agendamento às cegas* para evitar overbooking. Por favor, valide o horário manualmente e fale com o paciente!`;
                if (whatsappClient) {
                    await whatsappClient.sendMessage(this.getAdminJid(), alertMsg);
                    
                    // Responder ao paciente
                    const patientMsg = `Olá *${patientName}*! Estou com uma pequena oscilação temporária de conexão com o sistema de agenda do Rodrigo. 

Para evitar qualquer conflito de horários, prefiro não concluir o agendamento de forma automática agora. O Rodrigo já foi notificado no celular dele e entrará em contato com você em breve para confirmar! 🙏😊`;
                    await whatsappClient.sendMessage(contactJid, patientMsg);
                }
                return;
            }

            if (conflictingEvent) {
                logger.warn(`⚠️ [Sarah] Tentativa de agendamento em horário conflitante! Proposto: ${startMoment.toLocaleString()} - Conflito com: "${conflictingEvent.summary}"`);

                // Enviar alerta para o Rodrigo no WhatsApp avisando do conflito e impedindo o agendamento duplo
                const alertMsg = `📢 *Sarah Assistente Virtual*
⚠️ O(A) paciente *${patientName}* tentou agendar para o horário *${startMoment.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}*, mas *este horário já está ocupado* na sua agenda!

📅 *Conflito com:*
- *Evento existente:* "${conflictingEvent.summary}"
- *Ação:* Bloqueei o agendamento duplo automaticamente para manter sua agenda organizada! ❌

Enviei uma mensagem para o paciente solicitando gentilmente que escolha outra opção.`;
                if (whatsappClient) {
                    await whatsappClient.sendMessage(this.getAdminJid(), alertMsg);
                    
                    // Responder ao paciente de forma extremamente educada pedindo para reagendar
                    const displayDate = startMoment.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                    const patientMsg = `Olá *${patientName}*! Peço mil desculpas pelo inconveniente, mas acabei de notar que o horário de *${displayDate} às ${timeStr}* possui um conflito na agenda do Rodrigo.

Poderia escolher outro dia ou horário disponível? Fico no seu aguardo! 🙏😊`;
                    await whatsappClient.sendMessage(contactJid, patientMsg);
                }
                return;
            }

            // Identificar se é Conversa Pastoral ou Psicoterapia com base no histórico recente de mensagens
            const lastChatRes = await this.dbPool.query(
                'SELECT message_text FROM whatsapp_ai_chats WHERE tenant_id = $1::uuid AND contact_jid = $2 AND role = $3 ORDER BY created_at DESC LIMIT 3;',
                [tenantId, contactJid, 'user']
            );
            
            let isPastoral = false;
            if (lastChatRes.rows.length > 0) {
                const combinedUserMessages = lastChatRes.rows.map(r => r.message_text.toLowerCase()).join(' ');
                if (combinedUserMessages.includes('pastoral') || combinedUserMessages.includes('pastor') || combinedUserMessages.includes('aconselhamento')) {
                    isPastoral = true;
                }
            }

            const eventType = isPastoral ? 'Conversa Pastoral' : 'Consulta Psicoterapia';
            const summary = `${eventType}: ${patientName}`;
            const cleanJidNumber = contactJid.replace(/[^0-9]/g, '');
            const description = `Agendamento automático via Sarah (Assistente Virtual).
Paciente: ${patientName}
WhatsApp: +${cleanJidNumber}
Tipo de Atendimento: ${isPastoral ? 'Conversa Pastoral (Gratuito)' : 'Psicoterapia Clínica (Profissional)'}
Data/Hora de Criação: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;

            logger.info(`📅 Criando evento: "${summary}" de ${startTimeIso} até ${endTimeIso}`);
            await calendarClient.createEvent(tenantId, summary, description, startTimeIso, endTimeIso);

            // --- PATIENT PROMOTION TO psychotherapy_patients ---
            try {
                // 1. Buscar dados de sarah_patient_profiles
                const profileRes = await this.dbPool.query(
                    'SELECT full_name, phone, notes, city, modality, referral FROM sarah_patient_profiles WHERE tenant_id = $1::uuid AND contact_jid = $2;',
                    [tenantId, contactJid]
                );
                
                const profile = profileRes.rows[0] || {};
                const finalFullName = profile.full_name || patientName;
                const cleanPhone = profile.phone || contactJid.split('@')[0];
                
                // Formatar anotações extras do prospect
                let extraNotes = profile.notes || '';
                if (profile.city) extraNotes += `\nCidade: ${profile.city}`;
                if (profile.modality) extraNotes += `\nModalidade: ${profile.modality}`;
                if (profile.referral) extraNotes += `\nIndicação: ${profile.referral}`;
                extraNotes = extraNotes.trim();

                // 2. Verificar se já existe um paciente com esse phone
                const existingPatientRes = await this.dbPool.query(
                    'SELECT id, notes FROM psychotherapy_patients WHERE tenant_id = $1::uuid AND phone = $2;',
                    [tenantId, cleanPhone]
                );

                if (existingPatientRes.rows.length > 0) {
                    // Atualizar paciente existente
                    const patientId = existingPatientRes.rows[0].id;
                    const existingNotes = existingPatientRes.rows[0].notes || '';
                    const updatedNotes = existingNotes.includes(extraNotes) ? existingNotes : `${existingNotes}\n\n${extraNotes}`.trim();
                    
                    await this.dbPool.query(
                        `UPDATE psychotherapy_patients 
                         SET full_name = COALESCE($3, full_name), 
                             name = COALESCE($4, name),
                             notes = $5,
                             updated_at = NOW()
                         WHERE id = $1::uuid AND tenant_id = $2::uuid;`,
                        [patientId, tenantId, finalFullName, patientName, updatedNotes]
                    );
                    logger.info(`✅ Paciente atualizado na promoção: ${patientName} (ID: ${patientId})`);
                } else {
                    // Inserir novo paciente
                    const insertRes = await this.dbPool.query(
                        `INSERT INTO psychotherapy_patients 
                         (tenant_id, name, full_name, status, payment_type, phone, notes, created_at, updated_at)
                         VALUES ($1::uuid, $2, $3, 'weekly', 'per_session', $4, $5, NOW(), NOW())
                         RETURNING id;`,
                        [tenantId, patientName, finalFullName, cleanPhone, extraNotes]
                    );
                    logger.info(`✅ Novo paciente inserido via promoção: ${patientName} (ID: ${insertRes.rows[0].id})`);
                }
            } catch (promoErr) {
                logger.error({ promoErr, contactJid, patientName }, 'Erro ao promover contato para psychotherapy_patients');
            }

            // Avisar o Rodrigo no WhatsApp
            const displayDateStr = startMoment.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const notificationMsg = `📢 *Sarah Assistente Virtual*
Olá Rodrigo! 

Temos um novo agendamento realizado com sucesso! 🎉🗓️

📅 *Novo Evento na Agenda:*
- *Paciente:* ${patientName}
- *Horário:* ${displayDateStr} (50 min)
- *Tipo:* ${isPastoral ? 'Conversa Pastoral 🕊️' : 'Psicoterapia Clínica 🧠'}
- *Contato:* +${cleanJidNumber}

O horário foi reservado automaticamente na sua Agenda do Google!`;

            if (whatsappClient) {
                await whatsappClient.sendMessage(this.getAdminJid(), notificationMsg);
            }
            logger.info(`✅ Notificação de novo agendamento enviada com sucesso para Rodrigo (+${this.getAdminNumber()})`);

        } catch (error) {
            logger.error({ error, patientName, contactJid }, 'Erro fatal ao processar agendamento automático de sessão');
        }
    }
}
