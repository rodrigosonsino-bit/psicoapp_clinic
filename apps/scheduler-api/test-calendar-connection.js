const { Pool } = require('pg');
require('dotenv').config();
const { GoogleCalendarClient } = require('./dist/infrastructure/google/GoogleCalendarClient');

const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function runCalendarDiagnostics() {
    console.log('🧪 Iniciando Verificação Diagnóstica do Google Calendar...');
    console.log('==========================================================');

    try {
        // 1. Inicializar Cliente
        const client = new GoogleCalendarClient(dbPool);
        console.log('✅ GoogleCalendarClient inicializado com sucesso.');

        const testUserId = 'test-diagnostic-user-id';

        // 2. Testar URL de Autenticação
        console.log('\n--- 1. Geração de URL de Autenticação ---');
        const authUrl = client.getAuthUrl(testUserId);
        console.log(`URL Gerada:\n${authUrl}`);
        if (authUrl && (authUrl.includes('google/callback') || authUrl.includes('google%2Fcallback'))) {
            console.log('✅ URL de Autenticação gerada com sucesso contendo o callback correto.');
        } else {
            console.log('❌ URL de Autenticação inválida.');
        }

        // 3. Simular Callback (Mock)
        console.log('\n--- 2. Simulação de Processamento do Callback OAuth ---');
        // Extrair o state da URL gerada
        const u = new URL(authUrl);
        const stateToken = u.searchParams.get('state');
        console.log(`Token JWT do State extraído: ${stateToken.substring(0, 30)}...`);

        const mockConfig = await client.handleCallback('mock_code', true, stateToken);
        console.log('✅ Callback processado e configuração criada com sucesso!');
        console.log('Configuração Gerada:', JSON.stringify({
            userId: mockConfig.userId,
            email: mockConfig.email,
            isEnabled: mockConfig.isEnabled,
            calendarId: mockConfig.calendarId,
            calendarName: mockConfig.calendarName
        }, null, 2));

        // 4. Testar Listagem de Calendários
        console.log('\n--- 3. Listagem de Calendários ---');
        const calendars = await client.listCalendars(testUserId);
        console.log(`✅ Recuperada lista com ${calendars.length} agendas.`);
        console.log(JSON.stringify(calendars, null, 2));

        // 5. Testar Seleção de Agenda
        console.log('\n--- 4. Seleção de Agenda Específica ---');
        const selectedCalId = 'personal@example.com';
        const selectedCalName = 'Pessoal';
        await client.selectCalendar(testUserId, selectedCalId, selectedCalName);
        console.log(`✅ Agenda "${selectedCalName}" (${selectedCalId}) selecionada com sucesso.`);

        // Verificar no banco de dados se foi atualizada
        const configInDb = await client.getConfig(testUserId);
        if (configInDb.calendarId === selectedCalId && configInDb.calendarName === selectedCalName) {
            console.log('✅ Preferência de agenda gravada com sucesso no banco de dados!');
        } else {
            console.log('❌ Falha ao verificar preferência no banco de dados.');
        }

        // 6. Testar Busca de Eventos Próximos
        console.log('\n--- 5. Busca de Próximos Eventos com Preferências ---');
        const events = await client.getEventsWithPreferences(testUserId);
        console.log(`✅ Recuperados ${events.length} eventos futuros com sucesso.`);
        console.log(JSON.stringify(events, null, 2));

        // 7. Testar Gravação de Preferência do Evento (Auto Send Toggle)
        console.log('\n--- 6. Configuração de Preferência de Auto-Envio de Evento ---');
        const eventId = 'mock_event_1';
        await client.setEventPreference(testUserId, eventId, false, 'Consulta Dr. Rodrigo - João Silva');
        console.log(`✅ Preferência de auto-envio para o evento "${eventId}" definida como FALSO.`);

        const autoSend = await client.isEventAutoSendEnabled(testUserId, eventId);
        if (autoSend === false) {
            console.log('✅ Validação do banco: Preferência de auto-envio falso gravada com sucesso!');
        } else {
            console.log('❌ Preferência de auto-envio não bateu com a gravação.');
        }

        // Limpeza de dados do teste diagnóstico
        console.log('\n--- 7. Limpeza dos Dados de Teste ---');
        await client.deleteConfig(testUserId);
        await dbPool.query('DELETE FROM google_event_preferences WHERE user_id = $1;', [testUserId]);
        console.log('✅ Dados de teste limpos com sucesso.');

    } catch (error) {
        console.error('❌ Ocorreu um erro durante a execução do diagnóstico:', error);
    } finally {
        await dbPool.end();
        console.log('\n==========================================================');
        console.log('🎉 Diagnóstico concluído!');
    }
}

runCalendarDiagnostics();
