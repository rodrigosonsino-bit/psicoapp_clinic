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
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.toLowerCase().includes('pdf') && (content.includes('receipt') || content.includes('recibo'))) {
        console.log(`Found PDF code in: ${fullPath}`);
      }
    }
  }
}

search('c:\\Users\\Rodrigo\\.gemini\\antigravity\\scratch\\psicoapp');
