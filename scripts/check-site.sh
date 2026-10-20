#!/usr/bin/env bash
# Проверка боевого сайта: если не отвечает — уведомление на Mac и код 1.
URL="${SITE_URL:-https://na-meste-spb.ru}"
if curl -sf -m 15 "$URL/api/health" >/dev/null; then echo "Сайт работает ($(date +%H:%M))"; exit 0; fi
sleep 20
curl -sf -m 15 "$URL/api/health" >/dev/null && { echo "Сайт работает ($(date +%H:%M))"; exit 0; }
osascript -e 'display notification "Сайт НА МЕСТЕ не отвечает" with title "Проверка сайта" sound name "Basso"' 2>/dev/null || true
echo "СБОЙ: $URL не отвечает"; exit 1
