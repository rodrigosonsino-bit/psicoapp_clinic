const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'dist');
const destDir = path.join(__dirname, 'desktop', 'dist');

function deleteFolderRecursive(directoryPath) {
    if (fs.existsSync(directoryPath)) {
        fs.readdirSync(directoryPath).forEach((file) => {
            const curPath = path.join(directoryPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                deleteFolderRecursive(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(directoryPath);
    }
}

function copyFolderRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        console.error(`Erro: Diretório de origem '${src}' não encontrado. Execute 'npx expo export --platform web' primeiro!`);
        process.exit(1);
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((file) => {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        if (fs.lstatSync(srcPath).isDirectory()) {
            copyFolderRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    });
}

console.log('🧹 Limpando diretório desktop/dist antigo...');
deleteFolderRecursive(destDir);

console.log('📦 Copiando build do Expo Web para desktop/dist...');
copyFolderRecursive(srcDir, destDir);

console.log('✅ Preparação para Desktop concluída com sucesso!');
