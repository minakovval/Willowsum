import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { BarChart, type BarChartProps } from "./BarChart.tsx";

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ");
const months = ["лист.", "груд.", "січ.", "лют.", "бер.", "квіт."].map((label, i) => ({
  id: `m${i}`,
  label,
  full: ["листопад 2025", "грудень 2025", "січень 2026", "лютий 2026", "березень 2026", "квітень 2026"][i]!,
}));

function chart(props: Partial<BarChartProps> = {}) {
  return render(
    <I18nProvider initialLocale="uk">
      <BarChart
        label="Витрати за періодами"
        categories={months}
        series={[
          {
            id: "spent",
            name: "Витрати",
            values: ["2486.79", "3637.87", "2628.93", "2496.07", "3288.69", "2513.54"],
          },
        ]}
        currency="EUR"
        width={640}
        {...props}
      />
    </I18nProvider>,
  );
}

afterEach(cleanup);

const byName = (role: string, name: string) => screen.getByRole(role, { name: (n) => norm(n) === name });

describe("CMP-47@PoC BarChart", () => {
  it("CMP-47@PoC AC1: 8 series show 5 fills, the fifth hatched «Інші · 4»", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      name: `Серія ${i + 1}`,
      values: months.map(() => String((i + 1) * 100)),
    }));
    const { container } = chart({ series, legend: true });
    const legend = [...container.querySelectorAll(".ws-chart-legend-item")].map((li) => norm(li.textContent));
    expect(legend).toHaveLength(5);
    expect(legend[4]).toContain("Інші · 4");
    expect(container.querySelectorAll(".ws-chart-swatch--hatched")).toHaveLength(1);
    expect(container.querySelectorAll("pattern")).toHaveLength(1);
    // The four largest series stay apart (8, 7, 6, 5) and the rest are summed: 400 + 300 + 200 + 100 = 1 000 per column.
    expect(legend.slice(0, 4).join()).toContain("Серія 8");
    expect(legend[4]).toContain("1 000,00 €");
  });

  it("CMP-47@PoC AC2: a month with a negative balance goes below the zero line with its label under the column", () => {
    const { container } = chart({
      series: [{ id: "net", name: "Сальдо", values: ["500", "-300", "200", "100", "50", "20"] }],
    });
    expect(container.querySelector(".ws-chart-zero")).not.toBeNull();
    const zero = Number(container.querySelector(".ws-chart-zero")!.getAttribute("y1"));
    const bars = [...container.querySelectorAll<SVGGElement>(".ws-chart-bar")];
    const negative = bars[1]!.querySelector("path")!.getAttribute("d")!;
    const topOfNegative = Number(/^M[\d.]+ ([\d.]+)/.exec(negative)![1]);
    expect(topOfNegative).toBeCloseTo(zero, 0);
    const labels = [...container.querySelectorAll(".ws-chart-value")];
    const negativeLabel = labels.find((l) => norm(l.textContent).startsWith("−"))!;
    expect(Number(negativeLabel.getAttribute("y"))).toBeGreaterThan(zero);
  });

  it("CMP-47@PoC AC3: a single chart of 5 columns writes the value above each column", () => {
    const { container } = chart({
      categories: months.slice(0, 5),
      series: [{ id: "a", name: "Витрати", values: ["642.10", "10", "20", "30", "40"] }],
    });
    const values = [...container.querySelectorAll(".ws-chart-value")].map((v) => norm(v.textContent));
    expect(values).toHaveLength(5);
    expect(values[0]).toBe("642,10 €");
    // Six columns still have labels; seven do not.
    cleanup();
    const seven = chart({
      categories: [...months, { id: "x", label: "трав." }],
      series: [{ id: "a", name: "В", values: ["1", "2", "3", "4", "5", "6", "7"] }],
    });
    expect(seven.container.querySelectorAll(".ws-chart-value")).toHaveLength(0);
  });

  it("CMP-47@PoC AC4: a category name longer than its place is cut with an ellipsis and the tooltip shows it in full", () => {
    const long = "Дуже довга назва категорії, що не вміщується під стовпцем";
    const { container } = chart({
      width: 360,
      categories: [
        { id: "a", label: long },
        { id: "b", label: "Їжа" },
      ],
      series: [{ id: "s", name: "Витрати", values: ["10", "20"] }],
    });
    const axis = [...container.querySelectorAll(".ws-chart-axis")].map((n) => n.textContent ?? "");
    expect(axis.some((t) => t.endsWith("…") && t.length < long.length)).toBe(true);
    const hit = container.querySelectorAll(".ws-chart-hit")[0]!;
    fireEvent.pointerEnter(hit);
    expect(screen.getByRole("tooltip").textContent).toContain(long);
    cleanup();
    // A short name is not cut and has no tooltip when its value is shown and not abbreviated.
    const short = chart({
      categories: [{ id: "b", label: "Їжа" }],
      series: [{ id: "s", name: "В", values: ["20"] }],
    });
    fireEvent.pointerEnter(short.container.querySelectorAll(".ws-chart-hit")[0]!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("CMP-47@PoC states: loading is a skeleton of the chart's height, empty and error use the shared states, a retry is offered", () => {
    const retry = vi.fn();
    const loading = chart({ loading: true, height: 280 });
    expect(loading.container.querySelector(".ws-skeleton")).not.toBeNull();
    cleanup();
    const empty = chart({ categories: [], series: [] });
    expect(within(empty.container).getByText("Ще немає історії")).toBeTruthy();
    cleanup();
    chart({ error: { code: "req-42", onRetry: retry } });
    expect(screen.getByRole("alert").textContent).toContain("Помилка");
    expect(screen.getByRole("alert").textContent).toContain("Код: req-42");
    fireEvent.click(screen.getByRole("button", { name: "Спробувати ще раз" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("CMP-47@PoC states: a column is reachable by Tab with the name «серія, категорія, значення», focus opens the tooltip and Esc closes it", () => {
    const { container } = chart({
      series: [
        { id: "spent", name: "Витрати", values: ["3288.69", "1", "1", "1", "1", "1"] },
        { id: "goal", name: "з цілей", values: ["100", "1", "1", "1", "1", "1"], hatched: true },
      ],
      lines: [
        {
          id: "plan",
          name: "Бюджет",
          values: ["3000", "3000", "3000", "3000", "3000", "3000"],
          dash: [12, 4],
          step: true,
          marker: "diamond",
        },
      ],
    });
    const bar = byName("img", "Витрати, листопад 2025, 3 288,69 €");
    expect(bar.getAttribute("tabindex")).toBe("0");
    act(() => bar.focus());
    fireEvent.focus(bar);
    const tip = screen.getByRole("tooltip");
    expect(norm(tip.textContent)).toContain("листопад 2025");
    expect(norm(tip.textContent)).toContain("Бюджет");
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    // The hatched segment is hatched, the line is dashed 12 / 4.
    expect(container.querySelector("path[fill^='url(#']")).not.toBeNull();
    expect(container.querySelector(".ws-chart-line path")!.getAttribute("stroke-dasharray")).toBe("12 4");
  });

  it("CMP-47@PoC states: a column is a button that reports its index when the chart is clickable", () => {
    const onBarClick = vi.fn();
    chart({ onBarClick });
    const bar = byName("button", "Витрати, березень 2026, 3 288,69 €");
    fireEvent.click(bar);
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(onBarClick).toHaveBeenNthCalledWith(1, 4);
    expect(onBarClick).toHaveBeenNthCalledWith(2, 4);
  });

  it("CMP-47@PoC states: the tooltip table shows the change from the previous column as an arrow and an amount with the better or worse word", () => {
    chart({
      series: [
        {
          id: "spent",
          name: "Витрати",
          values: ["2496.07", "3288.69", "1", "1", "1", "1"],
          goodWhen: "down",
        },
      ],
      lines: [{ id: "plan", name: "Бюджет", values: ["3000", "3000", "1", "1", "1", "1"], dash: [12, 4] }],
      changeLabel: "Δ м/м",
    });
    fireEvent.pointerEnter(document.querySelectorAll(".ws-chart-hit")[1]!);
    const tip = screen.getByRole("tooltip");
    expect(norm(tip.textContent)).toContain("грудень 2025 · Δ м/м");
    expect(norm(tip.textContent)).toContain("▲ 792,62 €");
    expect(tip.querySelector(".ws-loss")).not.toBeNull();
    expect(norm(tip.textContent)).toContain("зросло на 792,62 € · гірше");
    expect(norm(tip.querySelector(".ws-chart-tip-row:last-child")!.textContent)).toContain("—");
  });

  it("CHT-00@PoC AC2: the chart takes sums as decimal strings and shows them without floating-point error", () => {
    chart({ series: [{ id: "a", name: "В", values: ["0.1", "0.2", "0.3", "1", "1", "2"] }] });
    expect(byName("img", "В, лист. 2025".replace("лист.", "листопад") + ", 0,10 €")).toBeTruthy();
    expect(byName("img", "В, січень 2026, 0,30 €")).toBeTruthy();
  });

  it("CHT-00@PoC AC3: the chart fills the width of its container and keeps the height it was given", () => {
    const { container } = chart({ height: 376, width: 500 });
    const svg = container.querySelector("svg.ws-chart-svg")!;
    expect(svg.getAttribute("height")).toBe("376");
    expect(svg.getAttribute("width")).toBe("500");
    expect(container.querySelector<HTMLElement>(".ws-chart-plot")!.style.height).toBe("376px");
  });

  it("DS-16@PoC FR 2: values from 1 000 are abbreviated with the full value in the tooltip, values below are not", () => {
    chart({
      categories: months.slice(0, 2),
      series: [{ id: "a", name: "Витрати", values: ["1250000.00", "999.00"] }],
    });
    const labels = [...document.querySelectorAll(".ws-chart-value")].map((n) => norm(n.textContent));
    expect(labels).toEqual(["1,25 млн €", "999,00 €"]);
    fireEvent.pointerEnter(document.querySelectorAll(".ws-chart-hit")[0]!);
    expect(norm(screen.getByRole("tooltip").textContent)).toContain("1 250 000,00 €");
  });
});

describe("CHT-00@PoC chart texts", () => {
  it("CHT-00@PoC FR 6: the chart's own texts come from the catalogues in uk and en, with no literal string in the component", () => {
    const en = render(
      <I18nProvider initialLocale="en">
        <BarChart label="Spending" categories={[]} series={[]} currency="EUR" width={400} />
      </I18nProvider>,
    );
    expect(within(en.container).getByText("No history yet")).toBeTruthy();
    cleanup();
    const uk = render(
      <I18nProvider initialLocale="uk">
        <BarChart label="Витрати" categories={[]} series={[]} currency="EUR" width={400} />
      </I18nProvider>,
    );
    expect(within(uk.container).getByText("Ще немає історії")).toBeTruthy();
  });
});

describe("CHT-00@PoC legend and invalid input", () => {
  it("CMP-47@PoC AC4: a legend name of 60+ characters keeps its full text as the title and accessible name, and the item can shrink so the ellipsis shows", () => {
    const name = "Витрати на подорожі, відпустки й довгі поїздки до родичів за кордон";
    const { container } = chart({ series: [{ id: "s", name, values: ["1", "2", "3", "4", "5", "6"] }] });
    const item = container.querySelector(".ws-chart-legend-item")!;
    const text = item.querySelector(".ws-muted")!;
    expect(text.getAttribute("title")).toContain(name);
    expect(text.textContent).toContain(name);
    const css = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8");
    const rule = (selector: string) =>
      css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    expect(rule(".ws-chart-legend-item {")).toMatch(/min-inline-size:\s*0/);
    expect(rule(".ws-chart-legend-item > .ws-muted")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule(".ws-chart-legend-item > .ws-muted")).toMatch(/min-inline-size:\s*0/);
  });

  it("CHT-00@PoC AC2: a value that is not a decimal string shows the chart's error state instead of throwing", () => {
    chart({ series: [{ id: "s", name: "Витрати", values: ["1e3", "2", "3", "4", "5", "6"] }] });
    expect(screen.getByRole("alert").textContent).toContain("Не вдалося побудувати графік");
  });
});
