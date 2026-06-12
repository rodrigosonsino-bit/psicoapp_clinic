const http = require('http');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: body
          });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Iniciando os testes dos filtros de data na API...\n');

  const todayDateStr = new Date().toISOString().split('T')[0];
  
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const threeDaysDateStr = threeDaysFromNow.toISOString().split('T')[0];

  console.log(`Data de Hoje: ${todayDateStr}`);
  console.log(`Data daqui a 3 dias: ${threeDaysDateStr}\n`);

  // 1. Criar agendamento para hoje
  console.log('1. Agendando mensagem para hoje...');
  const msgToday = JSON.stringify({
    content: 'Mensagem de Teste: Filtro Hoje',
    recipientId: '5518997067933',
    sendAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    platform: 'whatsapp'
  });
  
  const resToday = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgToday)
    }
  }, msgToday);
  
  console.log(`Resposta: Status ${resToday.statusCode}`, resToday.body.message || resToday.body);

  // 2. Criar agendamento para daqui a 3 dias
  console.log('\n2. Agendando mensagem para daqui a 3 dias...');
  const msgThreeDays = JSON.stringify({
    content: 'Mensagem de Teste: Filtro 3 Dias',
    recipientId: '5518997067933',
    sendAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString(),
    platform: 'whatsapp'
  });

  const resThreeDays = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgThreeDays)
    }
  }, msgThreeDays);

  console.log(`Resposta: Status ${resThreeDays.statusCode}`, resThreeDays.body.message || resThreeDays.body);

  // 3. Buscar agendamentos sem filtro
  console.log('\n3. Buscando agendamentos sem filtro (esperando lista paginada)...');
  const resAll = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'GET'
  });
  console.log(`Total encontrado sem filtros: ${Array.isArray(resAll.body) ? resAll.body.length : 0}`);

  // 4. Buscar agendamentos filtrando especificamente por HOJE
  console.log(`\n4. Buscando agendamentos apenas para HOJE (${todayDateStr})...`);
  const resFilterToday = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/messages?date=${todayDateStr}`,
    method: 'GET'
  });
  
  if (Array.isArray(resFilterToday.body)) {
    console.log(`Encontrados para hoje: ${resFilterToday.body.length}`);
    resFilterToday.body.forEach(m => {
      console.log(`- ID: ${m.id} | SendAt: ${m.sendAt} | Content: "${m.content}"`);
    });
  } else {
    console.error('Erro na resposta:', resFilterToday.body);
  }

  // 5. Buscar agendamentos filtrando especificamente por DAQUI A 3 DIAS
  console.log(`\n5. Buscando agendamentos apenas para DAQUI A 3 DIAS (${threeDaysDateStr})...`);
  const resFilterThreeDays = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/messages?date=${threeDaysDateStr}`,
    method: 'GET'
  });

  if (Array.isArray(resFilterThreeDays.body)) {
    console.log(`Encontrados para daqui a 3 dias: ${resFilterThreeDays.body.length}`);
    resFilterThreeDays.body.forEach(m => {
      console.log(`- ID: ${m.id} | SendAt: ${m.sendAt} | Content: "${m.content}"`);
    });
  } else {
    console.error('Erro na resposta:', resFilterThreeDays.body);
  }

  // 6. Buscar agendamentos com intervalo startDate e endDate
  console.log(`\n6. Buscando intervalo de HOJE (${todayDateStr}) até DAQUI A 3 DIAS (${threeDaysDateStr})...`);
  const resRange = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/messages?startDate=${todayDateStr}&endDate=${threeDaysDateStr}`,
    method: 'GET'
  });

  if (Array.isArray(resRange.body)) {
    console.log(`Encontrados no intervalo: ${resRange.body.length}`);
    resRange.body.forEach(m => {
      console.log(`- ID: ${m.id} | SendAt: ${m.sendAt} | Content: "${m.content}"`);
    });
  } else {
    console.error('Erro na resposta:', resRange.body);
  }

  // 7. Testar validação de erro (data inválida)
  console.log('\n7. Testando tratamento de formato de data inválido...');
  const resError = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages?date=2026-invalido-99',
    method: 'GET'
  });
  console.log(`Status de Erro esperado (400): ${resError.statusCode}`);
  console.log('Resposta de Erro:', resError.body);

  console.log('\n🎯 Todos os testes de verificação concluídos!');
}

runTests().catch(err => {
  console.error('Erro geral durante os testes:', err);
});
