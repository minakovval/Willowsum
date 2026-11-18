import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import { AmountField } from "../field/Field.tsx";
import { displayAmount } from "../field/amount.ts";
import { TransactionRow } from "./TransactionRow.tsx";

/** DS-04@PoC items 8 and 12 in `@willowsum/ui`: the transaction list and the rounded number. */
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
afterEach(cleanup);

describe("DS-04@PoC items", () => {
  it("DS-04@PoC FR 8: a list of transactions is one continuous list with the date in each row, no day groups", () => {
    const dates = ["2026-10-26", "2026-10-26", "2026-10-25", "2026-09-30"];
    const { container } = render(
      <I18nProvider>
        <HideAmountsProvider initialHidden={false}>
          <div role="list">
            {dates.map((date, i) => (
              <div role="listitem" key={i}>
                <TransactionRow
                  layout="table"
                  merchant={`Продавець ${i}`}
                  date={date}
                  amount={{ value: "-10.00", currency: "EUR" }}
                  withAsset={false}
                />
              </div>
            ))}
          </div>
        </HideAmountsProvider>
      </I18nProvider>,
    );
    const rows = [...container.querySelectorAll(".ws-tx-row")];
    expect(rows).toHaveLength(4);
    // Each row shows its own date in the event-date form, also when the previous row has the same day.
    expect(rows.map((r) => norm(r.querySelector(".ws-tx-when")?.textContent))).toEqual([
      expect.stringContaining("26 жовт. 2026 р."),
      expect.stringContaining("26 жовт. 2026 р."),
      expect.stringContaining("25 жовт. 2026 р."),
      expect.stringContaining("30 вер. 2026 р."),
    ]);
    // No day heading, separator or group between the rows.
    expect(
      container.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, [role='heading'], [role='separator'], hr, [role='group']",
      ),
    ).toHaveLength(0);
    expect(container.querySelector("[role='list']")!.children).toHaveLength(4);
  });

  it("DS-04@PoC FR 12: a number with more digits than shown is marked «≈» («≈ 0,33»); an exact one is not", () => {
    expect(displayAmount("uk", "0.3333", 2)).toEqual({ text: "0,33", approx: true });
    expect(displayAmount("uk", "0.33", 2)).toEqual({ text: "0,33", approx: false });
    expect(displayAmount("uk", "0.30", 2).approx).toBe(false);
    const { container } = render(
      <I18nProvider>
        <AmountField label="Сума" value="0.3333" currency="EUR" />
      </I18nProvider>,
    );
    expect(norm(container.querySelector("input")!.value)).toBe("≈ 0,33");
    cleanup();
    const exact = render(
      <I18nProvider>
        <AmountField label="Сума" value="0.33" currency="EUR" />
      </I18nProvider>,
    );
    expect(norm(exact.container.querySelector("input")!.value)).toBe("0,33");
  });
});
