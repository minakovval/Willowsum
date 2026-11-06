import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureWritable, s3Url, signV4, signingKey } from '../lib/s3.mjs';

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

// A fake gateway: answers PUT with 500 («No writable volumes») the first `failures` times, then 200.
async function fakeGateway(failures, status = 500) {
  const http = await import('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push(req.method);
      const fail = req.method === 'PUT' && seen.filter((m) => m === 'PUT').length <= failures;
      res.statusCode = fail ? status : req.method === 'DELETE' ? 204 : 200;
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const values = {
    WS_LOCAL_S3_PORT: String(server.address().port),
    WS_LOCAL_S3_BUCKET: 'b',
    WS_LOCAL_S3_REGION: 'eu-local-1',
    WS_LOCAL_S3_ACCESS_KEY: 'AK',
    WS_LOCAL_S3_SECRET_KEY: 'SK',
  };
  return { values, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('CICD-04 local: up waits until a new bucket accepts writes (first writes fail while volumes grow)', async () => {
  const gw = await fakeGateway(3);
  try {
    const attempts = await ensureWritable(gw.values, { intervalMs: 10 });
    assert.equal(attempts, 4);
    assert.deepEqual(gw.seen, ['PUT', 'PUT', 'PUT', 'PUT', 'DELETE'], 'the probe object is removed');
  } finally {
    await gw.close();
  }
});

test('CICD-04 local: up fails clearly when the bucket never becomes writable', async () => {
  const gw = await fakeGateway(Infinity);
  try {
    await assert.rejects(ensureWritable(gw.values, { timeoutMs: 100, intervalMs: 10 }), /does not accept writes \(HTTP 500\)/);
  } finally {
    await gw.close();
  }
});

test('CICD-04 local: a refused key (403) fails at once instead of retrying', async () => {
  const gw = await fakeGateway(Infinity, 403);
  try {
    await assert.rejects(ensureWritable(gw.values, { intervalMs: 10 }), /HTTP 403/);
    assert.equal(gw.seen.length, 1);
  } finally {
    await gw.close();
  }
});
