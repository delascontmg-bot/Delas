#!/usr/bin/env bash
# setup.sh — Instalação automática do Delas Gestão em Ubuntu 22.04/24.04.
# Uso: bash <(curl -fsSL https://raw.githubusercontent.com/delascontmg-bot/Delas/main/scripts/setup.sh)
#
# Variáveis opcionais (exporte antes de rodar ou responda às perguntas):
#   DOMINIO   — ex: delasgestao.com.br  (deixe em branco para usar só o IP)
#   REPO_URL  — URL do repositório git (padrão: GitHub)
#   INSTALL_DIR — diretório de instalação (padrão: /opt/delas)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/delascontmg-bot/Delas.git}"
REPO_BRANCH="${REPO_BRANCH:-claude/accounting-management-system-2t6crb}"
INSTALL_DIR="${INSTALL_DIR:-/opt/delas}"
DOMINIO="${DOMINIO:-}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✔]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

echo ""
echo "╔════════════════════════════════════╗"
echo "║   Delas Gestão — Instalação        ║"
echo "╚════════════════════════════════════╝"
echo ""

# Verificar se roda como root
if [ "$EUID" -ne 0 ]; then
  error "Execute como root: sudo bash setup.sh"
fi

# Perguntar domínio se não foi definido
if [ -z "$DOMINIO" ]; then
  read -rp "Domínio do sistema (ex: delas.com.br) — Enter para usar só o IP: " DOMINIO
fi

# ── 1. Atualizar sistema ──────────────────────────────────────────────────────
info "Atualizando pacotes do sistema..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Instalar Node.js 22 ────────────────────────────────────────────────────
if ! node --version 2>/dev/null | grep -q '^v22'; then
  info "Instalando Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
else
  info "Node.js 22 já instalado: $(node --version)"
fi

# ── 3. Instalar dependências do sistema ───────────────────────────────────────
info "Instalando sqlite3, nginx, certbot..."
apt-get install -y -qq sqlite3 nginx certbot python3-certbot-nginx

# ── 4. Instalar PM2 ──────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  info "Instalando PM2..."
  npm install -g pm2 --silent
else
  info "PM2 já instalado: $(pm2 --version)"
fi

# ── 5. Clonar repositório ────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repositório já existe em $INSTALL_DIR — atualizando..."
  git -C "$INSTALL_DIR" pull origin main || git -C "$INSTALL_DIR" pull
else
  info "Clonando repositório em $INSTALL_DIR..."
  git clone -b "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Garantir branch correta
git checkout "$REPO_BRANCH" 2>/dev/null || true

# ── 6. Configurar .env ───────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  info "Criando arquivo .env..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  # Porta padrão 3000 (Nginx faz o proxy)
  sed -i 's/^# PORT=.*/PORT=3000/' "$INSTALL_DIR/.env" 2>/dev/null || true
fi
warn "Edite $INSTALL_DIR/.env para configurar o WhatsApp e outras variáveis."

# ── 7. Criar diretórios de dados ─────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/backups"
info "Diretórios data/ e backups/ criados."

# ── 8. Configurar cron de backup diário ──────────────────────────────────────
CRON_JOB="0 2 * * * bash $INSTALL_DIR/scripts/backup.sh >> /var/log/delas-backup.log 2>&1"
if ! crontab -l 2>/dev/null | grep -qF "$INSTALL_DIR/scripts/backup.sh"; then
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
  info "Backup automático agendado diariamente às 2h."
fi

# ── 9. Iniciar com PM2 ───────────────────────────────────────────────────────
pm2 delete delas 2>/dev/null || true
pm2 start "$INSTALL_DIR/server.js" --name delas --cwd "$INSTALL_DIR"
pm2 save

# Configurar PM2 para iniciar no boot
PM2_STARTUP=$(pm2 startup systemd -u root --hp /root 2>&1 | grep 'sudo' | tail -1)
if [ -n "$PM2_STARTUP" ]; then
  eval "$PM2_STARTUP" >/dev/null 2>&1 || true
fi
info "PM2 configurado para iniciar no boot."

# ── 10. Verificar servidor ────────────────────────────────────────────────────
sleep 2
HEALTH=$(curl -sf http://localhost:3000/api/health 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"ok":true'; then
  info "Servidor respondendo: $HEALTH"
else
  error "Servidor não respondeu em http://localhost:3000/api/health — verifique: pm2 logs delas"
fi

# ── 11. Configurar Nginx ──────────────────────────────────────────────────────
NGINX_CONF="/etc/nginx/sites-available/delas"
cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name ${DOMINIO:-_};

    client_max_body_size 10M;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }
}
NGINX

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/delas
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t && systemctl reload nginx
info "Nginx configurado."

# ── 12. Configurar HTTPS (só se tiver domínio) ────────────────────────────────
if [ -n "$DOMINIO" ]; then
  echo ""
  read -rp "Configurar HTTPS com Let's Encrypt para $DOMINIO? [s/N] " HTTPS_CONFIRM
  if [[ "$HTTPS_CONFIRM" == "s" || "$HTTPS_CONFIRM" == "S" ]]; then
    read -rp "E-mail para notificações do certificado: " CERTBOT_EMAIL
    if [ -n "$CERTBOT_EMAIL" ]; then
      certbot --nginx -d "$DOMINIO" --email "$CERTBOT_EMAIL" --agree-tos --non-interactive --redirect
      info "HTTPS configurado para $DOMINIO"
    else
      warn "E-mail não informado — HTTPS não configurado. Rode manualmente: certbot --nginx -d $DOMINIO"
    fi
  fi
fi

# ── Resumo ────────────────────────────────────────────────────────────────────
IP=$(curl -sf https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Instalação concluída!                                    ║"
echo "╠════════════════════════════════════════════════════════════╣"
if [ -n "$DOMINIO" ]; then
echo "║   Acesso: https://$DOMINIO"
fi
echo "║   Acesso por IP: http://$IP"
echo "║   Login:  fernanda@delas.com.br  /  mudar123              ║"
echo "║   IMPORTANTE: Troque a senha no primeiro acesso!           ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║   Comandos úteis:                                          ║"
echo "║   pm2 logs delas          — ver logs em tempo real        ║"
echo "║   pm2 restart delas       — reiniciar o servidor           ║"
echo "║   bash $INSTALL_DIR/scripts/backup.sh — backup manual     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
