# Delas Gestão

Sistema de gestão interna para escritório de contabilidade — Kanban, base de conhecimento, chat e financeiro. Roda com Node.js puro (zero dependências npm externas).

## Requisitos

- **Node.js 22.5+** (usa `node:sqlite` embutido)
- `sqlite3` CLI (opcional — necessário para backup e restore com verificação de integridade)

```
node --version   # deve ser >= 22.5.0
```

## Instalação

```bash
git clone <url-do-repo>
cd delas

# Crie o arquivo de variáveis de ambiente
cp .env.example .env
# Edite .env conforme necessário (veja seção Variáveis de Ambiente)

# Crie o diretório de dados (já incluso como data/.gitkeep)
mkdir -p data backups

# Inicie o servidor
node server.js
```

O banco SQLite é criado e populado automaticamente na primeira execução em `data/delas.db`.

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Diretório do banco SQLite |
| `WA_TOKEN` | — | Token de acesso da API do WhatsApp (Meta Cloud API) |
| `WA_PHONE_ID` | — | ID do número de telefone no Meta Business |
| `WA_VERIFY_TOKEN` | — | Token de verificação do webhook do WhatsApp |
| `WA_APP_SECRET` | — | App Secret do Meta App para validar assinatura HMAC-SHA256 do webhook |

Todas as variáveis do WhatsApp são opcionais — o módulo WA simplesmente não envia/recebe mensagens se não configurado.

## Credenciais Iniciais (Seed)

O banco é populado com 5 usuários na primeira execução:

| Nome | E-mail | Senha | Papel |
|---|---|---|---|
| Fernanda | fernanda@delas.com.br | `mudar123` | sócia |
| Cinthia | cinthia@delas.com.br | `mudar123` | sócia |
| Ana Paula | ana@delas.com.br | `mudar123` | colaboradora |
| Lucas | lucas@delas.com.br | `mudar123` | colaborador |
| Mariana | mariana@delas.com.br | `mudar123` | colaboradora |

**Troque as senhas imediatamente após o primeiro login** (menu Usuários, disponível para sócias).

## Módulos

### Kanban
Quadros com colunas e cartões. Drag-and-drop entre colunas e dentro de colunas (reordenação). Filtros por responsável, empresa, prioridade e prazo. Criação de cartões vinculados a empresas.

### Base de Conhecimento (Páginas)
Página Notion-style por empresa com editor Markdown básico. Histórico de versões com botão de restaurar. Tarefas vinculadas ao kanban. Histórico de conversas do WhatsApp vinculadas à empresa.

### Chat Interno
Canais de texto e conversas diretas (DM). Polling incremental a cada 5 s (busca apenas mensagens novas). Menções com `@nome`.

### WhatsApp
Integração com a Meta Cloud API v20.0. Envio de mensagens de texto. Recebimento via webhook com validação de assinatura HMAC-SHA256. Mensagens de tipo não-texto (áudio, imagem, documento) são registradas como marcador `[mensagem de tipo: X]`.

### Financeiro
Contas a pagar e receber com vencimento e competência. Extrato, saldo e resumo por competência. **Acesso restrito a sócias.**

### Fechamento Mensal
Grid empresa × etapa com status por competência. Sócias podem configurar as etapas disponíveis (⚙️ Etapas). Botão para gerar card no kanban a partir de uma etapa.

### Auditoria
Log completo de ações dos usuários. **Acesso restrito a sócias.**

## Permissões

| Módulo | Sócia | Colaborador |
|---|---|---|
| Kanban | ✅ Todos os cartões | ✅ Apenas sua carteira |
| Empresas / Páginas | ✅ Todas | ✅ Apenas carteira |
| Chat | ✅ | ✅ |
| WhatsApp | ✅ | ✅ |
| Financeiro | ✅ | ❌ |
| Fechamento | ✅ | ✅ |
| Usuários | ✅ | ❌ |
| Auditoria | ✅ | ❌ |

## Configurar WhatsApp

1. Crie um App no [Meta for Developers](https://developers.facebook.com/) com o produto **WhatsApp Business**.
2. No painel do App, anote: **App Secret**, **Token de Acesso Permanente**, **Phone Number ID**.
3. Configure o Webhook apontando para `https://seu-dominio.com/api/whatsapp/webhook`.
   - Eventos: `messages`
   - Token de Verificação: o valor de `WA_VERIFY_TOKEN` no seu `.env`
4. Defina `WA_APP_SECRET` no `.env` — o servidor validará cada requisição recebida com HMAC-SHA256.

## Backup e Restore

### Backup manual

```bash
bash scripts/backup.sh
```

Cria `backups/delas_YYYYMMDD_HHMMSS.db` e verifica integridade. Backups com mais de 30 dias são removidos automaticamente (ajuste `KEEP_DAYS` se necessário).

### Backup automático (cron)

```bash
# Adicione ao crontab: backup diário às 2h
0 2 * * * /caminho/para/delas/scripts/backup.sh >> /var/log/delas-backup.log 2>&1
```

### Restore

```bash
bash scripts/restore.sh backups/delas_20240115_020000.db
```

O script verifica a integridade do backup, salva uma cópia de emergência do banco atual e só então restaura.

## Deploy com Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name delas.seudominio.com.br;

    ssl_certificate     /etc/letsencrypt/live/delas.seudominio.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/delas.seudominio.com.br/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Execute o servidor como serviço (systemd ou PM2):

```bash
# PM2
npm install -g pm2
pm2 start server.js --name delas
pm2 save
pm2 startup
```

## Verificação rápida

```bash
# Health check
curl http://localhost:3000/api/health
# → {"ok":true,"uptime":5,"db":"ok","version":"1.0.0"}

# Login correto
curl -c cookies.txt -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"fernanda@delas.com.br","password":"mudar123"}'

# Brute-force protection (após 10 erros → 429)
curl -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"fernanda@delas.com.br","password":"errada"}'

# Backup
bash scripts/backup.sh
```

## Segurança

- Senhas com `scrypt` + salt aleatório de 32 bytes
- Sessões com token aleatório de 64 hex chars, validade de 14 dias, cookie `HttpOnly; SameSite=Lax`
- Rate limiting: 10 tentativas de login por IP em 15 minutos → HTTP 429
- Headers HTTP: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- Webhook WhatsApp com validação `X-Hub-Signature-256` (HMAC-SHA256)
- HTML sem cache (`Cache-Control: no-store`); assets estáticos com `max-age=3600`
- Log de auditoria para todas as ações sensíveis
