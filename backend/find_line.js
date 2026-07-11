const fs = require('fs');
const filepath = 'c:/Users/Rodrigo/.gemini/antigravity/scratch/psicoapp/apps/psychotherapy-api/railway_logs.txt';
const buf = fs.readFileSync(filepath);
const content = buf.toString('utf16le');
const lines = content.split('\n');

console.log('Searching for WhatsApp in logs...');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('whatsapp') || line.toLowerCase().includes('connect') || line.toLowerCase().includes('session')) {
    console.log(`Line ${idx + 1}: ${line}`);
  }
});
