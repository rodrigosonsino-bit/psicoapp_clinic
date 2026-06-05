const http = require('https');
const data = JSON.stringify({ email: 'teste@teste.com', password: '123' });
const options = {
  hostname: 'whatsapp-scheduler-backend-production-14af.up.railway.app',
  port: 443,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};
const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', body));
});
req.on('error', (e) => console.error(e));
req.write(data);
req.end();
