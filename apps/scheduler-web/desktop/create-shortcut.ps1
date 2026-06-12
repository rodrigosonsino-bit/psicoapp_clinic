$exePath = 'c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\dist-desktop\WhatsApp Scheduler-win32-x64\WhatsApp Scheduler.exe'
$workDir = 'c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-app\desktop\dist-desktop\WhatsApp Scheduler-win32-x64'
$shortcutPath = 'C:\Users\Rodrigo\Desktop\WhatsApp Scheduler.lnk'

# Remove arquivo antigo se existir
if (Test-Path 'C:\Users\Rodrigo\Desktop\WhatsApp Scheduler.exe') {
    Remove-Item 'C:\Users\Rodrigo\Desktop\WhatsApp Scheduler.exe' -Force
}

# Cria atalho correto
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $workDir
$shortcut.Description = 'WhatsApp Scheduler - Co-Piloto Sarah'
$shortcut.Save()
Write-Host "Atalho criado em: $shortcutPath"
