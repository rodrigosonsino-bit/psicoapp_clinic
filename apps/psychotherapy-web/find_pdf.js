const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Rodrigo\\.gemini\\antigravity\\scratch\\psicoapp\\apps\\psychotherapy-web\\src\\pages\\Receipts.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes('pdf') || line.includes('generate') || line.includes('print')) {
    console.log(`${idx + 1}: ${line}`);
  }
});
