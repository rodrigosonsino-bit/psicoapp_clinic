const https = require('https');

const API_URL = 'https://whatsapp-scheduler-backend-production-14af.up.railway.app/api';

function request(url, method, data = null, token = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const headers = {
            'Content-Type': 'application/json'
        };
        let payload = '';
        if (data) {
            payload = JSON.stringify(data);
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const options = {
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: method,
            headers
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(payload);
        }
        req.end();
    });
}

async function run() {
    try {
        console.log("1. Efetuando login na produção...");
        const loginRes = await request(`${API_URL}/auth/login`, 'POST', {
            email: 'rodrigosonsino@gmail.com',
            password: '142536'
        });
        
        if (loginRes.statusCode !== 200) {
            console.error("Erro no login:", loginRes.data);
            return;
        }
        
        const token = loginRes.data.token;
        console.log("Token JWT obtido!");

        console.log("\n2. Executando GET /whatsapp/diagnostics na API da Railway...");
        const diagRes = await request(`${API_URL}/whatsapp/diagnostics`, 'GET', null, token);
        console.log("Status Code do Diagnóstico:", diagRes.statusCode);
        console.log("Resultado do Diagnóstico:");
        console.log(JSON.stringify(diagRes.data, null, 2));
        
    } catch (err) {
        console.error("Erro fatal:", err.message);
    }
}

run();
