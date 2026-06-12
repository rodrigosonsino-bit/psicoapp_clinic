@echo off
title WhatsApp Scheduler - Encerrando...
color 0C
echo.
echo  ============================================
echo     WhatsApp Scheduler - Encerrando Servicos
echo  ============================================
echo.

cd /d "c:\Users\Rodrigo\.gemini\antigravity\scratch\whatsapp-scheduler-backend"

echo Parando containers Docker (PostgreSQL + Redis)...
docker-compose down
echo.
echo Todos os servicos foram encerrados!
echo.
timeout /t 3 /nobreak >nul
