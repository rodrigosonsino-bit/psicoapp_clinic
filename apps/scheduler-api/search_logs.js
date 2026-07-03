const fs = require('fs');

const content = fs.readFileSync('raw_logs.txt', 'utf8');
const lines = content.split('\n');

for (const line of lines) {
  if (line.includes('SUCESSO na entrega') || line.includes('onWhatsApp') || line.includes('Iniciando processamento')) {
    console.log(line);
  }
}
