const fs = require('fs');
const path = require('path');

function searchDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
        searchDir(fullPath, query);
      }
    } else {
      if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.json')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.toLowerCase().includes(query.toLowerCase())) {
          console.log(`Found "${query}" in: ${fullPath}`);
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              console.log(`  Line ${i+1}: ${lines[i].trim()}`);
            }
          }
        }
      }
    }
  }
}

const root = 'C:\\Users\\Rodrigo\\.gemini\\antigravity\\scratch\\psicoapp';
searchDir(root, 'Clinica Teste');
searchDir(root, 'Paciente Teste');
console.log("Search completed.");
