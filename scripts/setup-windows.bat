@echo off
:: ============================================================
::  Delas Gestao - Instalador para Windows
::  Execute com botao direito -> "Executar como administrador"
:: ============================================================
setlocal EnableDelayedExpansion
title Delas Gestao - Instalador

set INSTALL_DIR=C:\Delas
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
echo [1/7] Verificando Node.js...
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
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
) else (
    echo       Node.js encontrado: & node --version
)

:: ── 2. Localizar o Google Drive ───────────────────────────
echo.
echo [2/7] Localizando o Google Drive...
set GDRIVE_PATH=

:: Tentar Google Drive for Desktop (nova versao - letra de unidade G:, H:, etc.)
for %%D in (G H I J K) do (
    if exist "%%D:\My Drive" (
        set GDRIVE_PATH=%%D:\My Drive
        goto :found_drive
    )
    if exist "%%D:\Meu Drive" (
        set GDRIVE_PATH=%%D:\Meu Drive
        goto :found_drive
    )
)

:: Tentar Google Backup and Sync (versao antiga - pasta no perfil)
if exist "%USERPROFILE%\Google Drive" (
    set GDRIVE_PATH=%USERPROFILE%\Google Drive
    goto :found_drive
)
if exist "%USERPROFILE%\Google Drive File Stream\My Drive" (
    set GDRIVE_PATH=%USERPROFILE%\Google Drive File Stream\My Drive
    goto :found_drive
)

:: Tentar via registro do Windows (Google Drive for Desktop)
for /f "tokens=2*" %%a in ('reg query "HKCU\Software\Google\DriveFS" /v "PerAccountPreferences" 2^>nul') do (
    set GDRIVE_REG=%%b
)

:found_drive
if "!GDRIVE_PATH!"=="" (
    echo       Google Drive nao encontrado automaticamente.
    echo.
    echo       Digite o caminho completo da sua pasta do Google Drive:
    echo       Exemplo: G:\Meu Drive   ou   C:\Users\Voce\Google Drive
    echo.
    set /p GDRIVE_PATH="       Caminho: "
)

if "!GDRIVE_PATH!"=="" (
    echo [ERRO] Caminho do Google Drive nao informado.
    pause
    exit /b 1
)

if not exist "!GDRIVE_PATH!" (
    echo [ERRO] Pasta nao encontrada: !GDRIVE_PATH!
    echo       Verifique se o Google Drive esta instalado e sincronizando.
    pause
    exit /b 1
)

set DATA_DIR=!GDRIVE_PATH!\Delas\data
set BACKUP_DIR=!GDRIVE_PATH!\Delas\backups
echo       Google Drive: !GDRIVE_PATH!
echo       Dados serão salvos em: !DATA_DIR!

:: ── 3. Criar diretorio de instalacao ──────────────────────
echo.
echo [3/7] Criando pasta %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
mkdir "!DATA_DIR!" 2>nul
mkdir "!BACKUP_DIR!" 2>nul

:: ── 4. Baixar o sistema do GitHub ─────────────────────────
echo.
echo [4/7] Baixando o sistema...
powershell -NoProfile -Command ^
  "Write-Host '      Conectando ao GitHub...'; ^
   try { ^
     Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TEMP%\delas.zip' -UseBasicParsing; ^
     Write-Host '      Download concluido.' ^
   } catch { ^
     Write-Host '[ERRO] Falha no download: ' + $_.Exception.Message; ^
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

:: Criar .env se nao existir
if not exist "%INSTALL_DIR%\.env" (
    if exist "%INSTALL_DIR%\.env.example" (
        copy "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
    )
)

:: Limpeza
del /q "%TEMP%\delas.zip" >nul 2>&1
rmdir /s /q "%TEMP%\delas-extract" >nul 2>&1

:: ── 5. Criar script de inicializacao ──────────────────────
echo.
echo [5/7] Configurando inicializacao automatica...

(
echo @echo off
echo title Delas Gestao - Servidor
echo cd /d C:\Delas
echo set DATA_DIR=!DATA_DIR!
echo set BACKUP_DIR=!BACKUP_DIR!
echo echo Iniciando Delas Gestao...
echo echo Dados: !DATA_DIR!
echo node server.js
) > "%INSTALL_DIR%\iniciar.bat"

:: Adicionar ao startup do Windows
copy /y "%INSTALL_DIR%\iniciar.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\delas-gestao.bat" >nul
echo       Configurado para iniciar com o Windows.

:: ── 6. Criar atalho na area de trabalho ───────────────────
echo.
echo [6/7] Criando atalho na area de trabalho...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory'); ^
   $s = $ws.CreateShortcut($desktop + '\Delas Gestao.lnk'); ^
   $s.TargetPath = '%INSTALL_DIR%\iniciar.bat'; ^
   $s.WorkingDirectory = '%INSTALL_DIR%'; ^
   $s.Description = 'Delas Gestao - Sistema do escritorio'; ^
   $s.Save()"
echo       Atalho criado na area de trabalho.

:: ── 7. Obter IP local e iniciar ───────────────────────────
echo.
echo [7/7] Iniciando o servidor...

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW_IP=%%a
    goto :got_ip
)
:got_ip
set LOCAL_IP=%RAW_IP: =%

start "Delas Gestao" /min cmd /k "cd /d C:\Delas && set DATA_DIR=!DATA_DIR! && node server.js"
timeout /t 4 /nobreak >nul
start http://localhost:3000

echo.
echo =====================================================
echo   Instalacao concluida com sucesso!
echo =====================================================
echo.
echo   Dados salvos no Google Drive:
echo     !DATA_DIR!
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
echo   IMPORTANTE:
echo   - Troque as senhas no primeiro acesso!
echo   - O banco de dados fica em:
echo     !DATA_DIR!
echo   - O Google Drive sincroniza os dados automaticamente.
echo   - Rode este instalador apenas em UM computador.
echo     Os outros acessam pelo navegador.
echo.
echo =====================================================
pause
