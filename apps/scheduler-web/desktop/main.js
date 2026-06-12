const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

let server;
let mainWindow;

// Servidor estático ultra-leve integrado usando módulos nativos do Node
function startLocalServer() {
    const distPath = path.join(__dirname, 'dist');
    
    server = http.createServer((req, res) => {
        // Remove query parameters de caminhos de arquivos estáticos
        let urlPath = req.url.split('?')[0];
        let filePath = path.join(distPath, urlPath);
        
        // Se for uma pasta, busca o index.html
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
        
        // Suporte para SPA (Single Page Application): redireciona rotas virtuais para o index.html
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            filePath = path.join(distPath, 'index.html');
        }
        
        // Mapeamento de Tipos MIME básicos
        const extname = path.extname(filePath);
        let contentType = 'text/html';
        switch (extname) {
            case '.js': contentType = 'text/javascript'; break;
            case '.css': contentType = 'text/css'; break;
            case '.json': contentType = 'application/json'; break;
            case '.png': contentType = 'image/png'; break;
            case '.jpg': contentType = 'image/jpeg'; break;
            case '.gif': contentType = 'image/gif'; break;
            case '.svg': contentType = 'image/svg+xml'; break;
            case '.ico': contentType = 'image/x-icon'; break;
        }
        
        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Erro no servidor local: ${err.code}`);
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });
    
    server.listen(54321, '127.0.0.1', () => {
        console.log('Servidor estático local desktop rodando na porta 54321');
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1000,
        minHeight: 700,
        title: "WhatsApp Scheduler",
        backgroundColor: '#0F172A',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // Bypass CORS para acessar a API do Railway
            preload: path.join(__dirname, 'preload.js')
        }
    });
    
    mainWindow.loadURL('http://127.0.0.1:54321');
    
    // Abre o console de desenvolvedor automaticamente para diagnósticos rápidos
    mainWindow.webContents.openDevTools();
    
    // Intercepta navegações externas (ex: Stripe checkout) e abre no browser do sistema
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('http://127.0.0.1:54321')) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // Intercepta links com target="_blank"
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('http://127.0.0.1:54321')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    startLocalServer();
    createWindow();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (server) server.close();
        app.quit();
    }
});
