const { app, BrowserWindow, shell, session, ipcMain, safeStorage } = require('electron');
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
                res.writeHead(200, { 
                    'Content-Type': contentType,
                    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(content, 'utf-8');
            }
        });
    });
    
    // Se a porta 54321 já estiver ocupada (ex.: outra instalação do app aberta), encerra
    // esta instância de forma limpa em vez de derrubar o processo com uma exceção não tratada.
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error('Porta 54321 já está em uso (outra instância do app está aberta). Encerrando.');
            app.quit();
        } else {
            console.error('Erro no servidor local:', err);
        }
    });

    server.listen(54321, '127.0.0.1', () => {
        console.log('Servidor estático local desktop rodando na porta 54321');
    });
}

function validateSender(event) {
    if (!event.senderFrame) {
        throw new Error('No sender frame');
    }
    const origin = event.senderFrame.origin;
    if (origin !== 'http://127.0.0.1:54321') {
        throw new Error('Unauthorized IPC sender');
    }
}

ipcMain.handle('secure-store-token', async (event, key, value) => {
    validateSender(event);
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this platform');
    }
    const encrypted = safeStorage.encryptString(value);
    const filePath = path.join(app.getPath('userData'), `${key}.enc`);
    await fs.promises.writeFile(filePath, encrypted);
    return true;
});

ipcMain.handle('secure-get-token', async (event, key) => {
    validateSender(event);
    const filePath = path.join(app.getPath('userData'), `${key}.enc`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const encrypted = await fs.promises.readFile(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this platform');
    }
    return safeStorage.decryptString(encrypted);
});

ipcMain.handle('secure-delete-token', async (event, key) => {
    validateSender(event);
    const filePath = path.join(app.getPath('userData'), `${key}.enc`);
    if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
    }
    return true;
});

function createWindow() {
    const isDev = process.env.NODE_ENV === 'development';
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
            preload: path.join(__dirname, 'preload.js'),
            devTools: isDev
        }
    });
    
    mainWindow.loadURL('http://127.0.0.1:54321');
    
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    
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

// Instância única: o servidor local usa a porta fixa 54321, que só pode ser aberta por
// uma instância. Sem este lock, abrir o app uma segunda vez (ou enquanto uma instância
// antiga ainda não fechou) causa EADDRINUSE e derruba o processo main com o erro
// "A JavaScript error occurred in the main process". Aqui, a segunda instância apenas
// traz a janela existente para frente e encerra.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        try {
            await session.defaultSession.clearStorageData({
                storages: ['serviceworkers', 'cachestorage']
            });
            await session.defaultSession.clearCache();
        } catch (e) {
            console.error('Erro ao limpar cache:', e);
        }
        startLocalServer();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (server) server.close();
        app.quit();
    }
});
