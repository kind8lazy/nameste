import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.YANDEX_CLIENT_ID = 'test-client';
process.env.YANDEX_CLIENT_SECRET = 'test-secret';
const { pollDeviceToken, requestDeviceCode } = await import('./modules/yandex');

const reply = (body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

describe('вход через Яндекс по коду', () => {
  afterEach(() => vi.restoreAllMocks());

  it('запрашивает код с нужными параметрами', async () => {
    const f = reply({ device_code: 'dc', user_code: 'h5nbcr6c', verification_url: 'https://ya.ru/device', interval: 5, expires_in: 300 });
    const c = await requestDeviceCode('device-123456');
    expect(c).toEqual({ deviceCode: 'dc', userCode: 'h5nbcr6c', verificationUrl: 'https://ya.ru/device', interval: 5, expiresIn: 300 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://oauth.yandex.ru/device/code');
    const body = new URLSearchParams(String(init?.body));
    expect(body.get('client_id')).toBe('test-client');
    expect(body.get('device_id')).toBe('device-123456');
  });

  it('опрашивает токен по device_code и понимает ответы Яндекса', async () => {
    const f = reply({ error: 'authorization_pending' });
    expect(await pollDeviceToken('dc')).toEqual({ status: 'pending' });
    const body = new URLSearchParams(String(f.mock.calls[0][1]?.body));
    expect(body.get('grant_type')).toBe('device_code');
    expect(body.get('code')).toBe('dc');
    expect(body.get('client_secret')).toBe('test-secret');
    vi.restoreAllMocks();

    reply({ error: 'invalid_grant', error_description: 'Code has expired' });
    expect(await pollDeviceToken('dc')).toEqual({ status: 'expired' });
    vi.restoreAllMocks();

    reply({ access_token: 'tok', token_type: 'bearer', expires_in: 3600 });
    expect(await pollDeviceToken('dc')).toEqual({ status: 'ok', accessToken: 'tok' });
    vi.restoreAllMocks();

    reply({ error: 'unauthorized_client', error_description: 'Client is blocked' });
    expect(await pollDeviceToken('dc')).toEqual({ status: 'denied', error: 'Client is blocked' });
  });

  it('понятная ошибка, если Яндекс не выдал код', async () => {
    reply({ error: 'invalid_client', error_description: 'Client not found' });
    await expect(requestDeviceCode('device-123456')).rejects.toThrow('Яндекс не выдал код входа: Client not found');
  });
});
