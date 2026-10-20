#!/usr/bin/env bash
# Копия базы с боевого сервера на этот Mac (вне сервера и вне папки проекта).
# Запуск: bash scripts/backup-pull.sh   Хранит последние 30 копий.
set -euo pipefail
HOST="${CLOUD_HOST:-root@81.29.141.215}"; PORT="${SSH_PORT:-22}"
DEST="${BACKUP_DIR:-$HOME/Documents/НА-МЕСТЕ-копии}"
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
ssh -p "$PORT" "$HOST" "sqlite3 /var/lib/na-meste/na-meste.db \".backup /tmp/na-meste-pull.db\" && gzip -f /tmp/na-meste-pull.db"
scp -q -P "$PORT" "$HOST:/tmp/na-meste-pull.db.gz" "$DEST/na-meste-$STAMP.db.gz"
ssh -p "$PORT" "$HOST" "rm -f /tmp/na-meste-pull.db.gz"
gzip -t "$DEST/na-meste-$STAMP.db.gz"
ls -1t "$DEST"/na-meste-*.db.gz | tail -n +31 | xargs -I{} rm -f {} 2>/dev/null || true
echo "Копия сохранена: $DEST/na-meste-$STAMP.db.gz ($(du -h "$DEST/na-meste-$STAMP.db.gz" | cut -f1))"
