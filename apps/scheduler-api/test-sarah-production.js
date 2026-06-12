const https = require('https');

function post(url, data, token = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = JSON.stringify(data);
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const options = {
            hostname: u.hostname,
            port: 443,
            path: u.pathname,
            method: 'POST',
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
        req.write(payload);
        req.end();
    });
}

const API_URL = 'https://whatsapp-scheduler-backend-production-14af.up.railway.app/api';

async function login() {
    console.log("Efetuando login para obter um token JWT atualizado...");
    const loginRes = await post(`${API_URL}/auth/login`, {
        email: 'rodrigosonsino@gmail.com',
        password: '142536'
    });
    if (loginRes.statusCode === 200) {
        return loginRes.data.token;
    }
    throw new Error(`Falha no login: ${JSON.stringify(loginRes.data)}`);
}

async function verifySarah() {
    try {
        let token = await login();
        console.log("✅ Token JWT obtido!");

        console.log("\nMonitorando deploy do Gemini na Railway...");
        let attempts = 0;
        let success = false;
        
        while (!success && attempts < 40) {
            attempts++;
            console.log(`[Tentativa ${attempts}] Chamando a Sarah...`);
            try {
                const response = await post(`${API_URL}/ai/secretary`, {
                    prompt: "Quero agendar uma conversa espiritual para amanhã às 14h com o Sayonicos"
                }, token);
                
                console.log("Status da resposta:", response.statusCode);
                
                if (response.statusCode === 200) {
                    const data = response.data;
                    console.log("\nResposta da Sarah:");
                    console.log(JSON.stringify(data, null, 2));
                    
                    if (data.explanation && !data.explanation.includes('[MOCK SECRETÁRIA]')) {
                        console.log("\n🎉 PARABÉNS! O Gemini foi conectado e está 100% ativo e respondendo em tempo real na nuvem!");
                        success = true;
                        break;
                    } else {
                        console.log("Sarah ainda está respondendo em modo Simulação (Mock). Aguardando deploy...");
                    }
                } else if (response.statusCode === 401) {
                    console.log("⚠️ Token inválido ou expirado (provavelmente devido ao restart). Solicitando novo token...");
                    token = await login();
                } else {
                    console.log("Erro ao chamar endpoint. Aguardando 15s...");
                }
            } catch (e) {
                console.log("Erro na rede ou conexão instável:", e.message);
            }
            await new Promise(resolve => setTimeout(resolve, 15000));
        }
    } catch (e) {
        console.error("Erro na verificação:", e);
    }
}

verifySarah();
