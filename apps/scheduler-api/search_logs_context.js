const fs = require('fs');

const content = fs.readFileSync('raw_logs.txt', 'utf8');
const lines = content.split('\r\n'); // split by crlf or lf
const cleanLines = lines.flatMap(l => l.split('\n'));

cleanLines.forEach((line, index) => {
  if (line.includes('SUCESSO na entrega')) {
    console.log('--- MATCH ---');
    for (let i = Math.max(0, index - 5); i <= Math.min(cleanLines.length - 1, index + 5); i++) {
      console.log(`${i}: ${cleanLines[i]}`);
    }
  }
});
