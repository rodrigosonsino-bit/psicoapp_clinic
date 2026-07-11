const http = require('http');

function post(path, data) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(data);
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function run() {
    try {
        const email = `test_user_${Date.now()}@example.com`;
        const password = 'Password123!';

        console.log('1. Registrando inquilino...');
        const regRes = await post('/auth/register', {
            name: 'Test Tenant',
            email,
            password
        });
        console.log('Registro status:', regRes.statusCode, regRes.body);

        if (regRes.statusCode !== 201) {
            throw new Error('Falha no registro');
        }

        console.log('\n2. Fazendo login com credenciais corretas...');
        const loginRes = await post('/auth/login', {
            email,
            password
        });
        console.log('Login status:', loginRes.statusCode, loginRes.body);

        if (loginRes.statusCode !== 200) {
            throw new Error('Falha no login');
        }

        const { accessToken, refreshToken } = loginRes.body;
        console.log('Tokens obtidos com sucesso!');

        console.log('\n3. Testando refresh token...');
        const refreshRes = await post('/auth/refresh', {
            refreshToken
        });
        console.log('Refresh status:', refreshRes.statusCode, refreshRes.body);

        if (refreshRes.statusCode !== 200) {
            throw new Error('Falha no refresh');
        }
        console.log('Flow concluído com sucesso total!');
    } catch (e) {
        console.error('❌ ERRO NO FLUXO:', e.message);
    }
}

run();
