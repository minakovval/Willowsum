import assert from 'node:assert/strict';
import { test } from 'node:test';
import { s3Url, signV4, signingKey } from '../lib/s3.mjs';

test('SigV4 signing key matches the AWS documentation test vector', () => {
  // docs.aws.amazon.com, «Deriving the signing key»: secret, 20120215, us-east-1, iam.
  const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
  assert.equal(key.toString('hex'), 'f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
});

test('SigV4 headers carry the date, payload hash and credential scope', () => {
  const headers = signV4({
    method: 'PUT',
    url: 'http://127.0.0.1:8333/bucket/a.txt',
    body: '',
    accessKey: 'AK',
    secretKey: 'SK',
    region: 'eu-local-1',
    now: new Date('2026-11-06T10:00:00.000Z'),
  });
  assert.equal(headers['x-amz-date'], '20261106T100000Z');
  assert.equal(headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.match(
    headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AK\/20261106\/eu-local-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
});

test('S3 URLs are path-style on localhost', () => {
  const values = { WS_LOCAL_S3_PORT: '8333' };
  assert.equal(s3Url(values, 'b'), 'http://127.0.0.1:8333/b');
  assert.equal(s3Url(values, 'b', 'smoke/x y.txt'), 'http://127.0.0.1:8333/b/smoke/x%20y.txt');
});
