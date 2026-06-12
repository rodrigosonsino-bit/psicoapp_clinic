const fs = require('fs');
const path = require('path');
const jsDir = 'dist/_expo/static/js/web/';
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const js = fs.readFileSync(path.join(jsDir, files[0]), 'utf8');
const hasRailway = js.includes('railway.app');
const hasLocalhost3000 = js.includes('localhost:3000');
console.log('Has Railway URL:', hasRailway);
console.log('Has localhost:3000:', hasLocalhost3000);
if (hasRailway) {
    const idx = js.indexOf('railway.app');
    console.log('Context:', js.substring(idx - 150, idx + 100));
}
