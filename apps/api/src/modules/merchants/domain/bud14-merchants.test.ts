import { describe, expect, it } from "vitest";
import {
  mergeIssue,
  merchantInitials,
  merchantKey,
  merchantName,
  normalizeDescription,
  type Merchant,
} from "./index.ts";

/** BUD-14@PoC a) (wave 2 row 22): the merchant of a bank description — pure rules. Descriptions are synthetic. */

describe("BUD-14@PoC FR 1: the merchant is the counterparty's name cleaned deterministically from the bank description", () => {
  it("BUD-14@PoC AC1: «SUMUP *STARBUCKS 1234 MADRID ES» is the merchant «Starbucks» — no terminal prefix, store number, city or country", () => {
    expect(normalizeDescription("SUMUP *STARBUCKS 1234 MADRID ES")).toEqual({
      name: "Starbucks",
      key: "starbucks",
      channel: null,
      intermediary: false,
    });
    expect(normalizeDescription("STARBUCKS COFFEE 0042 LISBOA PT")?.name).toBe("Starbucks Coffee");
  });

  it("BUD-14@PoC FR 1: terminal prefixes, card masks and legal forms are dropped; the same description always gives the same merchant", () => {
    expect(normalizeDescription("SQ *BLUE BOTTLE 88231")?.name).toBe("Blue Bottle");
    expect(normalizeDescription("POS SILPO 1234")?.name).toBe("Silpo");
    expect(normalizeDescription("Покупка: АТБ-МАРКЕТ 0731 Київ")?.name).toBe("АТБ-Маркет");
    expect(normalizeDescription("OKKO **1234")?.name).toBe("Okko");
    expect(normalizeDescription("XXXX4321 NOVA POSHTA")?.name).toBe("Nova Poshta");
    expect(normalizeDescription("444111******1234 ROZETKA")?.name).toBe("Rozetka");
    expect(normalizeDescription('ТОВ "РОМАШКА"')?.name).toBe("Ромашка");
    expect(normalizeDescription("ФОП Синтетичний")?.name).toBe("Синтетичний");
    expect(normalizeDescription("Acme Widgets GmbH")?.name).toBe("Acme Widgets");
    expect(normalizeDescription("BOXX 12 BAR")?.name).toBe("Boxx 12 BAR");
    // Short all-capitals names stay as written; mixed case is the user's own spelling and stays.
    expect(normalizeDescription("ATB 0042")?.name).toBe("ATB");
    expect(normalizeDescription("Кав'ярня Синтетика")?.name).toBe("Кав'ярня Синтетика");
    const once = normalizeDescription("SUMUP *STARBUCKS 1234 MADRID ES");
    expect(normalizeDescription("SUMUP *STARBUCKS 1234 MADRID ES")).toEqual(once);
    // The match key ignores case and punctuation: these descriptions are one merchant.
    expect(normalizeDescription("Starbucks")?.key).toBe(once?.key);
    expect(normalizeDescription("POS STARBUCKS, 9981")?.key).toBe(once?.key);
  });

  it("BUD-14@PoC FR 1: no description, or one of numbers only, gives no merchant from nothing", () => {
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription("   ")).toBeNull();
    expect(normalizeDescription("**1234")).toBeNull();
    // Numbers only, no mask: the bank's text is kept as the name rather than guessed.
    expect(normalizeDescription("40817 2231")?.name).toBe("40817 2231");
  });

  it("BUD-14@PoC AC10: «PAYPAL *SPOTIFY 35314369001» — the merchant is «Spotify», the channel «PayPal»", () => {
    expect(normalizeDescription("PAYPAL *SPOTIFY 35314369001")).toEqual({
      name: "Spotify",
      key: "spotify",
      channel: "PayPal",
      intermediary: false,
    });
    expect(normalizeDescription("LIQPAY*SYNTH SHOP 12345")).toMatchObject({
      name: "Synth Shop",
      channel: "LiqPay",
    });
    // The recipient through an intermediary and directly is one merchant.
    expect(normalizeDescription("PAYPAL *SPOTIFY 35314369001")?.key).toBe(
      normalizeDescription("SPOTIFY")?.key,
    );
  });

  it("BUD-14@PoC AC11: «PAYPAL *1234567890» without a recipient — the merchant is «PayPal», marked «посередник»", () => {
    expect(normalizeDescription("PAYPAL *1234567890")).toEqual({
      name: "PayPal",
      key: "paypal",
      channel: "PayPal",
      intermediary: true,
    });
    expect(normalizeDescription("WESTERN UNION 998877")).toMatchObject({
      name: "Western Union",
      intermediary: true,
    });
  });

  it("BUD-14@PoC EC6: the channel comes from the description, not from the merchant's name — a rename keeps it", () => {
    // A rename changes the merchant's row only (application layer); the description, and so the channel, stay.
    expect(normalizeDescription("PAYPAL *1234567890")?.channel).toBe("PayPal");
    expect(merchantName("Платежі PayPal")).toBe("Платежі PayPal");
  });
});

describe("BUD-14@PoC FR 2: every merchant is shown with initials on a grey disc, no logos", () => {
  it("BUD-14@PoC AC13: «ТОВ Ромашка» has the initials «ТР», «Starbucks» — «S»", () => {
    expect(merchantInitials("ТОВ Ромашка")).toBe("ТР");
    expect(merchantInitials("Starbucks")).toBe("S");
    expect(merchantInitials("blue bottle coffee")).toBe("BB");
    expect(merchantInitials("«Сільпо»")).toBe("С");
  });
});

describe("BUD-14@PoC FR 3: rename and merge of merchants", () => {
  const merchant = (id: string, mergedInto: string | null = null): Merchant => ({
    id,
    key: merchantKey(id),
    name: id,
    intermediary: false,
    mergedInto,
    version: 1,
  });

  it("BUD-14@PoC FR 3: a new name is one line of 1–100 characters", () => {
    expect(merchantName("  Сільпо  ")).toBe("Сільпо");
    expect(merchantName("")).toBeNull();
    expect(merchantName("   ")).toBeNull();
    expect(merchantName("***")).toBeNull();
    expect(merchantName("Два\nрядки")).toBeNull();
    expect(merchantName("я".repeat(100))).toBe("я".repeat(100));
    expect(merchantName("я".repeat(101))).toBeNull();
  });

  it("BUD-14@PoC FR 3: a merchant joins another that joined none; itself or a merged one is refused", () => {
    expect(mergeIssue(merchant("a"), merchant("b"))).toBeNull();
    expect(mergeIssue(merchant("a"), merchant("a"))).toBe("same_merchant");
    expect(mergeIssue(merchant("a", "c"), merchant("b"))).toBe("merged");
    expect(mergeIssue(merchant("a"), merchant("b", "c"))).toBe("merged");
  });
});
