const http = require('http');

const id = '2f1dc2c1-7638-4796-960a-174c20105cf3';
const data = JSON.stringify({
  content: 'EXERCÍCIO: ESPELHO + VERDADE + ACEITAÇÃO (editado para teste)'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/messages/${id}`,
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  },
  timeout: 10000
};

console.log(`Enviando PATCH para /api/messages/${id}...`);
console.log('Payload:', data);

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log(`\nStatus: ${res.statusCode}`);
    console.log('Response:', body);
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error('Erro na requisição:', e.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('TIMEOUT! A requisição ficou travada.');
  req.destroy();
  process.exit(1);
});

req.write(data);
req.end();
