const fs = require('fs');
const path = require('path');

function walk(dir, results = []) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            walk(fullPath, results);
        } else {
            if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.json')) {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const files = walk('c:/Users/Rodrigo/.gemini/antigravity/scratch/psicoapp/apps/psychotherapy-web/src');
console.log(`Searching in ${files.length} files...`);

files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    if (content.toLowerCase().includes('bookingpage') || content.toLowerCase().includes('accentcolor')) {
        console.log(`Found in: ${file}`);
    }
});
