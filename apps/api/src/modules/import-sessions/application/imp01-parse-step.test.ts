import { describe, expect, it } from "vitest";
import type { StatementChecks } from "../../file-parsers/index.ts";
import { batchStateAfterParse, PARSE_FILES_PER_HOUR, takesParse } from "../domain/index.ts";
import { maskNumbers } from "../adapters/http/routes.ts";
import { maskedChecks } from "./decisions.ts";
import { parseRefusal } from "./parse.ts";

/** The parse step's pure rules: the batch's state after the parse, the masked evidence, the refusal texts. */
const parsed = (needsReview = false) => ({ state: "parsed" as const, needsReview });
const failed = { state: "failed" as const, needsReview: false };

describe("IMP-01@PoC FR 10: the batch's state once every file is parsed", () => {
  it("IMP-01@PoC FR 10: every file parsed with nothing to review — «розібрано»; anything to review — «потребує перегляду»", () => {
    expect(batchStateAfterParse([parsed(), parsed()])).toBe("parsed");
    expect(batchStateAfterParse([parsed(), parsed(true)])).toBe("needs-review");
  });

  it("IMP-01@PoC FR 6: every accepted file refused — «не вдалося розібрати»; some refused — «потребує перегляду»", () => {
    expect(batchStateAfterParse([failed, failed])).toBe("failed");
    expect(batchStateAfterParse([parsed(), failed])).toBe("needs-review");
  });

  it("IMP-19@PoC FR 5: while a file is pending the batch stays «в обробці»", () => {
    expect(batchStateAfterParse([parsed(), { state: "pending", needsReview: false }])).toBeNull();
    expect(batchStateAfterParse([])).toBeNull();
  });

  it("IMP-01@PoC FR 21: a parse starts from a new batch or again from a parsed or failed one, never from another state", () => {
    expect(["uploaded", "parsed", "needs-review", "failed"].every((s) => takesParse(s as never))).toBe(true);
    for (const s of ["processing", "applied", "rolled-back", "cancelled"])
      expect(takesParse(s as never)).toBe(false);
    expect(PARSE_FILES_PER_HOUR).toBe(200);
  });
});

describe("IMP-01@PoC FR 15: the reason a file could not be parsed", () => {
  it("IMP-01@PoC FR 15: file-storage's text for its codes, the parse step's own for the rest; an unknown code is «Файл пошкоджено»", () => {
    const storage = (code: string) =>
      code === "CORRUPTED" || code === "TOO_MANY_ROWS"
        ? { code, status: 422 as const, message: { uk: code, en: code } }
        : null;
    expect(parseRefusal("TOO_MANY_ROWS", storage).code).toBe("TOO_MANY_ROWS");
    expect(parseRefusal("FORMAT_NOT_PARSED", storage).message.uk).toContain("CSV");
    expect(parseRefusal("SOMETHING", storage).code).toBe("CORRUPTED");
  });
});

describe("IMP-05@PoC FR 4: the account evidence is masked at the boundary (#637 item 3)", () => {
  const checks = (reasons: StatementChecks["account"]["reasons"]) =>
    ({ account: { status: "mismatch", reasons }, flags: [] }) as unknown as StatementChecks;

  it("IMP-05@PoC FR 4: an IBAN or a card the parse left whole is cut to «…» and its last 4 characters", () => {
    const iban = ["UA", "21", "3223130000026007233566001"].join("");
    const out = maskedChecks(
      checks([
        { kind: "iban", file: iban, account: "…1190" },
        { kind: "card", file: "4111 1111 1111 1234", account: "…12345" },
        { kind: "currency", file: "USD", account: "not a code" },
      ]),
    );
    expect(out.account.reasons).toEqual([
      { kind: "iban", file: "…6001", account: "…1190" },
      { kind: "card", file: "…1234", account: "…2345" },
      { kind: "currency", file: "USD", account: "…code" },
    ]);
  });
});

describe("IMP-05@PoC EC3: the file's currencies are shown as codes", () => {
  const checks = (reasons: StatementChecks["account"]["reasons"]) =>
    ({ account: { status: "mismatch", reasons }, flags: [] }) as unknown as StatementChecks;

  it("IMP-05@PoC EC3: a file in two currencies other than the account's keeps both codes, not «… USD»", () => {
    const out = maskedChecks(
      checks([
        { kind: "currency", file: "EUR, USD", account: "UAH" },
        { kind: "currency", file: "EUR, USD; 4111 1111", account: "UAH" },
        { kind: "currency", file: Array.from({ length: 9 }, () => "USD").join(", "), account: "UAH" },
      ]),
    );
    expect(out.account.reasons).toEqual([
      { kind: "currency", file: "EUR, USD", account: "UAH" },
      { kind: "currency", file: "…1111", account: "UAH" },
      { kind: "currency", file: "… USD", account: "UAH" },
    ]);
  });
});

describe("IMP-05@PoC «Бізнес-правила»: numbers in a bank's text are masked in the rows' answer", () => {
  it("IMP-05@PoC «Бізнес-правила»: an IBAN or a card number in a description shows only its last 4 characters", () => {
    const iban = ["UA", "21", "3223130000026007233566001"].join("");
    expect(maskNumbers(`Переказ на ${iban} від Олени`)).toBe("Переказ на …6001 від Олени");
    expect(maskNumbers("Картка 4111 1111 1111 1234, кава")).toBe("Картка …1234, кава");
    expect(maskNumbers("Кава 120,50 о 10:15, чек 12345")).toBe("Кава 120,50 о 10:15, чек 12345");
    expect(maskNumbers(null)).toBeNull();
  });
});
