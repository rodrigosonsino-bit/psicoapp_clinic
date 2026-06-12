const http = require('http');

const data = JSON.stringify({
  content: "Test recurrence",
  recipientId: "+5518999999999",
  sendAt: "2026-05-30T10:00:00.000Z",
  platform: "whatsapp",
  recurrence: "Semanalmente"
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/messages',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'x-user-id': 'default_user_123'
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log("Create response:", body);
  });
});

req.write(data);
req.end();
