@echo off
title Odin CRM
color 0E
chcp 65001 >nul

echo.
echo  =========================================
echo    ODIN CRM - Tubos e Conexoes PPR Azul
echo  =========================================
echo.

cd /d "%~dp0"

:: ── 1. Verificar Node.js ───────────────────────────────────────────────────
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERRO: Node.js nao esta instalado!
    echo  Baixe em: https://nodejs.org  (versao LTS)
    echo  Depois execute este arquivo novamente.
    echo.
    pause
    exit /b 1
)

:: ── 2. Instalar dependencias se necessario ─────────────────────────────────
if not exist "node_modules" (
    echo [1/4] Instalando dependencias (primeira vez, pode demorar)...
    call npm install
    if %errorlevel% neq 0 (
        echo  ERRO ao instalar dependencias.
        pause
        exit /b 1
    )
    echo  Dependencias instaladas.
    echo.
) else (
    echo [1/4] Dependencias OK.
)

:: ── 3. Criar .env se nao existir ──────────────────────────────────────────
if not exist "server\.env" (
    echo [2/4] Criando arquivo de configuracao...
    copy "server\.env.example" "server\.env" >nul
    echo  Configuracao criada.
) else (
    echo [2/4] Configuracao OK.
)

:: ── 4. Setup do banco (apenas na primeira vez) ────────────────────────────
echo.
if not exist "server\odin_crm.db" (
    echo [3/4] Primeira execucao - criando banco e dados iniciais...
    echo.
    call npm run db:generate
    call npm run db:migrate
    call npm run db:seed
    echo.
    echo  Setup concluido!
    echo  Credenciais:
    echo    admin  / admin123
    echo    carlos / Odin@2024
    echo    ana    / Odin@2024
    echo    pedro  / Odin@2024
    echo.
) else (
    echo [3/4] Banco de dados OK.
)

:: ── 5. Iniciar servidores ─────────────────────────────────────────────────
echo.
echo [4/4] Iniciando servidores...

start "Odin CRM - Backend (porta 3001)" cmd /k "cd /d "%~dp0" && color 0B && npm run dev -w server"
timeout /t 3 /nobreak >nul
start "Odin CRM - Frontend (porta 5173)" cmd /k "cd /d "%~dp0" && color 0A && npm run dev -w client"

timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo  =========================================
echo  Backend:   http://localhost:3001
echo  Frontend:  http://localhost:5173
echo.
echo  Duas janelas abertas (azul = servidor, verde = frontend)
echo  Para encerrar, feche as duas janelas.
echo  =========================================
echo.
pause
