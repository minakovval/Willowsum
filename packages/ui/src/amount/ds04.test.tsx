import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatMoney, formatNumber, I18nProvider, maskNumber, speakMoney } from "@willowsum/i18n";
import { Amount, HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import { formatCompactAmount, formatCompactNumber } from "./compact.ts";
import { Delta } from "./Delta.tsx";

/**
 * DS-04@PoC in `@willowsum/ui`: how amounts and changes reach the screen (styles, the spoken form, the
 * coloured change) and the abbreviated chart labels. The view: docs/requirements/ds/DS-04.poc.md.
 */
const NBSP = "\u00A0";
const plain = (s: string | null) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/components.css"),
  "utf8",
);
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

const ui = (node: React.ReactNode, hidden = false) =>
  render(
    <I18nProvider>
      <HideAmountsProvider initialHidden={hidden}>{node}</HideAmountsProvider>
    </I18nProvider>,
  );

describe("DS-04@PoC: amounts on the screen", () => {
  it("DS-04@PoC AC4: every amount has tabular figures and never breaks between the symbol and the number", () => {
    const amount = rule(".ws-amount");
    expect(amount).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(amount).toMatch(/white-space:\s*nowrap/);
    expect(rule(".ws-delta")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    // The formatter itself joins the symbol and the number with a no-break space.
    expect(formatMoney("uk", "128450", "EUR")).toBe(`128${NBSP}450,00${NBSP}€`);
    const { container } = ui(<Amount value={formatMoney("uk", "-42.1", "EUR")} />);
    expect(container.querySelector(".ws-amount")).not.toBeNull();
    expect(container.textContent).not.toMatch(/ /);
  });

  it("DS-04@PoC AC7: a screen reader reaching −5 EUR hears «мінус 5,00 євро»", () => {
    const { container } = ui(
      <Amount value={formatMoney("uk", "-5", "EUR")} spoken={speakMoney("uk", "-5", "EUR")} />,
    );
    const hidden = container.querySelector(".ws-amount [aria-hidden='true']");
    expect(plain(hidden?.textContent ?? null)).toBe("−5,00 €");
    expect(plain(container.querySelector(".ws-amount .ws-visually-hidden")!.textContent)).toBe(
      "мінус 5,00 євро",
    );
  });

  it("DS-04@PoC AC11: the card ending in 4417 shows «··4417» in the account list and in a transaction row", () => {
    const mask = maskNumber("0000 0000 0000 4417");
    render(
      <ul>
        <li>{mask}</li>
        <li>{mask}</li>
      </ul>,
    );
    expect(screen.getAllByText("··4417")).toHaveLength(2);
  });
});

describe("DS-04@PoC: abbreviated chart labels", () => {
  it("DS-04@PoC AC8: on a chart 128 400 is labelled «128,4 тис.» in Ukrainian", () => {
    expect(formatCompactNumber({ value: "128400", locale: "uk" })).toBe(`128,4${NBSP}тис.`);
    expect(formatCompactNumber({ value: "128400", locale: "en" })).toBe("128.4k");
  });

  it("DS-04@PoC AC9: 950 on a chart is not abbreviated", () => {
    expect(formatCompactNumber({ value: "950", locale: "uk" })).toBeNull();
    expect(formatCompactAmount({ value: "950", currency: "€", locale: "uk" })).toBeNull();
    expect(formatNumber("uk", "950")).toBe("950");
  });

  it("DS-04@PoC FR 11: axis tick labels drop trailing zeros («120 тис.»); other labels keep them", () => {
    expect(formatCompactNumber({ value: "120000", locale: "uk", axis: true })).toBe(`120${NBSP}тис.`);
    expect(formatCompactNumber({ value: "1500000", locale: "uk", axis: true })).toBe(`1,5${NBSP}млн`);
    expect(formatCompactNumber({ value: "120000", locale: "uk" })).toBe(`120,0${NBSP}тис.`);
    expect(plain(formatCompactNumber({ value: "12345678", locale: "uk" }))).toBe("12,35 млн");
    expect(plain(formatCompactNumber({ value: "9".repeat(25), locale: "uk", axis: true }))).toBe(
      "999+ квінтлн",
    );
  });
});

describe("DS-04@PoC: the change with an arrow", () => {
  it("DS-04@PoC AC10: +2,4 % over a month is «▲ 2,4 %» without «+», in gain, named «зросло»", () => {
    const { container } = ui(<Delta percent="2.4" />);
    const delta = container.querySelector(".ws-delta")!;
    expect(delta.classList.contains("ws-gain")).toBe(true);
    expect(plain(delta.querySelector("[aria-hidden='true']")!.textContent)).toBe("▲ 2,4 %");
    expect(delta.textContent).not.toContain("+");
    expect(delta.querySelector(".ws-visually-hidden")!.textContent).toContain("зросло");
  });

  it("DS-04@PoC AC12: savings rate 22 % against 24 % shows «▼ 2 п. п. м/м» without «−», in loss", () => {
    const { container } = ui(<Delta points="-2" period="month" />);
    const delta = container.querySelector(".ws-delta")!;
    expect(delta.classList.contains("ws-loss")).toBe(true);
    expect(plain(delta.querySelector("[aria-hidden='true']")!.textContent)).toBe("▼ 2 п. п. м/м");
    expect(delta.textContent).not.toContain("−");
    expect(delta.querySelector(".ws-visually-hidden")!.textContent).toContain("знизилось");
  });

  it("DS-04@PoC EC1: a zero change is «– 0,0 %» in ink-muted", () => {
    const { container } = ui(<Delta percent="0" />);
    const delta = container.querySelector(".ws-delta")!;
    expect(delta.classList.contains("ws-muted")).toBe(true);
    expect(plain(delta.querySelector("[aria-hidden='true']")!.textContent)).toBe("– 0,0 %");
    expect(delta.querySelector(".ws-visually-hidden")!.textContent).toBe("без змін");
  });

  it("DS-04@PoC AC14: «▲ 3 876 € · 1,4 % м/м» may break only after «·»: «▲ 3 876 € ·» / «1,4 % м/м»", () => {
    const { container } = ui(
      <Delta amount={{ value: "3876", currency: "EUR" }} percent="1.4" period="month" />,
    );
    const text = container.querySelector(".ws-delta [aria-hidden='true']")!.textContent!;
    // Break opportunities are the ordinary spaces only: after «·» (and before the period label, AC15).
    const fragments = text.split(" ");
    expect(fragments[0]).toBe(`▲${NBSP}3${NBSP}876${NBSP}€${NBSP}·`);
    expect(fragments.slice(1).join(" ")).toBe(`1,4${NBSP}%${" "}м/м`);
    expect(rule(".ws-delta")).toMatch(/white-space:\s*normal/);
  });

  it("DS-04@PoC AC15: «▼ 2 п. п. м/м» keeps «▼ 2 п. п.» together; only «м/м» may move to a new line", () => {
    const { container } = ui(<Delta points="-2" period="month" />);
    const text = container.querySelector(".ws-delta [aria-hidden='true']")!.textContent!;
    expect(text.split(" ")).toEqual([`▼${NBSP}2${NBSP}п.${NBSP}п.`, "м/м"]);
  });

  it("DS-04@PoC FR 4: a change with an amount speaks the amount in full; hidden amounts leave it out", () => {
    const { container } = ui(
      <Delta amount={{ value: "9900", currency: "EUR" }} percent="15" period="year" />,
    );
    expect(plain(container.querySelector(".ws-delta [aria-hidden='true']")!.textContent)).toBe(
      "▲ 9 900 € · 15,0 % р/р",
    );
    expect(plain(container.querySelector(".ws-delta .ws-visually-hidden")!.textContent)).toBe(
      "зросло на 9 900 євро, 15,0 % за рік",
    );
    const hidden = ui(<Delta amount={{ value: "9900", currency: "EUR" }} percent="15" period="year" />, true);
    const shown = hidden.container.querySelector(".ws-delta")!.textContent!;
    expect(plain(shown)).not.toContain("9 900");
    expect(plain(shown)).toContain("15,0 %");
  });

  it("DS-04@PoC FR 4: a change from a negative base renders with the amount's arrow instead of failing", () => {
    // Net worth from −10 000 € to −5 000 €: +5 000 € but −50 % of the base.
    const { container } = ui(
      <Delta amount={{ value: "5000", currency: "EUR" }} percent="-50" period="year" />,
    );
    const delta = container.querySelector(".ws-delta")!;
    expect(delta.classList.contains("ws-gain")).toBe(true);
    expect(plain(delta.querySelector("[aria-hidden='true']")!.textContent)).toBe("▲ 5 000 € р/р");
    expect(delta.textContent).not.toMatch(/[\u2212+]/);
    expect(delta.querySelector(".ws-visually-hidden")!.textContent).toContain("зросло");
  });
});
