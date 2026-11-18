import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { Delta } from "./amount/Delta.tsx";
import { FitAmount } from "./amount/FitAmount.tsx";
import { formatCompactAmount } from "./amount/compact.ts";
import { HideAmountsProvider } from "./privacy/HideAmounts.tsx";
import { StatusMark } from "./status/StatusMark.tsx";
import { STATUS_DICTIONARY, statusEntry } from "./status/dictionary.ts";
import { Icon } from "./icons/Icon.tsx";
import { iconSizes } from "./tokens/index.ts";
import { TruncatedText } from "./tooltip/Tooltip.tsx";

/**
 * GRID-00@PoC general rules of the elements, on the components that carry them. jsdom has no layout: where a width
 * decides (a cut-off name, an amount that does not fit) the measured sizes are set, as in the other component tests.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ").trim();
const tooltip = () => document.querySelector(".ws-tooltip");

describe("GRID-00@PoC FR 17: a tooltip only for what is not fully visible", () => {
  it("GRID-00@PoC FR 17: cut-off text takes focus and shows its full text on hover and on focus; fully visible text has no tooltip and no focus", () => {
    const FULL = "Відпустка в Карпатах з дітьми влітку 2027 року";
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(120);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(360);
    const { unmount, container } = render(<TruncatedText text={FULL} />);
    const cut = container.querySelector<HTMLElement>(".ws-truncate")!;
    expect(cut.getAttribute("tabindex")).toBe("0");
    fireEvent.mouseEnter(cut);
    expect(tooltip()?.textContent).toBe(FULL);
    fireEvent.mouseLeave(cut);
    fireEvent.focus(cut);
    expect(tooltip()?.textContent).toBe(FULL);
    unmount();

    scroll.mockReturnValue(120);
    const fits = render(<TruncatedText text="Подушка" />);
    const whole = fits.container.querySelector<HTMLElement>(".ws-truncate")!;
    expect(whole.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(whole);
    fireEvent.focus(whole);
    expect(tooltip()).toBeNull();
  });
});

describe("GRID-00@PoC FR 19, AC6: amounts never wrap or get an ellipsis", () => {
  const boxed = (width: number) => {
    // 10 px a character, so the full value (18 characters) does not fit the box and the abbreviation does only when it is narrow enough.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return {
        width: (this.textContent ?? "").length * 10 * (parseFloat(this.style.fontSize) || 1),
      } as DOMRect;
    });
  };
  const amount = () => (
    <I18nProvider>
      <HideAmountsProvider>
        <div>
          <FitAmount
            value="12 345 678 901,00 €"
            compact={formatCompactAmount({ value: "12345678901.00", currency: "€", locale: "uk" })}
          />
        </div>
      </HideAmountsProvider>
    </I18nProvider>
  );

  it("GRID-00@PoC AC6: 12 345 678 901,00 € in a narrow card is «12,35 млрд €», in tabular figures, with the full value in the tooltip and for the screen reader", () => {
    boxed(130);
    const { container } = render(amount());
    const shown = container.querySelector<HTMLElement>(".ws-amount")!;
    expect(norm(shown.textContent)).toBe("12,35 млрд €");
    expect(shown.classList.contains("ws-tabular")).toBe(true);
    const fit = container.querySelector<HTMLElement>(".ws-amount-fit")!;
    // The abbreviated amount is the one that takes focus (so the keyboard reaches the tooltip) and says the full value.
    expect(fit.getAttribute("tabindex")).toBe("0");
    expect(norm(container.querySelector(".ws-visually-hidden")?.textContent)).toBe("12 345 678 901,00 €");
    fireEvent.mouseEnter(fit);
    expect(norm(tooltip()?.textContent)).toBe("12 345 678 901,00 €");
  });

  it("GRID-00@PoC FR 19: an amount that fits stays in full — no abbreviation, no tooltip, no focus stop", () => {
    boxed(400);
    const { container } = render(amount());
    expect(norm(container.querySelector(".ws-amount")!.textContent)).toBe("12 345 678 901,00 €");
    const fit = container.querySelector<HTMLElement>(".ws-amount-fit")!;
    expect(fit.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(fit);
    expect(tooltip()).toBeNull();
  });

  it("GRID-00@PoC FR 19: the abbreviation is rounded from the decimal string without floats — «12,35 млрд», a thousand stays «тис.»", () => {
    expect(norm(formatCompactAmount({ value: "12345678901.00", currency: "€", locale: "uk" }))).toBe(
      "12,35 млрд €",
    );
    expect(norm(formatCompactAmount({ value: "-1234567.00", currency: "€", locale: "uk" }))).toBe(
      "−1,23 млн €",
    );
    expect(norm(formatCompactAmount({ value: "48250.40", currency: "€", locale: "uk" }))).toBe(
      "48,25 тис. €",
    );
    expect(formatCompactAmount({ value: "999.99", currency: "€", locale: "uk" })).toBeNull();
  });
});

describe("GRID-00@PoC FR 20, FR 21, AC7: status and change are never colour alone", () => {
  it("GRID-00@PoC FR 20, AC7: «Прострочено» shows its marker and its word, and is named «Статус: …» for the screen reader", () => {
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <StatusMark id="d.overdue" params={{ days: "5" }} />
      </I18nProvider>,
    );
    const marker = statusEntry("d.overdue").marker;
    expect(marker).toBe("!");
    const visible = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => norm(n.textContent));
    expect(visible).toContain(marker);
    expect(visible.some((t) => t.startsWith("Прострочено"))).toBe(true);
    expect(norm(container.querySelector(".ws-visually-hidden")!.textContent)).toBe(
      "Статус: Прострочено на 5 днів",
    );
  });

  it("GRID-00@PoC FR 20: a loss-toned status («перевищено») always has the marker «✕» with its word; with the marker taken away the dictionary has no such entry", () => {
    const entry = statusEntry("a.over");
    expect(entry).toMatchObject({ tone: "negative", ink: "loss", marker: "✕" });
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <StatusMark id="a.over" />
      </I18nProvider>,
    );
    const visible = [...container.querySelectorAll('[aria-hidden="true"]')].map((n) => norm(n.textContent));
    expect(visible).toEqual(["✕", "перевищено"]);
    // No dictionary entry is shown by colour alone: every one has a marker or, if it has none, is the explicit «no marker» entry.
    expect(STATUS_DICTIONARY.every((e) => e.marker !== undefined && e.marker !== null)).toBe(true);
  });

  it("GRID-00@PoC FR 21: a gain and a loss carry an arrow beside their colour, and the screen reader hears the direction", () => {
    const { container } = render(
      <I18nProvider initialLocale="uk">
        <HideAmountsProvider>
          <Delta percent="2.4" period="month" />
          <Delta percent="-3.1" period="month" />
        </HideAmountsProvider>
      </I18nProvider>,
    );
    const [up, down] = [...container.querySelectorAll<HTMLElement>(".ws-delta")];
    expect([up!.dataset["direction"], down!.dataset["direction"]]).toEqual(["up", "down"]);
    expect(up!.className).toContain("ws-gain");
    expect(down!.className).toContain("ws-loss");
    expect(norm(up!.querySelector('[aria-hidden="true"]')!.textContent)).toMatch(/^▲ /);
    expect(norm(down!.querySelector('[aria-hidden="true"]')!.textContent)).toMatch(/^▼ /);
    expect(norm(up!.querySelector(".ws-visually-hidden")!.textContent)).toMatch(/зросло/);
    expect(norm(down!.querySelector(".ws-visually-hidden")!.textContent)).toMatch(/знизилось/);
  });
});

describe("GRID-00@PoC FR 29: one set of line icons", () => {
  it("GRID-00@PoC FR 29: the sizes are 16, 20, 24, 32 and 40; the icon is drawn at the size asked; without a label it is decorative and hidden from the screen reader, with one it is an image with that name", () => {
    expect(iconSizes).toEqual([16, 20, 24, 32, 40]);
    const { container } = render(
      <>
        {iconSizes.map((size) => (
          <Icon key={size} name="budget" size={size} />
        ))}
        <Icon name="budget" size={24} label="Бюджет" />
      </>,
    );
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.map((svg) => svg.getAttribute("width"))).toEqual(["16", "20", "24", "32", "40", "24"]);
    // All are line icons on a 24 px grid: stroke, no fill.
    for (const svg of svgs) {
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("fill")).toBe("none");
      expect(svg.getAttribute("stroke")).toBe("currentColor");
    }
    const wrappers = [...container.querySelectorAll<HTMLElement>(".ws-icon")];
    expect(
      wrappers.slice(0, 5).every((w) => w.getAttribute("aria-hidden") === "true" && !w.hasAttribute("role")),
    ).toBe(true);
    expect(screen.getByRole("img", { name: "Бюджет" })).toBe(wrappers[5]);
  });
});
