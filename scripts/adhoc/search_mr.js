const fs = require('fs');
const path = require('path');

function search(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'dist') {
        search(fullPath);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('new PsychotherapyMonthlyRecord')) {
        console.log(`Found in: ${fullPath}`);
      }
    }
  }
}

search('c:\\Users\\Rodrigo\\.gemini\\antigravity\\scratch\\psicoapp');
