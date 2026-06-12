$ErrorActionPreference = "Stop"

$srcApp = "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\dist-desktop\WhatsApp Scheduler-win32-x64"
$destPkg = "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\dist-package\app"
$zipDest = "C:\Users\Rodrigo\Desktop\WhatsApp-Scheduler-Instalador.zip"
$pkgRoot = "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\dist-package"

# 1. Limpa e copia arquivos do app
Write-Host "[1/3] Copiando arquivos do aplicativo..."
if (Test-Path $destPkg) { Remove-Item $destPkg -Recurse -Force }
Copy-Item $srcApp -Destination $destPkg -Recurse
Write-Host "     Arquivos copiados!"

# Copia o script bat de instalação para a raiz do pacote de distribuição
$batSrc = "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\Instalar-WhatsApp-Scheduler.bat"
Copy-Item $batSrc -Destination "$pkgRoot\Instalar-WhatsApp-Scheduler.bat" -Force
Write-Host "     Script instalador .bat copiado!"

# 2. Remove DevTools do main.js na copia de distribuicao (nao abre debugger)
$mainJsPath = "$destPkg\resources\app\main.js"
if (Test-Path $mainJsPath) {
    $content = Get-Content $mainJsPath -Raw
    $content = $content -replace "mainWindow\.webContents\.openDevTools\(\);", "// DevTools desabilitado para distribuicao"
    Set-Content $mainJsPath $content
    Write-Host "     DevTools desabilitado no build de distribuicao!"
}

# 3. Cria ZIP
Write-Host "[2/3] Criando arquivo ZIP para distribuicao..."
if (Test-Path $zipDest) { Remove-Item $zipDest -Force }
Compress-Archive -Path "$pkgRoot\*" -DestinationPath $zipDest -CompressionLevel Optimal
Write-Host "     ZIP criado!"

# 4. Mostra resultado
$size = (Get-Item $zipDest).Length / 1MB
Write-Host ""
Write-Host "[3/3] Concluido!"
Write-Host "     Arquivo: $zipDest"
Write-Host "     Tamanho: $([math]::Round($size, 1)) MB"
