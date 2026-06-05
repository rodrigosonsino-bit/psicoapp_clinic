const { Pool } = require('pg');

// 1. Repositório e Caso de Uso simulados/compilados
// Como o código TypeScript foi compilado na pasta dist/, podemos carregar as classes reais em Javascript!
const { PostgresMessageRepository } = require('./dist/infrastructure/repositories/PostgresMessageRepository');
const { WeeklyReportUseCase } = require('./dist/application/useCases/WeeklyReportUseCase');

const dbPool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'whatsapp_scheduler',
  password: 'secretpassword',
  port: 5432
});

async function run() {
  console.log('🧪 Iniciando Simulação do Relatório Semanal do WhatsApp...');
  try {
    const messageRepository = new PostgresMessageRepository(dbPool);
    const weeklyReportUseCase = new WeeklyReportUseCase(messageRepository);

    const userId = 'default-user-id';
    
    // Buscar estatísticas reais do período
    console.log('📊 Consolidando estatísticas reais usando o caso de uso...');
    const stats = await weeklyReportUseCase.execute(userId);

    console.log('📈 Estatísticas Consolidadas com Sucesso:');
    console.log(`- Total: ${stats.total}`);
    console.log(`- Enviadas: ${stats.sent}`);
    console.log(`- Falhas: ${stats.failed}`);
    console.log(`- Pendentes: ${stats.pending}`);
    console.log(`- Taxa de Sucesso: ${stats.successRate}%`);

    // Lógica exata de formatação da mensagem do WeeklyReportCronJob
    const platformText = stats.platformStats.length > 0
        ? stats.platformStats.map(p => `  • ${p.platform}: ${p.count} ${p.count === 1 ? 'envio' : 'envios'}`).join('\n')
        : '  • Nenhuma mensagem enviada';

    const messageText = `📊 *Relatório Semanal do Co-Piloto Sarah* 📊\n\n` +
        `Olá Rodrigo! Aqui está o resumo das suas mensagens agendadas dos últimos 7 dias:\n\n` +
        `📈 *Desempenho Geral:*\n` +
        `  • 📅 Total Processado: ${stats.total} mensagens\n` +
        `  • ✅ Enviadas com Sucesso: ${stats.sent}\n` +
        `  • ❌ Falhas no Envio: ${stats.failed}\n` +
        `  • ⏳ Pendentes/Agendadas: ${stats.pending}\n` +
        `  • 🚀 Taxa de Entrega: ${stats.successRate}%\n\n` +
        `📱 *Por Canal de Envio:*\n${platformText}\n\n` +
        `Excelente trabalho! Desejo a você uma semana extraordinária e altamente produtiva! 🦾✨`;

    console.log('\n💬 --- MENSAGEM DO WHATSAPP FORMATADA COM SUCESSO --- 💬\n');
    console.log(messageText);
    console.log('\n-----------------------------------------------------\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro durante a simulação:', error);
    process.exit(1);
  }
}

run();
