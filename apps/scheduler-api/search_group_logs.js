const fs = require('fs');

const content = fs.readFileSync('raw_logs.txt', 'utf8');
const lines = content.split('\n');

for (const line of lines) {
  if (line.includes('12036323858170894')) {
    console.log(line);
  }
}
