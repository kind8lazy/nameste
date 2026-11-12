#!/usr/bin/env bash
# Выкладка на боевой сервер na-meste-spb.ru одной командой: bash scripts/deploy-prod.sh
# Все адреса прописаны здесь — их не нужно копировать из переписки (мессенджеры превращают домены в ссылки).
set -euo pipefail
cd "$(dirname "$0")/.."
# выкладываем ту ветку, на которой стоит папка проекта (main у исполнителя); другая — DEPLOY_BRANCH=имя
BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
git pull --ff-only origin "$BRANCH"
CLOUD_HOST=root@81.29.141.215 \
SSH_PORT=22 \
DOMAIN=na-meste-spb.ru \
REDIRECT_FROM="nameste-spb.duckdns.org www.na-meste-spb.ru" \
  bash scripts/deploy-cloud.sh
