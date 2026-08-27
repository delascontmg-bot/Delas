@echo off
:: ============================================================
::  Delas Gestao - Instalador para Windows
::  Execute com botao direito -> "Executar como administrador"
:: ============================================================
setlocal EnableDelayedExpansion
title Delas Gestao - Instalador

set INSTALL_DIR=C:\Delas
set BRANCH=claude/accounting-management-system-2t6crb
set ZIP_URL=https://github.com/delascontmg-bot/Delas/archive/refs/heads/claude/accounting-management-system-2t6crb.zip
set ZIP_FOLDER=Delas-claude-accounting-management-system-2t6crb

echo.
echo =====================================================
echo   Delas Gestao - Instalador Windows
echo =====================================================
echo.

:: Verificar se esta rodando como Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERRO] Execute este arquivo com botao direito -^>
    echo        "Executar como administrador"
    echo.
    pause
    exit /b 1
)

:: ── 1. Verificar/Instalar Node.js ─────────────────────────
echo [1/6] Verificando Node.js...
node --version >nul 2>&1
if %errorLevel% neq 0 (
    echo       Node.js nao encontrado. Instalando via winget...
    winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    if %errorLevel% neq 0 (
        echo.
        echo [ERRO] Nao foi possivel instalar o Node.js automaticamente.
        echo       Acesse https://nodejs.org e instale a versao 22 LTS manualmente.
        echo       Depois execute este instalador novamente.
        pause
        exit /b 1
    )
    :: Recarregar PATH
    call RefreshEnv.cmd >nul 2>&1
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
) else (
    echo       Node.js encontrado:
    node --version
)

:: ── 2. Criar diretorio de instalacao ──────────────────────
echo.
echo [2/6] Criando pasta %INSTALL_DIR%...
if exist "%INSTALL_DIR%" (
    echo       Pasta ja existe - atualizando arquivos...
) else (
    mkdir "%INSTALL_DIR%"
)

:: ── 3. Baixar o sistema do GitHub ─────────────────────────
echo.
echo [3/6] Baixando o sistema...
powershell -NoProfile -Command ^
  "Write-Host '      Conectando ao GitHub...'; ^
   try { ^
     Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TEMP%\delas.zip' -UseBasicParsing; ^
     Write-Host '      Download concluido.' ^
   } catch { ^
     Write-Host '[ERRO] Falha no download: ' $_.Exception.Message; ^
     exit 1 ^
   }"
if %errorLevel% neq 0 (
    echo.
    echo [ERRO] Nao foi possivel baixar o sistema. Verifique sua conexao com a internet.
    pause
    exit /b 1
)

echo       Extraindo arquivos...
powershell -NoProfile -Command ^
  "Expand-Archive -Path '%TEMP%\delas.zip' -DestinationPath '%TEMP%\delas-extract' -Force"

echo       Copiando para %INSTALL_DIR%...
xcopy /e /i /y "%TEMP%\delas-extract\%ZIP_FOLDER%\*" "%INSTALL_DIR%\" >nul

:: Criar diretorios necessarios
if not exist "%INSTALL_DIR%\data" mkdir "%INSTALL_DIR%\data"
if not exist "%INSTALL_DIR%\backups" mkdir "%INSTALL_DIR%\backups"

:: Criar .env se nao existir
if not exist "%INSTALL_DIR%\.env" (
    if exist "%INSTALL_DIR%\.env.example" (
        copy "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
    )
)

:: Limpeza temporaria
del /q "%TEMP%\delas.zip" >nul 2>&1
rmdir /s /q "%TEMP%\delas-extract" >nul 2>&1

:: ── 4. Criar script de inicializacao ──────────────────────
echo.
echo [4/6] Configurando inicializacao automatica...

(
echo @echo off
echo title Delas Gestao - Servidor
echo cd /d C:\Delas
echo echo Iniciando Delas Gestao...
echo node server.js
) > "%INSTALL_DIR%\iniciar.bat"

:: Adicionar ao startup do Windows (inicia com o login do usuario)
copy /y "%INSTALL_DIR%\iniciar.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\delas-gestao.bat" >nul
echo       Configurado para iniciar com o Windows.

:: ── 5. Criar atalho na area de trabalho ───────────────────
echo.
echo [5/6] Criando atalho na area de trabalho...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory'); ^
   $s = $ws.CreateShortcut($desktop + '\Delas Gestao.lnk'); ^
   $s.TargetPath = '%INSTALL_DIR%\iniciar.bat'; ^
   $s.WorkingDirectory = '%INSTALL_DIR%'; ^
   $s.Description = 'Delas Gestao - Sistema do escritorio'; ^
   $s.Save()"
echo       Atalho criado na area de trabalho.

:: ── 6. Obter IP local e iniciar ───────────────────────────
echo.
echo [6/6] Iniciando o servidor...

:: Pegar IP local da rede
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW_IP=%%a
    goto :got_ip
)
:got_ip
set LOCAL_IP=%RAW_IP: =%

:: Iniciar servidor em segundo plano
start "Delas Gestao" /min cmd /k "cd /d C:\Delas && node server.js"
timeout /t 4 /nobreak >nul

:: Abrir no navegador
start http://localhost:3000

echo.
echo =====================================================
echo   Instalacao concluida com sucesso!
echo =====================================================
echo.
echo   Acesso neste computador:
echo     http://localhost:3000
echo.
echo   Acesso pelos outros computadores da rede:
echo     http://%LOCAL_IP%:3000
echo.
echo   Login inicial:
echo     E-mail: fernanda@delas.com.br
echo     Senha:  mudar123
echo.
echo   IMPORTANTE: Troque as senhas no primeiro acesso!
echo.
echo   O servidor ja esta rodando e abrira no navegador.
echo   Na proxima vez que ligar o computador, o servidor
echo   sobe automaticamente.
echo.
echo =====================================================
pause
