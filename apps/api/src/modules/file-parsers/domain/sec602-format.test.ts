import { describe, expect, it } from "vitest";
import { formatSignature, signatureText } from "./index.ts";

/** Security review of PR #602: what of the preamble reaches the format signature (AGENTS.md «Privacy»). */
describe("IMP-06@PoC FR 7: personal data and the format signature (security review)", () => {
  const table = [
    ["Дата", "Сума", "Опис"],
    ["01.02.2026", "-10,00", "Кава"],
    ["02.02.2026", "-12,00", "Чай"],
  ];
  const text = (preamble: string[][]) => signatureText(formatSignature([...preamble, ...table])!);

  it("IMP-06@PoC FR 7: of a «key: value» line only the key is a label", () => {
    const signature = formatSignature([
      ["Клієнт: Тестенко Тест"],
      ["Рахунок: UA00 Тестенко Тест"],
      ...table,
    ])!;
    expect(signature.labels).toEqual(["клієнт", "рахунок"]);
  });

  // Defect at 652ddc57: the first cell of any preamble line of several cells is a label, so a client's name, address
  // or e-mail written beside the account number enters the signature (and two clients of one bank get different
  // fingerprints). With the patch (labels only from «key:») this passes (fixed in review round 1; was `it.fails`).
  it("IMP-06@PoC FR 7: a client's name beside the account number is not a label", () => {
    const a = text([["Тестенко Тест Тестович", "UA000000000000000000000000001"]]);
    const b = text([["Зразкова Зоя Зіновіївна", "UA000000000000000000000000002"]]);
    expect(a).not.toContain("тестенко");
    expect(text([["test.testenko@example.com", "380000000000"]])).not.toContain("testenko");
    expect(b).toBe(a);
  });
});
