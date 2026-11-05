import { render } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { HideAmountsProvider } from "../privacy/HideAmounts.tsx";
import { FitAmount } from "./FitAmount.tsx";

const norm = (s: string | null) => (s ?? "").replace(/&nbsp;|\u00A0|\u202F/g, " ");

function wrap(ui: ReactNode, hidden = false) {
  return (
    <I18nProvider>
      <HideAmountsProvider initialHidden={hidden}>{ui}</HideAmountsProvider>
    </I18nProvider>
  );
}

describe("FitAmount (CMP-07)", () => {
  it("shows a new value immediately after the value changes", () => {
    const { container, rerender } = render(wrap(<FitAmount value="€ 1,00" compact={null} />));
    expect(norm(container.textContent)).toContain("€ 1,00");
    rerender(wrap(<FitAmount value="€ 2,00" compact={null} />));
    expect(norm(container.textContent)).toContain("€ 2,00");
    expect(norm(container.textContent)).not.toContain("€ 1,00");
  });

  it("does not put the real value in the DOM while amounts are hidden", () => {
    const { container } = render(wrap(<FitAmount value="€ 48 250,40" compact="48,25 тис. €" />, true));
    expect(norm(container.innerHTML)).not.toContain("48 250");
    expect(norm(container.innerHTML)).not.toContain("48,25");
  });
});
