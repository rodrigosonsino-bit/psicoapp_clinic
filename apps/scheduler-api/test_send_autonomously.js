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

        // 2. Criar duas mensagens para disparar AGORA (fuso UTC)
        const now = new Date();
        const sendAt = new Date(now.getTime() - 5000).toISOString();
        
        console.log(`\n2. Agendando mensagens para disparar em ${sendAt}...`);
        
        // Mensagem A: Sem o sinal de "+"
        const msgARes = await request(`${API_URL}/messages`, 'POST', {
            content: "[Teste Autônomo - 12 Dígitos Real] Teste de Bypass",
            recipientId: "551896797983",
            sendAt,
            platform: "whatsapp",
            recurrence: "Única"
        }, token);
        console.log("Mensagem A (Sem +) criada status:", msgARes.statusCode);

        // Mensagem B: Com o sinal de "+"
        const msgBRes = await request(`${API_URL}/messages`, 'POST', {
            content: "[Teste Autônomo - 12 Dígitos Real] Teste de Bypass",
            recipientId: "+551896797983",
            sendAt,
            platform: "whatsapp",
            recurrence: "Única"
        }, token);
        console.log("Mensagem B (Com +) criada status:", msgBRes.statusCode);

        const msgAId = msgARes.data.data ? msgARes.data.data.id : null;
        const msgBId = msgBRes.data.data ? msgBRes.data.data.id : null;

        console.log("ID Mensagem A:", msgAId);
        console.log("ID Mensagem B:", msgBId);

        if (!msgAId && !msgBId) {
            console.error("Erro ao criar agendamentos.");
            return;
        }

        // 3. Aguardar 20 segundos para o worker do BullMQ processar
        console.log("\n3. Aguardando 20 segundos para o worker processar o envio...");
        await new Promise(resolve => setTimeout(resolve, 20000));

        // 4. Consultar o status atual das duas mensagens
        console.log("\n4. Consultando status das mensagens criadas...");
        const messagesRes = await request(`${API_URL}/messages`, 'GET', null, token);
        
        if (messagesRes.statusCode === 200 && Array.isArray(messagesRes.data)) {
            const msgA = messagesRes.data.find(m => m.id === msgAId);
            const msgB = messagesRes.data.find(m => m.id === msgBId);
            
            console.log("\n--- RESULTADO MENSAGEM A (Sem +) ---");
            console.log(JSON.stringify(msgA, null, 2));
            
            console.log("\n--- RESULTADO MENSAGEM B (Com +) ---");
            console.log(JSON.stringify(msgB, null, 2));
        } else {
            console.error("Erro ao listar mensagens:", messagesRes.data);
        }

    } catch (err) {
        console.error("Erro fatal:", err.message);
    }
}

run();
