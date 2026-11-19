import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FieldOpener } from "../../../household/index.ts";
import { matchAccount } from "../../domain/index.ts";
import { AccountBindingError, openAccountBinding } from "./open-binding.ts";
import { isolatedStatementParser, StatementParseError, type SealedAccountBinding } from "./run.ts";

/**
 * Security review of #630 (NFR-01@PoC FR 6, ARC-06@PoC FR 2): the paths of the field opener that the PR's own tests
 * do not reach. Keys and values are synthetic and made at runtime.
 */
const FIELD = "importRecipes.accountValue";
const VALUE = ["UA", "00", "000000", "0000000", "123456", "987654"].join("");
const file = new TextEncoder().encode(
  [`Рахунок;${VALUE}`, "Дата;Сума;Валюта;Опис", "01.03.2026;-120,50;EUR;Кава"].join("\n"),
);

function binding(by = "iban"): { binding: SealedAccountBinding; opener: FieldOpener } {
  const householdId = randomUUID();
  const raw = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", raw, iv);
  cipher.setAAD(Buffer.from(`household:${householdId}|field:${FIELD}`, "utf8"));
  const body = Buffer.concat([cipher.update(VALUE, "utf8"), cipher.final()]);
  const sealedValue = "ws1." + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  const key = new ArrayBuffer(32);
  new Uint8Array(key).set(raw);
  const opener: FieldOpener = { householdId, field: FIELD, key };
  return { binding: { by: by as SealedAccountBinding["by"], sealedValue, opener }, opener };
}

const gone = (opener: FieldOpener): boolean =>
  opener.key.byteLength === 0 || new Uint8Array(opener.key).every((b) => b === 0);

describe("NFR-01@PoC FR 6: the opener's key never stays in the API thread", () => {
  it("NFR-01@PoC FR 6: the hand-made binding works (the probe is sound)", async () => {
    const b = binding();
    expect((await isolatedStatementParser().parse(file, {}, {}, b.binding)).account).toEqual({
      by: "iban",
      status: "match",
    });
    expect(b.opener.key.byteLength).toBe(0);
  });

  it("NFR-01@PoC FR 6: the key is wiped when the file's bytes cannot be copied (before any worker)", async () => {
    const b = binding();
    const bad = {
      get length(): number {
        throw new RangeError("Array buffer allocation failed");
      },
    } as unknown as Uint8Array;
    await expect(isolatedStatementParser().parse(bad, {}, {}, b.binding)).rejects.toBeDefined();
    expect(gone(b.opener)).toBe(true);
  });

  it("NFR-01@PoC FR 6: the key is wiped when the worker cannot be started (data that cannot be cloned)", async () => {
    const b = binding();
    const options = { encoding: () => "utf-8" } as never;
    await expect(isolatedStatementParser().parse(file, options, {}, b.binding)).rejects.toBeDefined();
    expect(gone(b.opener)).toBe(true);
  });

  it("NFR-01@PoC FR 6: a binding of an unknown kind is refused and its key wiped", async () => {
    const b = binding("header-pattern");
    await expect(isolatedStatementParser().parse(file, {}, {}, b.binding)).rejects.toMatchObject({
      code: "ACCOUNT_BINDING",
    });
    expect(gone(b.opener)).toBe(true);
  });

  it("NFR-01@PoC FR 6: a worker that never answers leaves no key here and the parse is refused, not unbound", async () => {
    const b = binding();
    const spin = new URL("../../../../../test/fixtures/file-storage/spin-worker.ts", import.meta.url);
    const err = await isolatedStatementParser({ timeoutMs: 500, workerUrl: spin })
      .parse(file, {}, {}, b.binding)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatementParseError);
    expect(gone(b.opener)).toBe(true);
  });

  it("NFR-01@PoC FR 6: a worker that crashes at once leaves no key here", async () => {
    const b = binding();
    const missing = new URL("./no-such-worker.ts", import.meta.url);
    const err = await isolatedStatementParser({ workerUrl: missing })
      .parse(file, {}, {}, b.binding)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatementParseError);
    expect(JSON.stringify(err) + String((err as Error).stack)).not.toContain(VALUE.slice(0, -4));
    expect(gone(b.opener)).toBe(true);
  });
});

describe("NFR-01@PoC FR 6: the worker wipes the key once the value is opened, and fails closed", () => {
  it("NFR-01@PoC FR 6: the key is zeroed after the value is opened", () => {
    const b = binding();
    expect(openAccountBinding(b.binding)).toEqual({ by: "iban", value: VALUE });
    expect(b.opener.key.byteLength).toBe(32);
    expect(new Uint8Array(b.opener.key).every((x) => x === 0)).toBe(true);
    expect(openAccountBinding(undefined)).toBeUndefined();
  });

  it("NFR-01@PoC FR 6: the key is zeroed when the value cannot be opened, and the error holds nothing", () => {
    const b = binding();
    const other = binding();
    let error: unknown;
    try {
      openAccountBinding({ ...b.binding, sealedValue: other.binding.sealedValue });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AccountBindingError);
    expect((error as Error).message).toBe("");
    expect((error as Error).cause).toBeUndefined();
    expect(new Uint8Array(b.opener.key).every((x) => x === 0)).toBe(true);
  });

  it("NFR-01@PoC FR 6: an answer without the binding's outcome is refused as ACCOUNT_BINDING", async () => {
    const b = binding();
    const unbound = new URL("../../../../../test/fixtures/file-storage/unbound-worker.ts", import.meta.url);
    await expect(
      isolatedStatementParser({ workerUrl: unbound }).parse(file, {}, {}, b.binding),
    ).rejects.toMatchObject({ code: "ACCOUNT_BINDING" });
    await expect(isolatedStatementParser({ workerUrl: unbound }).parse(file)).resolves.toMatchObject({
      account: null,
    });
  });
});

describe("IMP-06@PoC FR 1: masked cards are found as before, in one pass", () => {
  it("IMP-06@PoC FR 1: the binding by mask gives the same outcome as the single pattern on random preambles", () => {
    const old = /[\d*xX•]*[*xX•][\d*xX•]*\d{4}/g;
    const alphabet = ["1", "2", "3", "4", "*", "x", "•", " ", "a", "-", ";"];
    let seed = 630;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const sameMaskOld = (a: string, c: string): boolean => {
      if (!/\d{4}$/.test(a) || !/\d{4}$/.test(c)) return false;
      for (let i = 1; i <= Math.min(a.length, c.length); i++) {
        const x = a[a.length - i]!;
        const y = c[c.length - i]!;
        if (/\d/.test(x) && /\d/.test(y) && x !== y) return false;
      }
      return true;
    };
    for (let n = 0; n < 4000; n++) {
      const cell = Array.from(
        { length: 1 + Math.floor(next() * 24) },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join("");
      const want = ["**1234", "4321", "*2*1234"][n % 3]!;
      const compact = cell
        .normalize("NFKC")
        .replace(/[\s-]+/g, "")
        .toUpperCase();
      const masks = compact.match(old) ?? [];
      const expected = masks.some((m) => sameMaskOld(m, want.toUpperCase()))
        ? "match"
        : masks.length > 0
          ? "mismatch"
          : "not-found";
      expect(matchAccount([[cell]], "mask", want).status, JSON.stringify(cell)).toBe(expected);
    }
  });
});

describe("ARC-06@PoC FR 4: the account binding stays within the worker's time on a hostile preamble", () => {
  it("ARC-06@PoC FR 4: cells of mask marks, digits and letters at the cell ceiling are matched in bounded time", () => {
    const started = performance.now();
    matchAccount([["*".repeat(32_768)], ["x".repeat(32_768)], ["1".repeat(32_768)]], "mask", "**** 1234");
    matchAccount([["1 ".repeat(16_000)]], "account-number", "2600 1234 5678");
    matchAccount([["A".repeat(32_768)]], "iban", VALUE);
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 120_000);
});
