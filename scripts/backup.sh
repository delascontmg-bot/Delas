#!/usr/bin/env bash
# Backup do banco de dados SQLite do Delas Gestão.
# Uso: bash scripts/backup.sh
# Cron diário sugerido: 0 2 * * * /caminho/para/delas/scripts/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
BACKUP_DIR="$ROOT_DIR/backups"
DB_FILE="$DATA_DIR/delas.db"
KEEP_DAYS="${KEEP_DAYS:-30}"

if [ ! -f "$DB_FILE" ]; then
  echo "Banco de dados não encontrado: $DB_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP=$(date '+%Y%m%d_%H%M%S')
DEST="$BACKUP_DIR/delas_$STAMP.db"

if command -v sqlite3 &>/dev/null; then
  sqlite3 "$DB_FILE" ".backup '$DEST'"
else
  cp "$DB_FILE" "$DEST"
fi

echo "Backup criado: $DEST ($(du -sh "$DEST" | cut -f1))"

# Verificar integridade
if command -v sqlite3 &>/dev/null; then
  RESULT=$(sqlite3 "$DEST" "PRAGMA integrity_check;" 2>&1)
  if [ "$RESULT" != "ok" ]; then
    echo "AVISO: Verificação de integridade falhou: $RESULT"
    exit 2
  fi
  echo "Integridade verificada: ok"
fi

# Remover backups antigos (mais de KEEP_DAYS dias)
if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name "delas_*.db" -mtime +"$KEEP_DAYS" -delete
  echo "Backups com mais de ${KEEP_DAYS} dias removidos"
fi
