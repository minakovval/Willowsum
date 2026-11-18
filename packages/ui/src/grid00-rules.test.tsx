import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { AppShell } from "./shell/AppShell.tsx";
import { Icon } from "./icons/Icon.tsx";
import { IconButton } from "./icons/IconButton.tsx";
import { Skeleton } from "./skeleton/Skeleton.tsx";
import { EmptyState } from "./states/EmptyState.tsx";
import { ErrorState } from "./states/ErrorState.tsx";
import { TruncatedText } from "./tooltip/Tooltip.tsx";

/**
 * GRID-00@PoC general rules (part 2) on the components that carry them. jsdom has no layout: where a width decides, the
 * measured sizes are set from a simple model of the box, as in the other component tests.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});
const tooltip = () => document.querySelector<HTMLElement>(".ws-tooltip:not([hidden])");

describe("GRID-00@PoC FR 11: skip links", () => {
  const renderShell = () =>
    render(
      <I18nProvider>
        <AppShell
          sections={[
            {
              id: "planning",
              label: "Планування",
              icon: "planning",
              href: "#/planning/budget",
              pages: [{ id: "budget", label: "Бюджет", icon: "budget", href: "#/planning/budget" }],
            },
          ]}
          currentSectionId="planning"
          currentPageId="budget"
          brand={{ href: "#/planning/budget", label: "Willowsum, Бюджет" }}
          add={{ label: "Додати", items: [] }}
          profile={{ name: "Власник", space: "Мій простір", menuLabel: "Меню профілю", items: [] }}
        >
          <h1>Бюджет</h1>
        </AppShell>
      </I18nProvider>,
    );

  it("GRID-00@PoC FR 11: the first two links of the page skip to the content and to the navigation, and following them moves the focus", () => {
    const { container } = renderShell();
    // The two skip links come before everything else in the page, in this order (canvas wording).
    const first = [...container.querySelectorAll<HTMLAnchorElement>("a, button")].slice(0, 2);
    expect(first.map((a) => a.textContent)).toEqual(["Перейти до вмісту", "Перейти до навігації"]);
    expect(first.every((a) => a.classList.contains("ws-skip"))).toBe(true);

    fireEvent.click(first[0]!);
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(screen.getByRole("main").id).toBe(first[0]!.getAttribute("href")!.slice(1));

    fireEvent.click(first[1]!);
    const nav = screen.getByRole("navigation", { name: "Основна навігація" });
    expect(nav.id).toBe(first[1]!.getAttribute("href")!.slice(1));
    expect(nav.contains(document.activeElement)).toBe(true);
  });

  it("GRID-00@PoC FR 11: the main area can take the focus by program (tabindex −1) but is not a stop of its own", () => {
    renderShell();
    const main = screen.getByRole("main");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(within(main).getByRole("heading", { level: 1, name: "Бюджет" })).toBeTruthy();
  });
});

describe("GRID-00@PoC FR 16: parameters are sliders, not «…»", () => {
  const svgOf = (name: "options" | "more") => render(<Icon name={name} />).container.querySelector("svg")!;

  it("GRID-00@PoC FR 16: the parameters icon draws sliders (bars with knobs), the «…» glyph (three dots) is another icon", () => {
    const options = svgOf("options");
    expect(options.querySelectorAll("circle")).toHaveLength(0);
    // Three rails (`h`/`H` strokes) and their knobs (`v` strokes).
    const paths = [...options.querySelectorAll("path")].map((p) => p.getAttribute("d")!);
    expect(paths.filter((d) => /^M[\d.]+ [\d.]+[Hh]/.test(d)).length).toBeGreaterThanOrEqual(3);
    expect(paths.filter((d) => /^M[\d.]+ [\d.]+v/.test(d)).length).toBeGreaterThanOrEqual(3);
    cleanup();
    expect(svgOf("more").querySelectorAll("circle")).toHaveLength(3);
  });
});

describe("GRID-00@PoC AC9: a switch that does not fit is only an icon with a name and a tooltip", () => {
  it("GRID-00@PoC AC9, FR 15: the icon-only control has an accessible name, the same text as its tooltip on hover and on focus, and no visible label", () => {
    render(<IconButton icon="options" label="Параметри списку" />);
    const button = screen.getByRole("button", { name: "Параметри списку" });
    expect(button.textContent).toBe("");
    expect(button.classList.contains("ws-icon-button")).toBe(true);
    expect(button.querySelector(".ws-icon")!.getAttribute("aria-hidden")).toBe("true");
    fireEvent.mouseEnter(button);
    expect(tooltip()?.textContent).toBe("Параметри списку");
    fireEvent.mouseLeave(button);
    expect(tooltip()).toBeNull();
    fireEvent.focus(button);
    expect(tooltip()?.textContent).toBe("Параметри списку");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tooltip()).toBeNull();
  });
});

describe("GRID-00@PoC FR 24: the four states of a view", () => {
  it("GRID-00@PoC FR 24: loading is a skeleton that announces itself, empty explains and offers an action, error says «Помилка» and retries", () => {
    const retry = vi.fn();
    const act1 = vi.fn();
    const { container, unmount } = render(
      <I18nProvider>
        <Skeleton variant="row" lines={2} />
      </I18nProvider>,
    );
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelectorAll(".ws-skeleton-row")).toHaveLength(2);
    unmount();

    const empty = render(
      <I18nProvider>
        <EmptyState
          title="Рахунків ще немає"
          text="Додайте перший рахунок."
          primary={{ label: "Додати рахунок", onClick: act1 }}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Додати рахунок" }));
    expect(act1).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Додайте перший рахунок.")).toBeTruthy();
    empty.unmount();

    render(
      <I18nProvider>
        <ErrorState text="Не вдалося завантажити рахунки." onRetry={retry} />
      </I18nProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Помилка");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("GRID-00@PoC FR 18, AC5, EC2: a name takes at most two lines", () => {
  const LINE = 20;
  const BOX = 200;
  /**
   * The box of a name: 200 px wide, lines 20 px high. `textPx` is the width of the text on one line at full size;
   * at the `smaller` step it is 85 % of it; at the `two` step it wraps and the box shows at most two lines.
   */
  function layoutOf(textPx: number) {
    const fit = (el: HTMLElement) => el.dataset["fit"] ?? "one";
    const textWidth = (el: HTMLElement) => textPx * (fit(el) === "one" ? 1 : 0.85);
    const lines = (el: HTMLElement) => Math.max(1, Math.ceil(textWidth(el) / BOX));
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(BOX);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return fit(this) === "two" ? BOX : textWidth(this);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return fit(this) === "two" ? Math.min(2, lines(this)) * LINE : LINE;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return fit(this) === "two" ? lines(this) * LINE : LINE;
    });
  }
  const name = (text: string) => {
    const view = render(<TruncatedText text={text} maxLines={2} />);
    return { ...view, el: view.container.querySelector<HTMLElement>(".ws-truncate")! };
  };

  it("GRID-00@PoC FR 18, AC5: a short name stays on one line at full size, with no tooltip and no focus stop", () => {
    layoutOf(150);
    const { el } = name("Подушка");
    expect(el.dataset["fit"]).toBe("one");
    expect(el.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(el);
    fireEvent.focus(el);
    expect(tooltip()).toBeNull();
  });

  it("GRID-00@PoC FR 18: a name a little too long for one line goes to one line at 85 % — still no tooltip", () => {
    layoutOf(220);
    const { el } = name("Відпустка в Карпатах");
    expect(el.dataset["fit"]).toBe("smaller");
    expect(el.hasAttribute("tabindex")).toBe(false);
    fireEvent.mouseEnter(el);
    expect(tooltip()).toBeNull();
  });

  it("GRID-00@PoC FR 18: a name that needs two lines at 85 % takes two lines and is fully visible — no tooltip", () => {
    layoutOf(330);
    const { el } = name("Відпустка в Карпатах з дітьми влітку");
    expect(el.dataset["fit"]).toBe("two");
    expect(el.hasAttribute("tabindex")).toBe(false);
    fireEvent.focus(el);
    expect(tooltip()).toBeNull();
  });

  it("GRID-00@PoC AC5: a name longer than two lines is cut with an ellipsis, takes the focus, and its tooltip shows the full text on hover and focus", () => {
    layoutOf(700);
    const FULL =
      "Відпустка в Карпатах з дітьми влітку 2027 року, разом з бабусею і дідусем та їхніми друзями";
    const { el } = name(FULL);
    expect(el.dataset["fit"]).toBe("two");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.textContent).toBe(FULL);
    fireEvent.mouseEnter(el);
    expect(tooltip()?.textContent).toBe(FULL);
    fireEvent.mouseLeave(el);
    expect(tooltip()).toBeNull();
    fireEvent.focus(el);
    expect(tooltip()?.textContent).toBe(FULL);
  });

  it("GRID-00@PoC EC2: a long name without spaces is one unbroken string in the page, kept whole for the reader, and gets the same ladder", () => {
    layoutOf(900);
    const WORD = "Надзвичайнодовганазвабезжодногопробілудлятеступеренесення";
    const { el } = name(WORD);
    expect(el.textContent).toBe(WORD);
    expect(el.dataset["fit"]).toBe("two");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("GRID-00@PoC FR 18: when the box grows the name goes back up the ladder", () => {
    layoutOf(700);
    const { el, rerender } = name("Довга назва");
    expect(el.dataset["fit"]).toBe("two");
    layoutOf(150);
    act(() => void rerender(<TruncatedText text="Коротка" maxLines={2} />));
    expect(el.dataset["fit"]).toBe("one");
    expect(el.hasAttribute("tabindex")).toBe(false);
  });

  it("GRID-00@PoC FR 18: the default stays one line with an ellipsis — no ladder, no name class", () => {
    layoutOf(150);
    const view = render(<TruncatedText text="Назва" />);
    const el = view.container.querySelector<HTMLElement>(".ws-truncate")!;
    expect(el.classList.contains("ws-truncate--name")).toBe(false);
    expect(el.hasAttribute("data-fit")).toBe(false);
  });
});
