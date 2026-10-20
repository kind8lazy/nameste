#!/usr/bin/env bash
# Выкладка на домашний сервер (Ubuntu, 192.168.0.11) без платных сервисов.
# Что делает: собирает веб-приложение, копирует код на сервер, ставит зависимости,
# запускает сервис systemd (пользовательский) и открывает HTTPS через Tailscale.
# Запускать с Mac: bash scripts/deploy-home.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-home-lan}"            # ssh-алиас из ~/.ssh/config
DIR="${DEPLOY_DIR:-na-meste}"               # папка в домашнем каталоге на сервере
PORT="${DEPLOY_PORT:-3100}"                 # внутренний порт, наружу не открывается
PUBLIC_URL="${PUBLIC_URL:-https://mitriy.tailcb9627.ts.net}"
# демо-режим: если не задан явно, берём то, что уже стоит на сервере; по умолчанию выключен
DEMO_OVERRIDE="${DEMO_MODE:-}"

cd "$(dirname "$0")/.."
npm run build

rsync -az --delete \
  --exclude node_modules --exclude data --exclude .env --exclude .git \
  ./ "$HOST:$DIR/"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd ~/$DIR
npm ci --omit=dev --no-audit --no-fund
# ключ демо-входа сохраняется между выкладками
DKEY=\$(grep -s '^DEMO_KEY=' .env | cut -d= -f2 || true)
[ -n "\$DKEY" ] || DKEY=\$(openssl rand -hex 8)
DM="$DEMO_OVERRIDE"
[ -n "\$DM" ] || DM=\$(grep -s '^DEMO_MODE=' .env | cut -d= -f2 || true)
[ -n "\$DM" ] || DM=0
cat > .env <<ENV
NODE_ENV=production
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=data
PUBLIC_URL=$PUBLIC_URL
VAPID_SUBJECT=$PUBLIC_URL
DEMO_MODE=\$DM
DEMO_KEY=\$DKEY
ENV
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/na-meste.service <<UNIT
[Unit]
Description=НА МЕСТЕ — развозка детей
After=network-online.target

[Service]
WorkingDirectory=%h/$DIR
ExecStart=/usr/bin/env node --import tsx server/index.ts
Environment=NODE_ENV=production
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now na-meste
systemctl --user restart na-meste
sleep 2
curl -sf http://127.0.0.1:$PORT/api/health && echo " — сервер отвечает"
# HTTPS внутри вашей сети Tailscale (телефоны с Tailscale). Если просит права —
# один раз выполните на сервере: sudo tailscale set --operator=\$USER
tailscale serve --bg --https=443 http://127.0.0.1:$PORT || echo "tailscale serve: нужны права оператора, см. комментарий выше"
REMOTE
echo "Готово: $PUBLIC_URL"
