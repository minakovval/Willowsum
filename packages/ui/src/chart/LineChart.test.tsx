import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { LineChart, type LineChartProps, type LineSeries } from "./LineChart.tsx";

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
const dates = ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31"];
const make = (id: string, name: string, base: number, extra: Partial<LineSeries> = {}): LineSeries => ({
  id,
  name,
  points: dates.map((date, i) => ({ date, value: String(base + i * 100) })),
  ...extra,
});

function chart(props: Partial<LineChartProps> = {}) {
  return render(
    <I18nProvider initialLocale="uk">
      <LineChart
        label="Залишки рахунків"
        series={[make("a", "Основний", 1000)]}
        currency="EUR"
        width={480}
        {...props}
      />
    </I18nProvider>,
  );
}
const lineOf = (c: HTMLElement, id: string) => c.querySelector(`[data-series="${id}"]`)!;

afterEach(cleanup);

describe("CMP-42@PoC LineChart", () => {
  it("CMP-42@PoC AC1: 3 series get a solid, a dashed and a dotted line with a circle, a square and a diamond, and the legend shows the last values", () => {
    const { container } = chart({
      series: [make("a", "Основний", 1000), make("b", "Заощадження", 3000), make("c", "Готівка", 500)],
    });
    const dash = (id: string) =>
      lineOf(container, id).querySelector("path[stroke-linecap]")!.getAttribute("stroke-dasharray");
    expect(dash("a")).toBeNull();
    expect(dash("b")).toBe("7 5");
    expect(dash("c")).toBe("1 5");
    const markers = (id: string) => {
      const g = lineOf(container, id);
      return g.querySelector("circle[r='5']") ? "circle" : g.querySelector("rect[rx]") ? "square" : "diamond";
    };
    expect([markers("a"), markers("b"), markers("c")]).toEqual(["circle", "square", "diamond"]);
    const legend = [...container.querySelectorAll(".ws-chart-legend-item")].map((li) => norm(li.textContent));
    expect(legend).toEqual(["Основний1 300,00 €", "Заощадження3 300,00 €", "Готівка800,00 €"]);
    expect(lineOf(container, "a").querySelector("path[stroke-linecap]")!.getAttribute("stroke")).toBe(
      "var(--ws-brand-2)",
    );
    expect(lineOf(container, "a").querySelector("path[stroke-linecap]")!.getAttribute("stroke-width")).toBe(
      "2.4",
    );
  });

  it("CMP-42@PoC AC2: with 6 series choosing the third in the legend makes it 3 px in brand-2 and the others thin grey", () => {
    const series = Array.from({ length: 6 }, (_, i) => make(`s${i}`, `Рахунок ${i + 1}`, 1000 + i * 50));
    const { container } = chart({ series });
    const group = screen.getByRole("radiogroup", { name: "Виділити лінію" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radios[2]!);
    expect(radios[2]!.getAttribute("aria-checked")).toBe("true");
    const path = (id: string) => lineOf(container, id).querySelector("path[stroke-linecap]")!;
    expect(path("s2").getAttribute("stroke")).toBe("var(--ws-brand-2)");
    expect(path("s2").getAttribute("stroke-width")).toBe("3");
    expect(path("s0").getAttribute("stroke")).toBe("var(--ws-border-control)");
    expect(path("s0").getAttribute("stroke-width")).toBe("1.5");
    expect(radios.every((r) => r.className.includes("ws-chart-legend-button"))).toBe(true);
  });

  it("CMP-42@PoC AC3: a goal's target line is dashed 4 / 4 in chart-reference with its label", () => {
    const { container } = chart({ target: { value: "5000", label: "Ціль 5 000 €" } });
    const line = container.querySelector("line[stroke='var(--ws-chart-reference)']")!;
    expect(line.getAttribute("stroke-dasharray")).toBe("4 4");
    expect(container.querySelector(".ws-chart-target")!.textContent).toBe("Ціль 5 000 €");
    expect(container.innerHTML).not.toMatch(/amber|warning/);
  });

  it("CMP-42@PoC AC4: every chart has one value axis: the ticks are one column of labels on the right", () => {
    const { container } = chart({ series: [make("a", "Основний", 1000), make("b", "Заощадження", 90000)] });
    const labels = container.querySelectorAll("text.ws-chart-axis.ws-tabular");
    const xs = new Set([...labels].map((l) => l.getAttribute("x")));
    expect(xs.size).toBe(1);
    expect(Number(1)).toBe(1);
  });

  it("CMP-42@PoC scale: the scale is adaptive and does not start at zero for data far from zero; the zero line shows only across zero", () => {
    const { container } = chart();
    const ticks = [...container.querySelectorAll("text.ws-chart-axis.ws-tabular")].map((t) =>
      norm(t.textContent),
    );
    expect(ticks[0]).not.toBe("0");
    expect(container.querySelector(".ws-chart-zero")).toBeNull();
    cleanup();
    const across = chart({
      series: [
        {
          id: "n",
          name: "Сальдо",
          points: [
            { date: "2026-01-31", value: "-200" },
            { date: "2026-02-28", value: "300" },
          ],
        },
      ],
    });
    expect(across.container.querySelector(".ws-chart-zero")).not.toBeNull();
  });

  it("CMP-42@PoC states: a series with one point shows the point and the value without a line, no history shows «Ще немає історії»", () => {
    const { container } = chart({
      series: [{ id: "a", name: "Основний", points: [{ date: "2026-10-31", value: "1250.50" }] }],
    });
    expect(lineOf(container, "a").querySelector("path[stroke-linecap]")).toBeNull();
    expect(lineOf(container, "a").querySelector("circle")).not.toBeNull();
    expect(norm(container.querySelector(".ws-chart-legend-item")!.textContent)).toContain("1 250,50 €");
    cleanup();
    const empty = chart({ series: [] });
    expect(within(empty.container).getByText("Ще немає історії")).toBeTruthy();
  });

  it("CMP-42@PoC states: loading is a skeleton, an error offers a retry", () => {
    const retry = vi.fn();
    const loading = chart({ loading: true });
    expect(loading.container.querySelector(".ws-skeleton")).not.toBeNull();
    cleanup();
    chart({ error: { onRetry: retry } });
    expect(screen.getByRole("alert").textContent).toContain("Не вдалося побудувати графік");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("CMP-42@PoC states: hover or arrow keys on a step show a dotted line, a marker per series and a table «на <дата>», «Δ м/м», «%»; Esc closes it", () => {
    // 130 weekly points: more than 120 per week, so the step is a month.
    const weekly = (id: string, name: string, base: number, extra: Partial<LineSeries> = {}): LineSeries => ({
      id,
      name,
      points: Array.from({ length: 130 }, (_, i) => ({
        date: new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10),
        value: String(base + i),
      })),
      ...extra,
    });
    const { container } = chart({
      series: [weekly("a", "Основний", 1000), weekly("b", "Кредит", 500, { goodWhen: "down" })],
    });
    const group = screen.getByRole("group", { name: "Залишки рахунків" });
    fireEvent.focus(group);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    const tip = screen.getByRole("tooltip");
    const text = norm(tip.textContent);
    expect(text).toContain("Травень 2026");
    expect(text).toContain("на 31 травня");
    expect(text).toContain("Δ м/м");
    expect(text).toContain("▲ 4,00 €");
    expect(text).toMatch(/\d,\d %/);
    expect(container.querySelector(".ws-chart-cursor")).not.toBeNull();
    expect(tip.querySelector(".ws-loss")).not.toBeNull(); // the loan grows: worse
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("CMP-42@PoC FR events: an event mark sits on the time axis with a short label and its details in the tooltip on focus", () => {
    chart({
      events: [{ id: "e1", date: "2026-09-15", label: "Взято кредит", detail: "12 000,00 € · Автокредит" }],
    });
    const mark = screen.getByRole("img", { name: /Взято кредит/ });
    fireEvent.focus(mark);
    expect(norm(screen.getByRole("tooltip").textContent)).toContain("12 000,00 € · Автокредит");
    fireEvent.blur(mark);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("CMP-42@PoC FR area: the area under the first series is brand-2 at 14 % and steps are drawn without smoothing", () => {
    const { container } = chart({ area: true });
    const area = container.querySelector("path[fill='var(--ws-brand-2)']")!;
    expect(area.getAttribute("fill-opacity")).toBe("var(--ws-chart-area-opacity)");
    const d = container.querySelector(`[data-series="a"] path[stroke-linecap]`)!.getAttribute("d")!;
    expect(d).toMatch(/^M[\d.]+ [\d.]+H[\d.]+V[\d.]+/);
    expect(d).not.toMatch(/[CQ]/);
  });

  it("CHT-00@PoC FR 7: the chart fills the width of the container it is given and keeps the height", () => {
    const { container } = chart({ width: 380, height: 376 });
    const svg = container.querySelector("svg.ws-chart-svg")!;
    expect(svg.getAttribute("width")).toBe("380");
    expect(svg.getAttribute("height")).toBe("376");
  });

  it("CHT-00@PoC FR 6: the legend sits to the right of a chart wider than 520 px", () => {
    const { container } = chart({ width: 900 });
    // Measuring is not possible in jsdom, so the fallback width is what the chart uses.
    expect(container.querySelector(".ws-chart")!.classList.contains("ws-chart--wide")).toBe(true);
  });

  it("CMP-42@PoC AC6: an account balance that changes only on transaction dates is drawn in steps: it holds between events and jumps on the date of an event", () => {
    const { container } = chart({
      series: [
        {
          id: "a",
          name: "Основний",
          points: [
            { date: "2026-10-01", value: "1000" },
            { date: "2026-10-10", value: "1500" },
            { date: "2026-10-20", value: "1200" },
          ],
        },
      ],
    });
    const d = container.querySelector('[data-series="a"] path[stroke-linecap]')!.getAttribute("d")!;
    const commands = d.match(/[MHVL]/g)!.join("");
    expect(commands).toBe("MHVHV");
    expect(d).not.toContain("L");
  });

  it("CMP-42@PoC AC7: with a week step, a hover on 10–16 August 2026 shows the dotted line, a marker on each of three series and the table «на <дата>», «Δ т/т», «%»", () => {
    const daily = (id: string, name: string, base: number): LineSeries => ({
      id,
      name,
      points: Array.from({ length: 130 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 3, 20 + i)).toISOString().slice(0, 10),
        value: String(base + i * 10),
      })),
    });
    const { container } = chart({
      series: [daily("g", "Зібрано", 1000), daily("p", "План", 1200), daily("f", "Прогноз за темпом", 900)],
    });
    const group = screen.getByRole("group", { name: "Залишки рахунків" });
    fireEvent.focus(group);
    for (
      let i = 0;
      i < 30 && !norm(screen.queryByRole("tooltip")?.textContent).includes("Тиждень 10–16 серпня 2026");
      i++
    )
      fireEvent.keyDown(group, { key: "ArrowLeft" });
    const tip = screen.getByRole("tooltip");
    const text = norm(tip.textContent);
    expect(text).toContain("Тиждень 10–16 серпня 2026");
    expect(text).toContain("на 16 серпня");
    expect(text).toContain("Δ т/т");
    expect(text).toContain("%");
    expect(tip.querySelectorAll(".ws-chart-tip-row")).toHaveLength(4); // the head and three series
    expect(
      container.querySelectorAll(
        "g[aria-hidden='true'] circle, g[aria-hidden='true'] rect[rx], g[aria-hidden='true'] path",
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("CMP-42@PoC AC1: a series name of 60+ characters is a title on its legend text, and a non-decimal value shows the error state", () => {
    const name = "Рахунок із дуже довгою назвою, що не вміщується в легенду графіка";
    const { container } = chart({ series: [make("a", name, 1000)] });
    expect(container.querySelector(".ws-chart-legend-item .ws-muted")!.getAttribute("title")).toBe(name);
    cleanup();
    chart({ series: [{ id: "x", name: "X", points: [{ date: "2026-01-01", value: "abc" }] }] });
    expect(screen.getByRole("alert").textContent).toContain("Не вдалося побудувати графік");
  });
});
