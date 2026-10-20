import { describe, expect, it } from 'vitest';
import { signV4 } from './lib/sigv4';

describe('подпись запросов к Yandex Cloud (AWS Signature V4)', () => {
  it('совпадает с эталонным примером из документации AWS', () => {
    const h = signV4({
      method: 'GET',
      host: 'iam.amazonaws.com',
      query: { Action: 'ListUsers', Version: '2010-05-08' },
      contentType: 'application/x-www-form-urlencoded; charset=utf-8',
      accessKeyId: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'iam',
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });
});
