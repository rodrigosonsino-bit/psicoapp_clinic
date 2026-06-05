const https = require('https');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY || 'AIzaSyB9tLu5RWAHzLxjTCCZgIBcNtNtP6eEq3I';
const modelName = 'gemini-2.0-flash';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

async function testKey() {
    console.log(`Testando chave: ${apiKey.substring(0, 15)}...`);
    const prompt = "Diga olá em português de forma simpática!";
    const payload = JSON.stringify({
        contents: [{
            parts: [{
                text: prompt
            }]
        }]
    });

    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = {
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                console.log(`Status de resposta: ${res.statusCode}`);
                try {
                    const parsed = JSON.parse(body);
                    console.log("Resposta da API:\n", JSON.stringify(parsed, null, 2));
                } catch (e) {
                    console.log("Resposta bruta:\n", body);
                }
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error("Erro na requisição:", e);
            reject(e);
        });

        req.write(payload);
        req.end();
    });
}

testKey();
