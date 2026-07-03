const http = require('http');

const data = JSON.stringify({
    email: 'rodrigosonsino@gmail.com',
    password: 'wrong_password_or_whatever'
});

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', res.headers);
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('BODY:', body);
    });
});

req.on('error', (e) => {
    console.error('Problem with request:', e.message);
});

req.write(data);
req.end();
