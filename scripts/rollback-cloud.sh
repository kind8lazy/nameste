#!/usr/bin/env bash
# Откат боевого сайта на предыдущую выкладку (копия кода сохраняется при каждой выкладке).
set -euo pipefail
HOST="${CLOUD_HOST:-root@81.29.141.215}"; PORT="${SSH_PORT:-22}"
ssh -p "$PORT" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
[ -d /opt/na-meste.prev ] || { echo "Предыдущей версии нет"; exit 1; }
rsync -a --delete --exclude node_modules --exclude .env --exclude secrets.env /opt/na-meste.prev/ /opt/na-meste/
cd /opt/na-meste && npm ci --omit=dev --no-audit --no-fund >/dev/null
systemctl restart na-meste; sleep 3
curl -sf http://127.0.0.1:3100/api/health && echo " — откатились, сервер отвечает"
REMOTE
