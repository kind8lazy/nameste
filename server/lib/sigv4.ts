// Подпись запроса по алгоритму AWS Signature V4 — её требует Yandex Cloud для статических ключей.
import { createHash, createHmac } from 'node:crypto';

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: 'GET' | 'POST';
  host: string;
  path?: string;
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
  accessKeyId: string;
  secretKey: string;
  region: string;
  service: string;
  now?: Date;
}

/** Возвращает заголовки, которые надо добавить к запросу. */
export function signV4(i: SignInput): Record<string, string> {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { host: i.host, 'x-amz-date': amzDate };
  if (i.contentType) headers['content-type'] = i.contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.entries(i.query ?? {})
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [i.method, i.path ?? '/', canonicalQuery, canonicalHeaders, signedHeaders, sha256hex(i.body ?? '')].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex');
  const out: Record<string, string> = {
    'X-Amz-Date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (i.contentType) out['Content-Type'] = i.contentType;
  return out;
}
