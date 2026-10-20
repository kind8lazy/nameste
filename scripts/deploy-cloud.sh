#!/usr/bin/env bash
# Выкладка на облачный сервер (Яндекс Облако, Ubuntu 24.04) — боевая версия для родителей.
# Что делает: собирает веб-приложение, при первом запуске готовит сервер (Node.js, Caddy с HTTPS,
# отдельный системный пользователь, файл подкачки), копирует код, ставит зависимости и перезапускает сервис.
# Запускать с Mac:
#   CLOUD_HOST=root@81.29.140.100 SSH_PORT=13422 DOMAIN=example.ru bash scripts/deploy-cloud.sh
# CLOUD_HOST — ssh-алиас или user@ip; SSH_PORT — порт SSH (по умолчанию 22);
# DOMAIN — адрес сайта, его A-запись должна указывать на IP сервера.
# Если хостинг отдаёт 80/443 под другими внешними портами (общий IP), задайте PUBLIC_PORT (например 13443)
# и DNS_CHALLENGE=duckdns: сертификат тогда выпускается через DNS, а токен DuckDNS лежит на сервере
# в /etc/caddy/duckdns.env (строка DUCKDNS_TOKEN=...), в скрипт и в чат он не попадает.
set -euo pipefail

HOST="${CLOUD_HOST:?Укажите CLOUD_HOST — ssh-алиас или user@ip сервера}"
SSH_PORT="${SSH_PORT:-22}"
ssh() { command ssh -p "$SSH_PORT" "$@"; }
DOMAIN="${DOMAIN:?Укажите DOMAIN — адрес сайта, например na-meste.ru}"
PUBLIC_PORT="${PUBLIC_PORT:-443}"           # внешний порт HTTPS (если не 443, он попадёт в адрес сайта)
REDIRECT_FROM="${REDIRECT_FROM:-}"          # старые адреса через пробел: они навсегда перенаправляются на DOMAIN
REDIRECT_BLOCKS=""
for h in $REDIRECT_FROM; do REDIRECT_BLOCKS+=$(printf '\n%s {\n\tredir https://%s{uri} permanent\n}\n' "$h" "$DOMAIN"); done
DNS_CHALLENGE="${DNS_CHALLENGE:-}"          # duckdns — выпуск сертификата через DNS, когда порты 80/443 наружу недоступны
if [ "$PUBLIC_PORT" = 443 ]; then PUBLIC_URL="https://$DOMAIN"; else PUBLIC_URL="https://$DOMAIN:$PUBLIC_PORT"; fi
# на нестандартном внешнем порту редирект с 80 увёл бы не туда; на обычном 443 он нужен
if [ "$PUBLIC_PORT" = 443 ]; then GLOBAL_OPTS=""; SITE_PORT=""; else GLOBAL_OPTS=$'{\n\tauto_https disable_redirects\n}'; SITE_PORT=":443"; fi
PORT=3100                                   # внутренний порт, наружу его открывает только Caddy
APP=/opt/na-meste                           # код (только чтение для сервиса)
DATA=/var/lib/na-meste                      # база, ключи уведомлений, ночные копии
NODE_VERSION="${NODE_VERSION:-$(node -v)}"  # та же версия, что на Mac
# демо-режим: если не задан явно, берём то, что уже стоит на сервере; по умолчанию выключен
DEMO_OVERRIDE="${DEMO_MODE:-}"
# простой режим: карта, слежение, цены и ссылки для близких скрыты; по умолчанию включён (LITE_MODE=0 — показать всё)
LITE="${LITE_MODE:-1}"
# вход через Яндекс: 0 — только коды диспетчера; если не задан, берём то, что стоит на сервере (по умолчанию включён)
YANDEX_OVERRIDE="${YANDEX_LOGIN:-}"

cd "$(dirname "$0")/.."
npm run build

# ——— подготовка сервера (повторный запуск ничего не ломает) ———
ssh "$HOST" sudo bash -s <<PROVISION
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null || ! command -v sqlite3 >/dev/null || ! command -v rsync >/dev/null; then
  apt-get update -q
  apt-get install -y -q caddy sqlite3 rsync
fi
# Node.js с официального сайта, с проверкой контрольной суммы
if [ "\$(node -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  cd /tmp
  F=node-$NODE_VERSION-linux-x64.tar.xz
  curl -fsSLO https://nodejs.org/dist/$NODE_VERSION/\$F
  curl -fsSL https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt | grep " \$F\\\$" | sha256sum -c -
  rm -rf /usr/local/lib/nodejs && mkdir -p /usr/local/lib/nodejs
  tar -xJf \$F -C /usr/local/lib/nodejs --strip-components=1
  ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  ln -sf /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm
  ln -sf /usr/local/lib/nodejs/bin/npx /usr/local/bin/npx
  rm -f \$F
fi
# подкачка на 1 ГБ — чтобы установка зависимостей не упиралась в память маленькой машины
if [ -z "\$(swapon --show --noheadings)" ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
id nameste >/dev/null 2>&1 || useradd --system --home-dir $DATA --shell /usr/sbin/nologin nameste
mkdir -p $APP && chown "\$SUDO_USER":nameste $APP && chmod 750 $APP
cat > /etc/systemd/system/na-meste.service <<UNIT
[Unit]
Description=НА МЕСТЕ — развозка детей
After=network-online.target
Wants=network-online.target

[Service]
User=nameste
Group=nameste
WorkingDirectory=$APP
ExecStart=/usr/local/bin/node --import tsx server/index.ts
Environment=NODE_ENV=production
StateDirectory=na-meste
StateDirectoryMode=0700
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
if [ "$DNS_CHALLENGE" = duckdns ]; then
  [ -s /etc/caddy/duckdns.env ] || { echo "Нет /etc/caddy/duckdns.env с токеном DuckDNS — см. комментарий в начале скрипта"; exit 1; }
  chown root:caddy /etc/caddy/duckdns.env && chmod 640 /etc/caddy/duckdns.env
  # Caddy со встроенной поддержкой DNS DuckDNS (официальная сборка с caddyserver.com)
  if ! caddy list-modules 2>/dev/null | grep -q '^dns.providers.duckdns\$'; then
    curl -fsSL -o /tmp/caddy-duckdns "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/caddy-dns/duckdns"
    chmod +x /tmp/caddy-duckdns
    /tmp/caddy-duckdns list-modules | grep -q '^dns.providers.duckdns\$'
    apt-mark hold caddy >/dev/null
    install -m 755 /tmp/caddy-duckdns /usr/bin/caddy && rm -f /tmp/caddy-duckdns
  fi
  mkdir -p /etc/systemd/system/caddy.service.d
  printf '[Service]\nEnvironmentFile=/etc/caddy/duckdns.env\n' > /etc/systemd/system/caddy.service.d/duckdns.conf
  cat > /etc/caddy/Caddyfile <<CADDY
$GLOBAL_OPTS
$DOMAIN$SITE_PORT {
	tls {
		dns duckdns {env.DUCKDNS_TOKEN}
		resolvers 77.88.8.8 8.8.8.8
	}
	# живой поток событий не сжимаем, иначе обновления на карте приходят пачками
	@compress not path /api/stream
	encode @compress zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
else
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	# живой поток событий не сжимаем, иначе обновления на карте приходят пачками
	@compress not path /api/stream
	encode @compress zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:$PORT
}
$REDIRECT_BLOCKS
CADDY
fi
systemctl daemon-reload
systemctl enable na-meste >/dev/null
systemctl restart caddy
PROVISION

# ——— код ———
# предыдущая версия остаётся на сервере: если новая сломается, scripts/rollback-cloud.sh вернёт её за минуту
ssh "$HOST" "[ -d $APP ] && rsync -a --delete --exclude node_modules --exclude .env --exclude secrets.env $APP/ $APP.prev/ || true"
rsync -az --delete -e "ssh -p $SSH_PORT" \
  --exclude node_modules --exclude data --exclude .env --exclude .git --exclude .DS_Store \
  ./ "$HOST:$APP/"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd $APP
npm ci --omit=dev --no-audit --no-fund
# ключ демо-входа сохраняется между выкладками
DKEY=\$(grep -s '^DEMO_KEY=' .env | cut -d= -f2 || true)
[ -n "\$DKEY" ] || DKEY=\$(openssl rand -hex 8)
DM="$DEMO_OVERRIDE"
[ -n "\$DM" ] || DM=\$(grep -s '^DEMO_MODE=' .env | cut -d= -f2 || true)
[ -n "\$DM" ] || DM=0
YL="$YANDEX_OVERRIDE"
[ -n "\$YL" ] || YL=\$(grep -s '^YANDEX_LOGIN=' .env | cut -d= -f2 || true)
[ -n "\$YL" ] || YL=1
cat > .env <<ENV
NODE_ENV=production
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=$DATA
PUBLIC_URL=$PUBLIC_URL
VAPID_SUBJECT=$PUBLIC_URL
DEMO_MODE=\$DM
DEMO_KEY=\$DKEY
LITE_MODE=$LITE
YANDEX_LOGIN=\$YL
ENV
# секреты читает только сервис
[ -f secrets.env ] || touch secrets.env
sudo chgrp nameste .env secrets.env
chmod 640 .env secrets.env
sudo systemctl restart na-meste
sleep 3
curl -sf http://127.0.0.1:$PORT/api/health && echo " — сервер отвечает"
REMOTE
curl -sf "$PUBLIC_URL/api/health" >/dev/null && echo "Готово: $PUBLIC_URL" \
  || echo "Сервер запущен, но $PUBLIC_URL пока не отвечает — проверьте A-запись домена (сертификат выпускается в первые минуты)."
