export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Открыто как приложение с экрана «Домой». */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function phoneHref(phone: string | null | undefined) {
  return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined;
}

/** Маршрут в Яндекс Картах / Навигаторе (открывается приложение, если установлено). */
export function routeHref(lat: number, lon: number) {
  return `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`;
}
