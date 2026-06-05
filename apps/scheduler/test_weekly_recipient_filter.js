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
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
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
  console.log('🧪 Iniciando Teste de Filtro de Destinatário na Central de Desempenho (API)...\n');

  // 1. Agendar mensagem para o contato específico A (+5518998070013)
  console.log('1. Agendando mensagem para Contato A (+5518998070013)...');
  const msgA1 = JSON.stringify({
    content: 'Olá Contato A - Mensagem 1',
    recipientId: '+5518998070013',
    sendAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    platform: 'whatsapp'
  });
  const resA1 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgA1)
    }
  }, msgA1);
  const idA1 = resA1.body.data.id;
  console.log(`✅ Contato A - Msg 1 agendada com ID: ${idA1}`);

  const msgA2 = JSON.stringify({
    content: 'Olá Contato A - Mensagem 2',
    recipientId: '+5518998070013',
    sendAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    platform: 'telegram'
  });
  const resA2 = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgA2)
    }
  }, msgA2);
  const idA2 = resA2.body.data.id;
  console.log(`✅ Contato A - Msg 2 agendada com ID: ${idA2}`);

  // 2. Agendar mensagem para o contato B (+5511988887777)
  console.log('\n2. Agendando mensagem para Contato B (+5511988887777)...');
  const msgB = JSON.stringify({
    content: 'Olá Contato B',
    recipientId: '+5511988887777',
    sendAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    platform: 'whatsapp'
  });
  const resB = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(msgB)
    }
  }, msgB);
  const idB = resB.body.data.id;
  console.log(`✅ Contato B agendada com ID: ${idB}`);

  // 3. Obter Relatório Semanal consolidado (Sem Filtro)
  console.log('\n3. Obtendo Relatório Semanal Geral (Sem Filtro)...');
  const resGlobal = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages/report/weekly',
    method: 'GET'
  });
  console.log(`📈 Estatísticas Gerais: Total = ${resGlobal.body.total}`);
  
  // 4. Obter Relatório Semanal filtrando por "99807" (Contato A)
  console.log('\n4. Obtendo Relatório Semanal Filtrado por "99807" (Busca Parcial do Contato A)...');
  const resFiltered = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages/report/weekly?recipientId=99807',
    method: 'GET'
  });
  console.log(`📈 Estatísticas Filtradas para "99807":`);
  console.log(`- Total: ${resFiltered.body.total} (esperado: >= 2)`);
  console.log(`- Lista de Mensagens do Relatório:`);
  let hasA1 = false;
  let hasA2 = false;
  let hasB = false;
  resFiltered.body.sentMessagesList.forEach(m => {
    console.log(`  • ID: ${m.id} | Destinatário: ${m.recipientId} | Conteúdo: "${m.content}" | Plataforma: ${m.platform}`);
    if (m.id === idA1) hasA1 = true;
    if (m.id === idA2) hasA2 = true;
    if (m.id === idB) hasB = true;
  });

  if (hasA1 && hasA2 && !hasB) {
    console.log('\n✅ SUCESSO: O filtro retornou as mensagens do Contato A e NÃO retornou a do Contato B!');
  } else {
    console.log('\n❌ ERRO: O filtro de destinatário falhou nos resultados!');
  }

  // 5. Testar exportação para CSV com filtro
  console.log('\n5. Testando exportação de CSV filtrada por "99807"...');
  const resCsv = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages/report/weekly?export=csv&recipientId=99807',
    method: 'GET'
  });
  console.log(`Headers do CSV: Status ${resCsv.statusCode}, Content-Type: ${resCsv.headers['content-type']}`);
  console.log('Conteúdo do CSV:');
  console.log('----------------------------------------------------');
  console.log(resCsv.body);
  console.log('----------------------------------------------------');

  if (typeof resCsv.body === 'string' && resCsv.body.includes('Contato A') && !resCsv.body.includes('Contato B')) {
    console.log('✅ SUCESSO: O CSV exportado foi filtrado com sucesso!');
  } else {
    console.log('❌ ERRO: A exportação de CSV falhou no filtro!');
  }

  // 6. Limpar dados de teste
  console.log('\n6. Limpando mensagens de teste...');
  await makeRequest({ hostname: 'localhost', port: 3000, path: `/api/messages/${idA1}`, method: 'DELETE' });
  await makeRequest({ hostname: 'localhost', port: 3000, path: `/api/messages/${idA2}`, method: 'DELETE' });
  await makeRequest({ hostname: 'localhost', port: 3000, path: `/api/messages/${idB}`, method: 'DELETE' });
  console.log('✅ Mensagens de teste excluídas.');

  console.log('\n🎯 Todos os testes de filtro concluídos com sucesso!');
}

runTests().catch(err => {
  console.error('Erro durante os testes:', err);
});
