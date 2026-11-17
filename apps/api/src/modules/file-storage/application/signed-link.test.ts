import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNED_LINK_MAX_TTL_MS } from "../domain/index.ts";
import { linkKey, signLink, verifyLink } from "./signed-link.ts";

const key = linkKey(randomBytes(32));
const householdId = randomUUID();
const fileId = randomUUID();
const now = new Date("2026-11-17T10:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

describe("signed links (NFR-01@PoC FR 4, ARC-06@PoC FR 4)", () => {
  it("NFR-01@PoC FR 4: a link lives 15 minutes by default and never longer", () => {
    expect(SIGNED_LINK_MAX_TTL_MS).toBe(15 * 60 * 1000);
    const { token, expiresAt } = signLink(key, { householdId, fileId }, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(SIGNED_LINK_MAX_TTL_MS);
    expect(verifyLink(key, householdId, token, later(SIGNED_LINK_MAX_TTL_MS - 1))).toBe(fileId);
    expect(verifyLink(key, householdId, token, later(SIGNED_LINK_MAX_TTL_MS))).toBeNull();
    expect(() => signLink(key, { householdId, fileId }, now, SIGNED_LINK_MAX_TTL_MS + 1)).toThrow();
    expect(() => signLink(key, { householdId, fileId }, now, 0)).toThrow();
  });

  it("NFR-01@PoC FR 4, criterion «Підписані посилання»: HMAC-SHA256 over the space, the file and the expiry", () => {
    const { token } = signLink(key, { householdId, fileId }, now, 60_000);
    const [, id, expires, sig] = token.split(".");
    const expected = createHmac("sha256", key.bytes)
      .update(`v1|${householdId}|${id}|${expires}`)
      .digest("base64url");
    expect(sig).toBe(expected);
    expect(id).toBe(fileId);
  });

  it("NFR-01@PoC FR 4: a link of another space, another file, a tampered or far-future one opens nothing", () => {
    const { token } = signLink(key, { householdId, fileId }, now);
    expect(verifyLink(key, randomUUID(), token, now)).toBeNull();
    const otherFile = token.replace(fileId, randomUUID());
    expect(verifyLink(key, householdId, otherFile, now)).toBeNull();
    const [v, id, expires, sig] = token.split(".");
    expect(verifyLink(key, householdId, `${v}.${id}.${Number(expires) + 1}.${sig}`, now)).toBeNull();
    const flipped = sig!.slice(0, -1) + (sig!.endsWith("A") ? "B" : "A");
    expect(verifyLink(key, householdId, `${v}.${id}.${expires}.${flipped}`, now)).toBeNull();
    expect(verifyLink(linkKey(randomBytes(32)), householdId, token, now)).toBeNull();
    // Signed correctly for a whole day: still refused, a link may not live longer than 15 minutes.
    const day = Number(expires) + 24 * 3600 * 1000;
    const daySig = createHmac("sha256", key.bytes)
      .update(`v1|${householdId}|${id}|${day}`)
      .digest("base64url");
    expect(verifyLink(key, householdId, `${v}.${id}.${day}.${daySig}`, now)).toBeNull();
    expect(verifyLink(key, householdId, "garbage", now)).toBeNull();
  });

  it("NFR-01@PoC FR 4: the key of the signatures has at least 32 bytes", () => {
    expect(() => linkKey(randomBytes(31))).toThrow();
  });
});
