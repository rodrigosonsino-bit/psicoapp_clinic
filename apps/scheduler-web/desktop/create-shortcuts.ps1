$installDir = "$env:LOCALAPPDATA\WhatsApp Scheduler"
$exePath = "$installDir\WhatsApp Scheduler.exe"
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"

# Remove atalhos antigos
Remove-Item "$desktop\WhatsApp Scheduler.lnk" -ErrorAction SilentlyContinue
Remove-Item "$desktop\WhatsApp Scheduler.exe" -ErrorAction SilentlyContinue

# Cria atalho na Area de Trabalho
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$desktop\WhatsApp Scheduler.lnk")
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = "Co-Piloto Sarah - WhatsApp Scheduler"
$shortcut.Save()
Write-Host "Atalho criado na Area de Trabalho: $desktop\WhatsApp Scheduler.lnk"

# Cria atalho no Menu Iniciar
$shortcut2 = $shell.CreateShortcut("$startMenu\WhatsApp Scheduler.lnk")
$shortcut2.TargetPath = $exePath
$shortcut2.WorkingDirectory = $installDir
$shortcut2.Description = "Co-Piloto Sarah - WhatsApp Scheduler"
$shortcut2.Save()
Write-Host "Atalho criado no Menu Iniciar: $startMenu\WhatsApp Scheduler.lnk"

Write-Host ""
Write-Host "Instalacao finalizada! App em: $installDir"
Write-Host "Abrindo o app..."

# Abre o app
Start-Process $exePath
