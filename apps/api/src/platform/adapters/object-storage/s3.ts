import { AwsClient } from "aws4fetch";
import { ProviderError } from "../errors.ts";
import { checkObjectKey, checkPrefix, OBJECT_STORAGE_PORT, type ObjectStorage } from "./port.ts";

/**
 * The live implementation over the S3 API (ARC-06@PoC FR 4; ARC-08: standard technology — the local SeaweedFS of
 * infra/local in PoC, any S3-compatible storage later). Requests are signed with AWS Signature V4 by `aws4fetch`
 * (a maintained, dependency-free MIT library; ADR-free: a request signer, no cryptography of our own). Path-style URLs,
 * no retries inside the signer (the caller decides), errors name only the port and the operation.
 */
export interface S3Options {
  /** The storage's base URL, e.g. `http://127.0.0.1:8333`; no path, no credentials. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Time limit of one request, ms (default 30 s). */
  readonly timeoutMs?: number;
}

const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function s3ObjectStorage(options: S3Options): ObjectStorage {
  const base = new URL(options.endpoint);
  if (
    !/^https?:$/.test(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search
  )
    throw new Error("The S3 endpoint is a bare http(s) origin");
  if (!BUCKET_RE.test(options.bucket)) throw new Error("Invalid bucket name");
  const client = new AwsClient({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    service: "s3",
    region: options.region,
    retries: 0,
  });
  const origin = base.origin;
  const objectUrl = (key: string) => `${origin}/${options.bucket}/${key}`;
  const timeout = options.timeoutMs ?? 30_000;

  async function call(op: keyof typeof OBJECT_STORAGE_PORT.operations, url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await client.fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      const kind = (error as Error).name === "TimeoutError" ? "timeout" : "unavailable";
      throw new ProviderError(kind, OBJECT_STORAGE_PORT.name, op, (error as Error).name);
    }
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      throw new ProviderError("unavailable", OBJECT_STORAGE_PORT.name, op);
    }
    return response;
  }

  const refused = (op: keyof typeof OBJECT_STORAGE_PORT.operations) =>
    new ProviderError("rejected", OBJECT_STORAGE_PORT.name, op);

  return {
    async put(key, body) {
      checkObjectKey(key);
      const response = await call("put", objectUrl(key), {
        method: "PUT",
        body: Buffer.from(body),
        headers: { "content-type": "application/octet-stream" },
      });
      await response.body?.cancel();
      if (!response.ok) throw refused("put");
    },
    async get(key) {
      checkObjectKey(key);
      const response = await call("get", objectUrl(key), { method: "GET" });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw refused("get");
      }
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(key) {
      checkObjectKey(key);
      const response = await call("delete", objectUrl(key), { method: "DELETE" });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw refused("delete");
    },
    async list(prefix) {
      checkPrefix(prefix);
      const url = new URL(`${origin}/${options.bucket}`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      const response = await call("list", url.toString(), { method: "GET" });
      if (!response.ok) {
        await response.body?.cancel();
        throw refused("list");
      }
      const xml = await response.text();
      if (!xml.includes("<ListBucketResult"))
        throw new ProviderError("invalid-response", OBJECT_STORAGE_PORT.name, "list");
      return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]!).sort();
    },
  };
}

/** Creates the bucket when it does not exist (local environment and tests; a deployment provisions it). */
export async function ensureBucket(options: S3Options): Promise<void> {
  const client = new AwsClient({ ...options, service: "s3", retries: 0 });
  const url = `${new URL(options.endpoint).origin}/${options.bucket}`;
  const head = await client.fetch(url, { method: "HEAD" });
  if (head.ok) return;
  const made = await client.fetch(url, { method: "PUT" });
  await made.body?.cancel();
  if (!made.ok && made.status !== 409) throw new ProviderError("rejected", OBJECT_STORAGE_PORT.name, "put");
}
