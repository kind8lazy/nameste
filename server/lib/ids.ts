import { randomBytes, randomInt, createHash } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'; // без l и o

/** Короткий случайный идентификатор записи. */
export function newId(prefix = ''): string {
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${s}` : s;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Цифровой код, который удобно набрать на телефоне. */
export function digitCode(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String(randomInt(0, 10));
  return s;
}
