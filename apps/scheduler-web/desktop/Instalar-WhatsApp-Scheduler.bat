@echo off
:: ============================================================
::  Instalador - WhatsApp Scheduler Co-Piloto Sarah
:: ============================================================
setlocal EnableDelayedExpansion
echo.
echo  =====================================================
echo   WhatsApp Scheduler - Instalador
echo  =====================================================
echo.

set "APP_SRC=%~dp0app"
set "INSTALL_DIR=%LOCALAPPDATA%\WhatsApp Scheduler"
set "DESKTOP=%USERPROFILE%\Desktop"
set "EXE_PATH=%INSTALL_DIR%\WhatsApp Scheduler.exe"

echo [1/4] Criando diretorio de instalacao...
if exist "%INSTALL_DIR%" (
    echo     Removendo instalacao anterior...
    rmdir /s /q "%INSTALL_DIR%"
)
mkdir "%INSTALL_DIR%"

echo [2/4] Copiando arquivos do aplicativo...
xcopy /s /e /y /q "%APP_SRC%\*" "%INSTALL_DIR%\"
if %errorlevel% neq 0 (
    echo ERRO: Falha ao copiar arquivos!
    pause
    exit /b 1
)

echo [3/4] Criando atalho na Area de Trabalho...
powershell -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell; ^
   $s = $shell.CreateShortcut('%DESKTOP%\WhatsApp Scheduler.lnk'); ^
   $s.TargetPath = '%EXE_PATH%'; ^
   $s.WorkingDirectory = '%INSTALL_DIR%'; ^
   $s.Description = 'Co-Piloto Sarah - WhatsApp Scheduler'; ^
   $s.Save()"

echo [4/4] Criando atalho no Menu Iniciar...
powershell -ExecutionPolicy Bypass -Command ^
  "$dir = '%APPDATA%\Microsoft\Windows\Start Menu\Programs'; ^
   $shell = New-Object -ComObject WScript.Shell; ^
   $s = $shell.CreateShortcut($dir + '\WhatsApp Scheduler.lnk'); ^
   $s.TargetPath = '%EXE_PATH%'; ^
   $s.WorkingDirectory = '%INSTALL_DIR%'; ^
   $s.Description = 'Co-Piloto Sarah - WhatsApp Scheduler'; ^
   $s.Save()"

echo.
echo  =====================================================
echo   Instalacao concluida com sucesso!
echo   O app foi instalado em:
echo   %INSTALL_DIR%
echo.
echo   Use o atalho na Area de Trabalho para abrir.
echo  =====================================================
echo.
pause
