import { describe, expect, it } from "vitest";
import { maskNumbers } from "./routes.ts";

/**
 * Security review of #639: the rows answer masks an IBAN or a card number in a bank's text to its last 4 characters
 * (IMP-05@PoC «Бізнес-правила»; lead decision 2026-11-20, item 6) however the bank printed it. Synthetic values, built
 * at run time.
 */
const iban = ["UA", "00", "111111", "0000000", "222222", "334821"].join("");
const grouped = iban.replace(/(.{4})/g, "$1 ").trim();
const card = ["4111", "1111", "2222", "3334"];
const digitsOf = (text: string | null) => (text ?? "").normalize("NFKC").replace(/[^0-9A-Za-z]/g, "");

describe("IMP-05@PoC «Бізнес-правила»: an IBAN or a card number in a bank's text shows only its last 4 characters", () => {
  it.each([
    ["groups split by no-break spaces", grouped.replaceAll(" ", " ")],
    ["groups split by narrow no-break spaces", grouped.replaceAll(" ", " ")],
    ["groups split by two spaces", grouped.replaceAll(" ", "  ")],
    ["groups split by dots", grouped.replaceAll(" ", ".")],
    ["glued to a label", `IBAN${iban}`],
    ["after an underscore", `PAY_${iban}_X`],
    ["full-width letters", `ＵＡ${iban.slice(2)}`],
  ])("IMP-05@PoC «Бізнес-правила»: an IBAN with %s is masked", (_, printed) => {
    const shown = maskNumbers(`Переказ на ${printed} від Олени`);
    expect(digitsOf(shown)).not.toContain(iban.slice(8, 20));
    expect(shown).toContain("…");
  });

  it.each([
    ["groups split by no-break spaces", card.join(" ")],
    ["glued to a letter", `N${card.join("")}`],
  ])("IMP-05@PoC «Бізнес-правила»: a card number with %s is masked", (_, printed) => {
    const shown = maskNumbers(`Картка ${printed}, кава`);
    expect(digitsOf(shown)).not.toContain(card.join("").slice(0, 12));
    expect(shown).toContain("…3334");
  });

  it("IMP-05@PoC «Бізнес-правила»: dates, amounts and short numbers of a text stay as printed", () => {
    for (const text of [
      "Кава 120,50 о 10:15, чек 12345",
      "Виписка за період 01.03.2026-31.03.2026",
      "Оплата 15.03.2026 14.03.2026 рахунок 4521",
      "Договір № 2600123456 від 01.02.2026",
    ])
      expect(maskNumbers(text)).toBe(text);
  });
});
