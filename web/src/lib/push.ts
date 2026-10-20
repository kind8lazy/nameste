// Включение уведомлений. На iPhone — только в приложении с экрана «Домой» и только по нажатию кнопки.
import { api } from './api';
import { pushSupported } from './platform';

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export type PushResult = 'ok' | 'unsupported' | 'denied' | 'error';

export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
    if (!reg) return 'error';
    await navigator.serviceWorker.ready;
    const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    await api.post('/push/subscribe', sub.toJSON());
    return 'ok';
  } catch {
    return 'error';
  }
}
