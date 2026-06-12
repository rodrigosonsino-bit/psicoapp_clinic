const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', '..', '..', 'whatsapp-scheduler-app', 'dist');
const destDir = path.join(__dirname, 'public');

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
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('🧹 Limpando a pasta public do backend...');
if (fs.existsSync(destDir)) {
  deleteFolderRecursive(destDir);
  console.log('✅ Pasta public limpa com sucesso!');
} else {
  console.log('ℹ️ Pasta public não existia, será criada.');
}

console.log('🚀 Copiando novos arquivos do frontend para public...');
if (fs.existsSync(srcDir)) {
  copyFolderRecursive(srcDir, destDir);
  console.log('🎉 Frontend distribuído com sucesso para a pasta public do backend!');
} else {
  console.error('❌ Erro: Pasta de origem dist não encontrada em:', srcDir);
  process.exit(1);
}
