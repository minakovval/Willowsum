import { createHmac, timingSafeEqual } from "node:crypto";
import { SIGNED_LINK_MAX_TTL_MS } from "../domain/index.ts";

/**
 * Signed links to stored files (ARC-06@PoC FR 4, NFR-01@PoC FR 4 and its row «Підписані посилання»): a token that
 * names the file and when it stops working, signed with HMAC-SHA256 over the space, the file and the expiry, and
 * compared in constant time. A link lives at most 15 minutes. The space is in the signature, not in the token: a link
 * opens only for a caller of that space, and a stranger cannot even tell the file exists.
 */
const VERSION = "v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^v1\.([0-9a-f-]{36})\.([0-9]{1,15})\.([A-Za-z0-9_-]{43})$/;

/** The key of the signatures: at least 32 bytes from the deployment's secrets, never in the repository. */
export interface LinkKey {
  readonly bytes: Uint8Array;
}

export function linkKey(bytes: Uint8Array): LinkKey {
  if (bytes.length < 32) throw new Error("A signed-link key has at least 32 bytes");
  return { bytes };
}

function signature(key: LinkKey, householdId: string, fileId: string, expiresMs: number): Buffer {
  return createHmac("sha256", key.bytes).update(`${VERSION}|${householdId}|${fileId}|${expiresMs}`).digest();
}

/** A token for the file, valid until `now + ttlMs` (at most 15 minutes). */
export function signLink(
  key: LinkKey,
  link: { readonly householdId: string; readonly fileId: string },
  now: Date,
  ttlMs: number = SIGNED_LINK_MAX_TTL_MS,
): { readonly token: string; readonly expiresAt: Date } {
  if (!UUID_RE.test(link.householdId) || !UUID_RE.test(link.fileId)) throw new Error("Ids are UUIDs");
  if (!(ttlMs > 0 && ttlMs <= SIGNED_LINK_MAX_TTL_MS))
    throw new Error("A signed link lives at most 15 minutes");
  const expiresMs = now.getTime() + ttlMs;
  const sig = signature(key, link.householdId, link.fileId, expiresMs).toString("base64url");
  return { token: `${VERSION}.${link.fileId}.${expiresMs}.${sig}`, expiresAt: new Date(expiresMs) };
}

/**
 * The file a token opens for a caller of this space at `now`, or null: malformed, signed for another space or file,
 * tampered, expired, or valid for longer than a link may live. One answer for all of them.
 */
export function verifyLink(key: LinkKey, householdId: string, token: string, now: Date): string | null {
  const m = TOKEN_RE.exec(token);
  if (!m || !UUID_RE.test(householdId)) return null;
  const fileId = m[1]!;
  const expiresMs = Number(m[2]);
  const given = Buffer.from(m[3]!, "base64url");
  const expected = signature(key, householdId, fileId, expiresMs);
  const valid = given.length === expected.length && timingSafeEqual(given, expected);
  if (!valid || !UUID_RE.test(fileId)) return null;
  const left = expiresMs - now.getTime();
  if (left <= 0 || left > SIGNED_LINK_MAX_TTL_MS) return null;
  return fileId;
}
