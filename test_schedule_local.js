const http = require('http');

const data = JSON.stringify({
    recipientJid: '5518996153762',
    text: 'Teste automatizado Antigravity ' + new Date().toISOString(),
    scheduledAt: new Date(Date.now() + 60000).toISOString() // 1 minuto no futuro
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/messages',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => {
        responseBody += chunk;
    });
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Body: ${responseBody}`);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
