// Minimal S3 client for the local tool only: create the bucket and run the smoke check without adding a
// dependency to a zero-dependency tool. It signs requests with AWS Signature Version 4 using the
// HMAC-SHA256 and SHA-256 primitives of node:crypto (no cryptography of our own). The application talks to
// file storage through its file-storage adapter (ARC-05, ARC-06), not through this file.
import crypto from 'node:crypto';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** SigV4 signing key: HMAC chain over date, region, service and "aws4_request". */
export function signingKey(secretKey, date, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), 'aws4_request');
}

/** Path-style S3 URL for a bucket and optional object key (keys use only unreserved characters). */
export function s3Url(values, bucket, key = '') {
  const encoded = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `http://127.0.0.1:${values.WS_LOCAL_S3_PORT}/${bucket}${key ? `/${encoded}` : ''}`;
}

/** Signs a request (no query string). Returns the headers to send. */
export function signV4({ method, url, body = '', accessKey, secretKey, region, now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, u.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretKey, date, region, 's3'))
    .update(stringToSign)
    .digest('hex');
  return {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export async function s3Request(values, method, url, body) {
  const headers = signV4({
    method,
    url,
    body: body ?? '',
    accessKey: values.WS_LOCAL_S3_ACCESS_KEY,
    secretKey: values.WS_LOCAL_S3_SECRET_KEY,
    region: values.WS_LOCAL_S3_REGION,
  });
  return fetch(url, { method, headers, body });
}

/** Creates the bucket if it does not exist yet. */
export async function ensureBucket(values) {
  const url = s3Url(values, values.WS_LOCAL_S3_BUCKET);
  const head = await s3Request(values, 'HEAD', url);
  if (head.ok) return 'exists';
  const res = await s3Request(values, 'PUT', url);
  const text = await res.text();
  if (res.ok || /BucketAlreadyOwnedByYou/.test(text)) return 'created';
  throw new Error(`Creating bucket ${values.WS_LOCAL_S3_BUCKET} failed: HTTP ${res.status}`);
}
