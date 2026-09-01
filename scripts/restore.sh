#!/usr/bin/env bash
# Restaura o banco de dados a partir de um backup.
# Uso: bash scripts/restore.sh backups/delas_20240115_020000.db
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
DB_FILE="$DATA_DIR/delas.db"

if [ $# -lt 1 ]; then
  echo "Uso: $0 <arquivo_backup>"
  echo ""
  echo "Backups disponíveis:"
  ls -lt "$ROOT_DIR/backups/"delas_*.db 2>/dev/null | head -10 || echo "  Nenhum backup encontrado."
  exit 1
fi

BACKUP="$1"
if [ ! -f "$BACKUP" ]; then
  echo "Arquivo não encontrado: $BACKUP"
  exit 1
fi

# Verificar integridade do backup antes de restaurar
if command -v sqlite3 &>/dev/null; then
  RESULT=$(sqlite3 "$BACKUP" "PRAGMA integrity_check;" 2>&1)
  if [ "$RESULT" != "ok" ]; then
    echo "ERRO: Backup corrompido ($RESULT). Restauração cancelada."
    exit 2
  fi
fi

echo "Backup: $BACKUP"
echo "Destino: $DB_FILE"
echo ""
read -rp "Confirma a restauração? O banco atual será substituído. [s/N] " CONFIRM
if [[ "$CONFIRM" != "s" && "$CONFIRM" != "S" ]]; then
  echo "Restauração cancelada."
  exit 0
fi

# Salvar cópia de segurança do banco atual antes de sobrescrever
if [ -f "$DB_FILE" ]; then
  EMERGENCY="$DB_FILE.pre_restore_$(date '+%Y%m%d_%H%M%S')"
  cp "$DB_FILE" "$EMERGENCY"
  echo "Cópia do banco atual salva em: $EMERGENCY"
fi

mkdir -p "$DATA_DIR"
cp "$BACKUP" "$DB_FILE"
echo "Banco restaurado com sucesso de: $BACKUP"
