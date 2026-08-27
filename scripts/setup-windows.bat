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
set NGROK_TOKEN=3IVEtb3zgwuYqr3z8mFWsMgmQpM_4oFJEigj4SBHL7yBS2nfH
set NGROK_DOMAIN=easiest-saline-raving.ngrok-free.dev
set NGROK_URL=https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip

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
echo [1/8] Verificando Node.js...
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
echo [2/8] Localizando o Google Drive...
set GDRIVE_PATH=

for %%D in (G H I J K) do (
    if exist "%%D:\My Drive" ( set GDRIVE_PATH=%%D:\My Drive & goto :found_drive )
    if exist "%%D:\Meu Drive" ( set GDRIVE_PATH=%%D:\Meu Drive & goto :found_drive )
)
if exist "%USERPROFILE%\Google Drive" ( set GDRIVE_PATH=%USERPROFILE%\Google Drive & goto :found_drive )
if exist "%USERPROFILE%\Google Drive File Stream\My Drive" ( set GDRIVE_PATH=%USERPROFILE%\Google Drive File Stream\My Drive & goto :found_drive )

:found_drive
if "!GDRIVE_PATH!"=="" (
    echo       Google Drive nao encontrado automaticamente.
    echo.
    echo       Digite o caminho completo da sua pasta do Google Drive:
    echo       Exemplo: G:\Meu Drive   ou   C:\Users\Voce\Google Drive
    echo.
    set /p GDRIVE_PATH="       Caminho: "
)
if "!GDRIVE_PATH!"=="" ( echo [ERRO] Caminho nao informado. & pause & exit /b 1 )
if not exist "!GDRIVE_PATH!" ( echo [ERRO] Pasta nao encontrada: !GDRIVE_PATH! & pause & exit /b 1 )

set DATA_DIR=!GDRIVE_PATH!\Delas\data
set BACKUP_DIR=!GDRIVE_PATH!\Delas\backups
echo       Google Drive: !GDRIVE_PATH!
echo       Dados: !DATA_DIR!

:: ── 3. Criar diretorios ────────────────────────────────────
echo.
echo [3/8] Criando pastas...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
mkdir "!DATA_DIR!" 2>nul
mkdir "!BACKUP_DIR!" 2>nul

:: ── 4. Baixar o sistema do GitHub ─────────────────────────
echo.
echo [4/8] Baixando o sistema...
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TEMP%\delas.zip' -UseBasicParsing; Write-Host '      Download concluido.' } catch { Write-Host '[ERRO]' $_.Exception.Message; exit 1 }"
if %errorLevel% neq 0 ( echo [ERRO] Falha no download. Verifique a internet. & pause & exit /b 1 )

powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\delas.zip' -DestinationPath '%TEMP%\delas-extract' -Force"
xcopy /e /i /y "%TEMP%\delas-extract\%ZIP_FOLDER%\*" "%INSTALL_DIR%\" >nul
if not exist "%INSTALL_DIR%\.env" ( copy "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul )
del /q "%TEMP%\delas.zip" >nul 2>&1
rmdir /s /q "%TEMP%\delas-extract" >nul 2>&1

:: ── 5. Baixar e configurar ngrok ──────────────────────────
echo.
echo [5/8] Configurando ngrok (WhatsApp)...
if not exist "%INSTALL_DIR%\ngrok.exe" (
    echo       Baixando ngrok...
    powershell -NoProfile -Command ^
      "try { Invoke-WebRequest -Uri '%NGROK_URL%' -OutFile '%TEMP%\ngrok.zip' -UseBasicParsing } catch { Write-Host '[ERRO]' $_.Exception.Message; exit 1 }"
    if %errorLevel% neq 0 ( echo [AVISO] Nao foi possivel baixar o ngrok. WhatsApp nao estara disponivel. & goto :skip_ngrok )
    powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\ngrok.zip' -DestinationPath '%INSTALL_DIR%' -Force"
    del /q "%TEMP%\ngrok.zip" >nul 2>&1
)
"%INSTALL_DIR%\ngrok.exe" config add-authtoken %NGROK_TOKEN% >nul 2>&1
echo       ngrok configurado. Dominio: %NGROK_DOMAIN%
:skip_ngrok

:: ── 6. Criar script de inicializacao ──────────────────────
echo.
echo [6/8] Configurando inicializacao automatica...

(
echo @echo off
echo title Delas Gestao
echo cd /d C:\Delas
echo set DATA_DIR=!DATA_DIR!
echo set BACKUP_DIR=!BACKUP_DIR!
echo :: Iniciar servidor Node.js em segundo plano
echo start "Delas - Servidor" /min cmd /c "node server.js"
echo timeout /t 3 /nobreak ^>nul
echo :: Iniciar tunel ngrok para WhatsApp
echo if exist "C:\Delas\ngrok.exe" (
echo   start "Delas - WhatsApp" /min "C:\Delas\ngrok.exe" http --domain=%NGROK_DOMAIN% 3000
echo )
echo :: Abrir navegador
echo timeout /t 2 /nobreak ^>nul
echo start http://localhost:3000
) > "%INSTALL_DIR%\iniciar.bat"

copy /y "%INSTALL_DIR%\iniciar.bat" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\delas-gestao.bat" >nul
echo       Configurado para iniciar com o Windows.

:: ── 7. Criar atalho na area de trabalho ───────────────────
echo.
echo [7/8] Criando atalho na area de trabalho...
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory'); ^
   $s = $ws.CreateShortcut($desktop + '\Delas Gestao.lnk'); ^
   $s.TargetPath = '%INSTALL_DIR%\iniciar.bat'; ^
   $s.WorkingDirectory = '%INSTALL_DIR%'; ^
   $s.Description = 'Delas Gestao - Sistema do escritorio'; ^
   $s.Save()"
echo       Atalho criado na area de trabalho.

:: ── 8. Iniciar tudo ───────────────────────────────────────
echo.
echo [8/8] Iniciando o servidor e o tunel WhatsApp...

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set RAW_IP=%%a
    goto :got_ip
)
:got_ip
set LOCAL_IP=%RAW_IP: =%

set DATA_DIR=!DATA_DIR!
start "Delas - Servidor" /min cmd /c "cd /d C:\Delas && set DATA_DIR=!DATA_DIR! && node server.js"
timeout /t 3 /nobreak >nul
if exist "%INSTALL_DIR%\ngrok.exe" (
    start "Delas - WhatsApp" /min "%INSTALL_DIR%\ngrok.exe" http --domain=%NGROK_DOMAIN% 3000
)
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo =====================================================
echo   Instalacao concluida com sucesso!
echo =====================================================
echo.
echo   Acesso neste computador:
echo     http://localhost:3000
echo.
echo   Acesso pelos outros PCs da rede:
echo     http://%LOCAL_IP%:3000
echo.
echo   URL do WhatsApp (webhook na Meta):
echo     https://%NGROK_DOMAIN%/api/whatsapp/webhook
echo.
echo   Dados salvos no Google Drive:
echo     !DATA_DIR!
echo.
echo   Login inicial:
echo     E-mail: fernanda@delas.com.br
echo     Senha:  mudar123
echo.
echo   IMPORTANTE: Troque as senhas no primeiro acesso!
echo =====================================================
pause
