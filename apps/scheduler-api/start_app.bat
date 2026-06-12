@echo off
title WhatsApp Scheduler
color 0A

echo.
echo  ============================================
echo     WhatsApp Scheduler - Iniciando Servicos
echo  ============================================
echo.

REM 1. Parar container antigo e liberar porta 3000 se estiver em uso
echo [1/5] Preparando ambiente...
docker stop whatsapp_api 1>NUL 2>NUL
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 1>NUL 2>NUL
)
echo       Ambiente limpo!
echo.

REM 2. Verificar Docker
echo [2/5] Verificando Docker Desktop...
docker info 1>NUL 2>NUL
if %ERRORLEVEL% NEQ 0 (
    echo       Docker nao encontrado. Tentando iniciar...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo       Aguardando Docker iniciar...
    :WAIT_DOCKER
    ping 127.0.0.1 -n 6 1>NUL 2>NUL
    docker info 1>NUL 2>NUL
    if %ERRORLEVEL% NEQ 0 goto WAIT_DOCKER
    echo       Docker iniciado!
) else (
    echo       Docker ja esta rodando!
)
echo.

REM 3. Subir PostgreSQL e Redis
echo [3/5] Iniciando PostgreSQL e Redis...
cd /d "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-backend"
docker-compose up -d db redis
ping 127.0.0.1 -n 9 1>NUL 2>NUL
echo       Banco e Redis prontos!
echo.

REM 4. Abrir navegador em 5 segundos (tempo do backend subir)
echo [4/5] Navegador abrira em 5 segundos...
start "" cmd /c "ping 127.0.0.1 -n 6 1>NUL 2>NUL && start http://localhost:3000"
echo.

REM 5. Iniciar Backend
echo [5/5] Iniciando Backend...
echo.
echo  ============================================
echo    App rodando em: http://localhost:3000
echo    Feche esta janela para encerrar
echo  ============================================
echo.
call npx ts-node src/server.ts

pause
