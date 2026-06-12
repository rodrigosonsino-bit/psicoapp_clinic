# update-electron-app.ps1
# Atualiza o bundle do frontend no app Electron instalado localmente.
# Execute após buildar o frontend Expo e fazer deploy no Railway.
#
# Uso: .\update-electron-app.ps1

$ErrorActionPreference = "Stop"

$ASAR_PATH      = "C:\Program Files\WhatsApp Scheduler\resources\app.asar"
$ELEVATE_EXE    = "C:\Program Files\WhatsApp Scheduler\resources\elevate.exe"
$BUNDLE_SRC_DIR = "$PSScriptRoot\apps\scheduler\public\_expo\static\js\web"
$EXTRACT_DIR    = "$env:TEMP\wapp-scheduler-asar-update"
$TEMP_ASAR      = "$env:TEMP\app-new.asar"

# --------------------------------------------------------------------------
# 1. Encontrar o bundle mais recente no repositório
# --------------------------------------------------------------------------
$newBundleFile = Get-ChildItem $BUNDLE_SRC_DIR -Filter "index-*.js" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $newBundleFile) {
    Write-Error "Nenhum bundle encontrado em $BUNDLE_SRC_DIR. Execute 'npx expo export --platform web' primeiro."
    exit 1
}
Write-Host "Novo bundle: $($newBundleFile.Name)" -ForegroundColor Cyan

# --------------------------------------------------------------------------
# 2. Verificar se já está atualizado
# --------------------------------------------------------------------------
$alreadyInstalled = & npx --yes @electron/asar list $ASAR_PATH 2>$null | Select-String $newBundleFile.Name
if ($alreadyInstalled) {
    Write-Host "Bundle já está atualizado no app Electron. Nada a fazer." -ForegroundColor Green
    exit 0
}

# --------------------------------------------------------------------------
# 3. Extrair o ASAR atual
# --------------------------------------------------------------------------
Write-Host "Extraindo app.asar..." -ForegroundColor Yellow
if (Test-Path $EXTRACT_DIR) { Remove-Item $EXTRACT_DIR -Recurse -Force }
& npx @electron/asar extract $ASAR_PATH $EXTRACT_DIR | Out-Null

# Descobrir o bundle antigo
$oldBundleFile = Get-ChildItem "$EXTRACT_DIR\dist\_expo\static\js\web" -Filter "index-*.js" | Select-Object -First 1
if (-not $oldBundleFile) {
    Write-Error "Não encontrei bundle antigo dentro do ASAR."
    exit 1
}
Write-Host "Bundle antigo: $($oldBundleFile.Name)" -ForegroundColor DarkGray

# --------------------------------------------------------------------------
# 4. Substituir o bundle
# --------------------------------------------------------------------------
Copy-Item $newBundleFile.FullName "$EXTRACT_DIR\dist\_expo\static\js\web\$($newBundleFile.Name)"
Remove-Item $oldBundleFile.FullName

# Atualizar index.html
$indexPath = "$EXTRACT_DIR\dist\index.html"
$content = Get-Content $indexPath -Raw
$content = $content -replace [regex]::Escape($oldBundleFile.Name), $newBundleFile.Name
Set-Content $indexPath $content
Write-Host "index.html atualizado." -ForegroundColor Yellow

# --------------------------------------------------------------------------
# 5. Reempacotar para arquivo temporário
# --------------------------------------------------------------------------
Write-Host "Reempacotando ASAR..." -ForegroundColor Yellow
if (Test-Path $TEMP_ASAR) { Remove-Item $TEMP_ASAR -Force }
& npx @electron/asar pack $EXTRACT_DIR $TEMP_ASAR | Out-Null
$newSize = [math]::Round((Get-Item $TEMP_ASAR).Length / 1KB, 1)
Write-Host "Novo ASAR: $newSize KB" -ForegroundColor Yellow

# --------------------------------------------------------------------------
# 6. Instalar com elevação (UAC)
# --------------------------------------------------------------------------
Write-Host "Copiando para Program Files (requer elevação)..." -ForegroundColor Yellow

# Fechar o app se estiver aberto
$proc = Get-Process "WhatsApp Scheduler" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Fechando WhatsApp Scheduler..." -ForegroundColor Yellow
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 2
}

& $ELEVATE_EXE cmd /c "copy /Y `"$TEMP_ASAR`" `"$ASAR_PATH`""
Start-Sleep -Seconds 2

$installedSize = [math]::Round((Get-Item $ASAR_PATH).Length / 1KB, 1)
Write-Host ""
Write-Host "✅ Atualização concluída! ASAR instalado: $installedSize KB" -ForegroundColor Green
Write-Host "   Bundle: $($newBundleFile.Name)" -ForegroundColor Green

# --------------------------------------------------------------------------
# 7. Reabrir o app
# --------------------------------------------------------------------------
$shortcut = "C:\Users\Public\Desktop\WhatsApp Scheduler.lnk"
if (Test-Path $shortcut) {
    Write-Host "Reabrindo WhatsApp Scheduler..." -ForegroundColor Cyan
    Start-Process $shortcut
}
