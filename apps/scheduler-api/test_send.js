const http = require('http');

// Schedule for 1 minute from now
const sendAt = new Date(Date.now() + 60 * 1000).toISOString();

const data = JSON.stringify({
  content: '✅ Teste automático do agendador WhatsApp - ' + new Date().toLocaleTimeString('pt-BR'),
  recipientId: '5518996994225',
  sendAt: sendAt,
  platform: 'whatsapp'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  },
  timeout: 10000
};

console.log(`Agendando mensagem para envio em ~1 minuto...`);
console.log(`sendAt (UTC): ${sendAt}`);
console.log(`Destinatário: 5518996994225`);
console.log('');

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    const parsed = JSON.parse(body);
    console.log('Resposta:', JSON.stringify(parsed, null, 2));
    if (res.statusCode === 201) {
      console.log('\n🎯 Mensagem agendada com sucesso!');
      console.log(`ID: ${parsed.data.id}`);
      console.log('Aguarde ~1 minuto para o envio...');
    }
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('TIMEOUT!');
  req.destroy();
  process.exit(1);
});

req.write(data);
req.end();
