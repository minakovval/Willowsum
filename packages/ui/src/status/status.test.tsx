import { cleanup, render, screen } from "@testing-library/react";
import { CATALOGUES, I18nProvider, placeholdersOf } from "@willowsum/i18n";
import { Decimal } from "@willowsum/domain-kernel";
import { colors, contrastRatio, CONTRAST_MINIMUM, THEMES } from "../tokens/index.ts";
import { Stepper } from "../stepper/Stepper.tsx";
import { NO_MARKER, STATUS_DICTIONARY, STATUS_FAMILIES, statusEntry } from "./dictionary.ts";
import { DeviationMark } from "./DeviationMark.tsx";
import { almostPercent, deviation, overLevel, usageFill, usageState } from "./rules.ts";
import { StatusMark } from "./StatusMark.tsx";
import { UsageStatus } from "./UsageStatus.tsx";

/** DS-23@PoC: the status dictionary of «Планування» — data, rules and the marks. */
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\u00A0\u202F]/g, " ").trim();
const wrap = (ui: React.ReactElement, locale: "uk" | "en" = "uk") =>
  render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);
const visible = (root: ParentNode) =>
  norm(
    [...root.querySelectorAll('[aria-hidden="true"]')]
      .filter((n) => !n.querySelector('[aria-hidden="true"]'))
      .map((n) => n.textContent)
      .join(" "),
  );

afterEach(cleanup);

const ids = (family: string) =>
  STATUS_DICTIONARY.filter((e) => e.family === family).map((e) => e.id.split(".")[1]);

describe("DS-23@PoC FR 1: the dictionary lists every state of every family", () => {
  it("DS-23@PoC FR 1: family А has the six states, Б the five and the two plan marks, В the four", () => {
    expect(ids("a")).toEqual(["notStarted", "remaining", "almost", "limitReached", "exhausted", "over"]);
    expect(ids("b")).toEqual([
      "better",
      "slightlyBetter",
      "unchanged",
      "slightlyWorse",
      "worse",
      "noPlan",
      "planOnly",
    ]);
    expect(ids("v")).toEqual(["mandatory", "outOfPlan", "unallocated", "deficit"]);
  });

  it("DS-23@PoC FR 1: Ґ, Д, Е, Е1 and Є list the states of their headings", () => {
    expect(ids("g")).toEqual(["expected", "approximate", "futureMonth", "periodChanged", "months", "filter"]);
    expect(ids("d").slice(0, 5)).toEqual(["expected", "paid", "overdue", "paidLate", "skipped"]);
    expect(ids("e")).toEqual(["expected", "received", "missing", "receivedLate", "skipped"]);
    expect(ids("e1")).toEqual(["received", "expected", "others"]);
    expect(ids("f")).toEqual(
      expect.arrayContaining(["maybeCancelled", "paused", "cancelled", "subscription", "variable", "found"]),
    );
  });

  it("DS-23@PoC FR 1: Ж, З2, І, Ї and К list their states", () => {
    expect(ids("zh")).toEqual(["achieved", "overTarget", "fromGoal", "envelopeError"]);
    expect(ids("z2")).toEqual(
      expect.arrayContaining(["minPaymentLock", "notPlanned", "covered", "coveredFull", "dangerZone"]),
    );
    expect(ids("i")).toEqual(
      expect.arrayContaining([
        "growing",
        "variableRate",
        "needRate",
        "disclaimer",
        "earlier",
        "ahead",
        "onPlan",
        "behind",
        "noPlan",
        "noRate",
      ]),
    );
    expect(ids("yi")).toEqual(["pending", "duplicate", "oneOff", "split", "transfer", "unpaired"]);
    expect(ids("k")).toEqual(["current", "done", "available", "unavailable", "error", "hint"]);
  });

  it("DS-23@PoC FR 1: every family has a title, every entry a source requirement and a word in uk and en with the same placeholders", () => {
    expect(new Set(STATUS_DICTIONARY.map((e) => e.family))).toEqual(
      new Set(STATUS_FAMILIES.map((f) => f.id)),
    );
    for (const f of STATUS_FAMILIES) {
      expect(CATALOGUES.uk[f.titleKey]).toBeTruthy();
      expect(CATALOGUES.en[f.titleKey]).toBeTruthy();
    }
    for (const e of STATUS_DICTIONARY) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      expect(CATALOGUES.uk[e.textKey], e.id).toBeTruthy();
      expect(CATALOGUES.en[e.textKey], e.id).toBeTruthy();
      expect(placeholdersOf(CATALOGUES.en[e.textKey])).toEqual(placeholdersOf(CATALOGUES.uk[e.textKey]));
    }
  });

  it("DS-23@PoC FR 1: the entry ids are unique", () => {
    const all = STATUS_DICTIONARY.map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("DS-23@PoC FR 2: a status that is not in the dictionary is not shown", () => {
  it("DS-23@PoC AC1: an unknown badge cannot be looked up or rendered", () => {
    expect(() => statusEntry("d.cancelledByBank")).toThrow(/dictionary/);
    expect(() => wrap(<StatusMark id="d.cancelledByBank" />)).toThrow(/dictionary/);
  });
});

describe("DS-23@PoC FR 3: tones and markers", () => {
  it("DS-23@PoC FR 3: the fixed tones keep their marker and colour", () => {
    const fixed = { positive: "✓", attention: "!", negative: "✕", info: "i", neutral: "•" } as const;
    const ink = {
      positive: "gain",
      attention: "on-warning",
      negative: "loss",
      info: "link",
      neutral: "ink-muted",
    } as const;
    // Scales, arrows and counters of the families А, Б, В, Д–К carry their own marker (FR 3, FR 5).
    const own =
      /^(a|b)\.|^(f\.(rise|fall))|^k\.|^z2\.(chooseFirstPeriod|needMonths)|^i\.(ahead|behind|onPlan)|^v\.deficit|^g\./;
    for (const e of STATUS_DICTIONARY) {
      if (own.test(e.id) || NO_MARKER.includes(e.id)) continue;
      if (e.marker === "–" || e.marker === "—") continue;
      expect(e.marker, e.id).toBe(fixed[e.tone]);
      expect(e.ink, e.id).toBe(e.tone === "neutral" && e.id === "z2.coveredFull" ? "gain" : ink[e.tone]);
    }
  });

  it("DS-23@PoC FR 3: the family А words keep the marker and tone of the dictionary", () => {
    const row = (id: string) => {
      const e = statusEntry(`a.${id}`);
      return [e.marker, e.ink];
    };
    expect(row("notStarted")).toEqual(["•", "ink-muted"]);
    expect(row("remaining")).toEqual(["•", "gain"]);
    expect(row("almost")).toEqual(["!", "on-warning"]);
    expect(row("limitReached")).toEqual(["✓", "ink-muted"]);
    expect(row("exhausted")).toEqual(["!", "loss"]);
    expect(row("over")).toEqual(["✕", "loss"]);
    expect([statusEntry("v.deficit").marker, statusEntry("v.deficit").ink]).toEqual(["!", "loss"]);
  });

  it("DS-23@PoC FR 3: every entry has a marker and a word; only the listed entries have a word alone", () => {
    for (const e of STATUS_DICTIONARY) {
      if (NO_MARKER.includes(e.id)) expect(e.marker).toBe("");
      else expect(e.marker, e.id).not.toBe("");
    }
    expect(NO_MARKER.every((id) => STATUS_DICTIONARY.some((e) => e.id === id))).toBe(true);
  });

  it("DS-23@PoC FR 3: the amber of goals is not used for statuses", () => {
    for (const e of STATUS_DICTIONARY) expect(e.ink).not.toMatch(/accent|amber|goal/);
  });

  it("DS-23@PoC FR 3: a mark shows the marker and the word, not the colour alone (grayscale, forced colours)", () => {
    for (const e of STATUS_DICTIONARY) {
      if (e.family === "k" && e.id !== "k.hint") continue; // the step indicator (Stepper) shows the steps
      const { container, unmount } = wrap(
        <StatusMark
          id={e.id}
          arrow="▲"
          params={{
            amount: "2,00 €",
            percent: "86 %",
            date: "5 лис.",
            days: "5",
            count: "3",
            month: "грудень",
            state: "x",
            total: "9",
            covered: "1",
            months: "2",
            fields: "Сума",
          }}
        />,
      );
      const text = visible(container);
      expect(text.length, e.id).toBeGreaterThan(0);
      if (!NO_MARKER.includes(e.id))
        expect(container.querySelector(".ws-status-marker")!.textContent, e.id).not.toBe("");
      unmount();
    }
  });
});

const dec = (v: string) => new Decimal(v);

describe("DS-23@PoC NFR-06: exact decimals, never floats (review B1)", () => {
  it("DS-23@PoC AC4: 0,40 € of 5 600,00 € is «без змін» whatever the notation", () => {
    expect(deviation(dec("5600.40"), dec("5600.00"), "income", "EUR").state).toBe("unchanged");
    expect(deviation("5600.40", "5600.00", "income", "EUR").state).toBe("unchanged");
  });
  it("DS-23@PoC FR 4: 0,1 + 0,2 against a limit of 0,30 is exactly the limit, «вичерпано»", () => {
    expect(usageState(dec("0.1").plus("0.2"), dec("0.30"), false)).toBe("exhausted");
    expect(usageState(dec("0.3"), dec("0.30"), false)).toBe("exhausted");
    expect(usageState(dec("0.3"), dec("0.30"), true)).toBe("limitReached");
  });
  it("DS-23@PoC FR 4: an overspend of exactly 5 % is level 2, exactly 10 % level 3", () => {
    expect(overLevel(dec("0.10"), dec("2.00"))).toBe(2);
    expect(overLevel(dec("10.1").minus("10"), dec("2"))).toBe(2);
    expect(overLevel(dec("0.20"), dec("2.00"))).toBe(3);
  });
  it("DS-23@PoC FR 5: an unknown currency is an error", () => {
    expect(() => deviation("1", "2", "expense", "XXX1")).toThrow();
  });
});

describe("DS-23@PoC FR 4: the usage scale", () => {
  it("DS-23@PoC FR 4: the state follows the share of the limit", () => {
    expect(usageState("0", "100", false)).toBe("notStarted");
    expect(usageState("79.99", "100", false)).toBe("remaining");
    expect(usageState("80", "100", false)).toBe("almost");
    expect(usageState("99.99", "100", false)).toBe("almost");
    expect(usageState("100", "100", true)).toBe("limitReached");
    expect(usageState("100", "100", false)).toBe("exhausted");
    expect(usageState("100.01", "100", true)).toBe("over");
    expect(() => usageState("5", "0", false)).toThrow(RangeError);
    expect(almostPercent("99.6", "100")).toBe("99");
    expect(almostPercent("86", "100")).toBe("86");
  });

  it("DS-23@PoC AC3: an overspend of 48,60 € of 2 000 € optional limits is level 1 (2,43 %)", () => {
    expect(overLevel("48.6", "2000")).toBe(1);
  });

  it("DS-23@PoC FR 4: the level bounds belong to the higher level; without optional limits it is 8", () => {
    const at = (share: number) => overLevel(String(share), "100");
    expect([4.99, 5, 9.99, 10, 19.99, 20, 49.99, 50, 99.99, 100, 199.99, 200, 499.99, 500].map(at)).toEqual([
      1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8,
    ]);
    expect(overLevel("10", "0")).toBe(8);
  });

  it("DS-23@PoC FR 4: the fill is a gradient of the usage tokens, only tokens", () => {
    expect(usageFill("0")).toBe("color-mix(in oklch, var(--ws-usage-30) 0%, var(--ws-usage-0))");
    expect(usageFill("30")).toContain("var(--ws-usage-30) 100%");
    expect(usageFill("42.5")).toContain("var(--ws-usage-55)");
    expect(usageFill("100")).toBe("var(--ws-usage-95)");
    expect(usageFill("60")).not.toMatch(/#|rgb/);
  });

  it("DS-23@PoC AC3: «✕ перевищено» of level 1 has the `over-1` tail and a «N % понад ліміт» line", () => {
    const { container } = wrap(<UsageStatus spent="148.6" limit="100" optionalLimits="2000" />);
    expect(visible(container)).toContain("✕ перевищено");
    expect(container.querySelector<HTMLElement>(".ws-usage-tail")!.style.backgroundColor).toBe(
      "var(--ws-over-1)",
    );
    expect(norm(container.querySelector(".ws-usage-sub")!.textContent)).toBe("49 % понад ліміт");
    expect(container.querySelector(".ws-status")!.getAttribute("data-ink")).toBe("loss");
  });

  it("DS-23@PoC FR 4: the gradient paints the bar only; the word and the marker keep the tone's ink", () => {
    const { container } = wrap(<UsageStatus spent="86" limit="100" />);
    const fill = container.querySelector<HTMLElement>(".ws-usage-fill")!;
    expect(fill.style.backgroundColor).toContain("usage-95");
    expect(container.querySelector(".ws-status")!.getAttribute("data-ink")).toBe("on-warning");
    expect(visible(container)).toContain("! майже вичерпано · 86 %");
    expect(norm(container.querySelector(".ws-usage-sub")!.textContent)).toBe("14 % ліміту");
  });

  it("DS-23@PoC EC2: a mandatory category at its limit is grey «✓ ліміт вичерпано»; over the limit it is «перевищено»", () => {
    const grey = wrap(<UsageStatus spent="100" limit="100" mandatory />);
    expect(visible(grey.container)).toContain("✓ ліміт вичерпано");
    expect(grey.container.querySelector<HTMLElement>(".ws-usage-fill")!.style.backgroundColor).toBe(
      "var(--ws-ink-muted)",
    );
    cleanup();
    const over = wrap(<UsageStatus spent="120" limit="100" mandatory optionalLimits="200" />);
    expect(over.container.querySelector(".ws-usage")!.getAttribute("data-state")).toBe("over");
    expect(over.container.querySelector(".ws-usage")!.getAttribute("data-level")).toBe("3");
  });

  it("DS-23@PoC EC3: an overspend of a budget without optional limits is level 8 (`over-8`)", () => {
    const { container } = wrap(<UsageStatus spent="150" limit="100" />);
    expect(container.querySelector(".ws-usage")!.getAttribute("data-level")).toBe("8");
    expect(container.querySelector<HTMLElement>(".ws-usage-tail")!.style.backgroundColor).toBe(
      "var(--ws-over-8)",
    );
  });

  it("DS-23@PoC FR 4: «не почато» has an empty bar and «100 % ліміту» under it; «вичерпано» of an optional category is `over-1`", () => {
    const empty = wrap(<UsageStatus spent="0" limit="100" />);
    expect(empty.container.querySelector(".ws-usage-fill")).toBeNull();
    expect(norm(empty.container.querySelector(".ws-usage-sub")!.textContent)).toBe("100 % ліміту");
    cleanup();
    const full = wrap(<UsageStatus spent="100" limit="100" />);
    expect(full.container.querySelector<HTMLElement>(".ws-usage-fill")!.style.backgroundColor).toBe(
      "var(--ws-over-1)",
    );
    expect(full.container.querySelector(".ws-status")!.getAttribute("data-ink")).toBe("loss");
  });
});

describe("DS-23@PoC FR 5: deviation", () => {
  it("DS-23@PoC AC4: an income change of 0,40 € of 5 600 € is «—» in `brand`", () => {
    expect(deviation("5600.4", "5600", "income", "EUR").state).toBe("unchanged");
    const { container } = wrap(
      <DeviationMark currency="EUR" value="5600.4" base="5600" kind="income" amount="0,40 €" />,
    );
    const mark = container.querySelector(".ws-status")!;
    expect(mark.getAttribute("data-ink")).toBe("brand");
    expect(visible(container)).toBe("—");
  });

  it("DS-23@PoC AC6: spending 550,20 € against 500,00 € (10,04 %) is «▲ 50,20 €» in the soft `loss-soft` step", () => {
    const d = deviation("550.2", "500", "expense", "EUR");
    expect(d).toEqual({ state: "slightlyWorse", arrow: "▲", percent: "10.0" });
    const { container } = wrap(
      <DeviationMark currency="EUR" value="550.2" base="500" kind="expense" amount="50,20 €" />,
    );
    expect(visible(container)).toBe("▲ 50,20 €");
    expect(container.querySelector(".ws-deviation-amount")!.getAttribute("data-ink")).toBe("loss-soft");
    expect(container.querySelector(".ws-status")!.getAttribute("data-ink")).toBe("loss-soft");
  });

  it("DS-23@PoC FR 5: colour says better or worse, the arrow says the direction; above 10 % the step is saturated", () => {
    expect(deviation("400", "500", "expense", "EUR")).toMatchObject({ state: "better", arrow: "▼" });
    expect(deviation("480", "500", "expense", "EUR")).toMatchObject({ state: "slightlyBetter", arrow: "▼" });
    expect(deviation("600", "500", "income", "EUR")).toMatchObject({ state: "better", arrow: "▲" });
    expect(deviation("400", "500", "income", "EUR")).toMatchObject({ state: "worse", arrow: "▼" });
    expect(deviation("520", "500", "income", "EUR")).toMatchObject({ state: "slightlyBetter" });
    expect(deviation("560", "500", "expense", "EUR")).toMatchObject({ state: "worse", arrow: "▲" });
    expect(deviation("10.5", "10", "expense", "EUR").state).toBe("slightlyWorse");
  });

  it("DS-23@PoC FR 5: «без змін» needs both below 1 % and below 1 unit; a base of zero is never soft", () => {
    expect(deviation("100.9", "100", "expense", "EUR").state).toBe("unchanged");
    expect(deviation("5600.4", "5600", "expense", "EUR").state).toBe("unchanged");
    expect(deviation("1000", "1000.5", "expense", "EUR").state).toBe("unchanged");
    expect(deviation("101", "100", "expense", "EUR").state).not.toBe("unchanged");
    expect(deviation("5", "0", "expense", "EUR")).toMatchObject({ state: "worse", percent: null });
  });

  it("DS-23@PoC FR 5: the state word is in the tooltip and in the accessible name with the direction and the amount", () => {
    const { container } = wrap(
      <DeviationMark
        currency="EUR"
        value="550.2"
        base="500"
        kind="expense"
        amount="50,20 €"
        spokenAmount="50 євро 20 центів"
      />,
    );
    expect(container.querySelector(".ws-deviation")!.getAttribute("title")).toBe("трохи гірше");
    expect(norm(container.querySelector(".ws-visually-hidden")!.textContent)).toBe(
      "Статус: трохи гірше, вище бази, 50 євро 20 центів",
    );
  });
});

describe("DS-23@PoC FR 6, AC2: statuses of different families keep their own place", () => {
  it("DS-23@PoC AC2: a payment 5 days overdue shows «! Прострочено на 5 дн.» in attention and leaves the state badge alone", () => {
    const { container } = wrap(
      <div>
        <span data-cell="charge">
          <StatusMark id="d.overdue" params={{ days: "5" }} />
        </span>
        <span data-cell="state">
          <StatusMark id="f.maybeCancelled" />
        </span>
      </div>,
    );
    const charge = container.querySelector('[data-cell="charge"]')!;
    const state = container.querySelector('[data-cell="state"]')!;
    expect(visible(charge)).toBe("! Прострочено на 5 дн.");
    expect(charge.querySelector(".ws-status")!.getAttribute("data-tone")).toBe("attention");
    expect(charge.querySelector(".ws-status")!.hasAttribute("data-plate")).toBe(false);
    expect(visible(state)).toBe("! Можливо, скасований");
    expect(state.querySelector(".ws-status")!.getAttribute("data-plate")).toBe("attention");
    expect(charge.querySelector('[data-status="f.maybeCancelled"]')).toBeNull();
  });
});

describe("DS-23@PoC EC1: both statuses in one row", () => {
  it("DS-23@PoC EC1: «Можливо, скасований» with an overdue charge shows both, each of its own family, read as two statuses", () => {
    wrap(
      <>
        <StatusMark id="d.overdue" params={{ days: "5" }} />
        <StatusMark id="f.maybeCancelled" />
      </>,
    );
    expect(screen.getByText("Статус: Прострочено на 5 днів")).toBeTruthy();
    expect(screen.getByText("Статус: Можливо, скасований")).toBeTruthy();
    expect(statusEntry("d.overdue").family).not.toBe(statusEntry("f.maybeCancelled").family);
  });
});

describe("DS-23@PoC «Стани інтерфейсу»: the accessible name", () => {
  it("DS-23@PoC AC5: «Статус: Прострочено на 5 днів» — the abbreviation spoken in full, the mark read once", () => {
    wrap(<StatusMark id="d.overdue" params={{ days: "5" }} />);
    expect(screen.getByText("Статус: Прострочено на 5 днів")).toBeTruthy();
    expect(document.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
  });

  it("DS-23@PoC FR 3: the spoken plural follows the number (1 день, 2 дні, 5 днів, 21 день) and months too", () => {
    const spoken = (days: string) => {
      const { container, unmount } = wrap(<StatusMark id="d.overdue" params={{ days }} />);
      const text = norm(container.querySelector(".ws-visually-hidden")!.textContent);
      unmount();
      return text;
    };
    expect(spoken("1")).toBe("Статус: Прострочено на 1 день");
    expect(spoken("2")).toBe("Статус: Прострочено на 2 дні");
    expect(spoken("5")).toBe("Статус: Прострочено на 5 днів");
    expect(spoken("21")).toBe("Статус: Прострочено на 21 день");
    wrap(<StatusMark id="g.months" params={{ count: "3" }} />);
    expect(screen.getByText("Статус: за 3 місяці")).toBeTruthy();
  });

  it("DS-23@PoC FR 3: the English catalogue gives the same structure", () => {
    const { container } = wrap(<StatusMark id="d.overdue" params={{ days: "5" }} />, "en");
    expect(norm(container.querySelector(".ws-visually-hidden")!.textContent)).toBe(
      "Status: Overdue by 5 days",
    );
    expect(visible(container)).toBe("! Overdue by 5 d.");
  });

  it("DS-23@PoC FR 3: a marker-only mark keeps the word in the accessible name", () => {
    const { container } = wrap(<StatusMark id="d.overdue" params={{ days: "5" }} markerOnly />);
    expect(visible(container)).toBe("!");
    expect(norm(container.querySelector(".ws-visually-hidden")!.textContent)).toContain("Прострочено");
  });

  it("DS-23@PoC FR 3: an entry whose arrow comes from the data needs it", () => {
    expect(() => wrap(<StatusMark id="b.better" />)).toThrow(/arrow/);
  });

  it("DS-23@PoC «Стани інтерфейсу»: a mark is not a control: no tab stop, no role that takes focus", () => {
    const { container } = wrap(<StatusMark id="a.over" />);
    const mark = container.querySelector(".ws-status")!;
    expect(mark.tagName).toBe("SPAN");
    expect(mark.hasAttribute("tabindex")).toBe(false);
    expect(mark.closest("button, a")).toBeNull();
  });
});

describe("DS-23@PoC AC7, AC8: steps of a dialog form (family К)", () => {
  const steps = (states: ("current" | "done" | "available" | "unavailable" | "error")[]) =>
    states.map((state, i) => ({ label: `Крок ${i + 1}`, state }));

  it("DS-23@PoC AC7: an unavailable step is not pressable and has `aria-disabled`; the dictionary names the same states", () => {
    wrap(<Stepper steps={steps(["current", "unavailable", "unavailable"])} onSelect={() => {}} />);
    const items = screen.getAllByRole("button");
    expect(items.every((b) => b.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(statusEntry("k.unavailable").ink).toBe("disabled-ink");
  });

  it("DS-23@PoC AC8: a passed step returned to with an empty required field is «!»", () => {
    const { container } = wrap(
      <Stepper steps={steps(["done", "error", "unavailable"])} onSelect={() => {}} />,
    );
    expect(container.querySelectorAll(".ws-stepper-mark")[1]!.textContent).toBe("!");
    expect(statusEntry("k.error")).toMatchObject({ marker: "!", tone: "attention" });
  });

  it("DS-23@PoC FR 1: the hint above the buttons and its variant for a blocking error are in the dictionary, neutral with «i»", () => {
    wrap(<StatusMark id="k.hint" params={{ fields: "Цільова сума" }} />);
    expect(screen.getByText("Статус: Щоб продовжити, заповніть: Цільова сума")).toBeTruthy();
    expect(statusEntry("k.hint")).toMatchObject({ tone: "neutral", marker: "i", ink: "ink-muted" });
    expect(CATALOGUES.uk["status.step.hintFix"]).toBe("Щоб продовжити, виправте: {fields}");
  });
});

describe("DS-23@PoC NFR-08: contrast of the words and markers", () => {
  const grounds = (e: (typeof STATUS_DICTIONARY)[number]) =>
    e.plate
      ? [
          e.quiet
            ? "surface-300"
            : {
                positive: "tint-positive",
                negative: "tint-negative",
                attention: "tint-warning",
                info: "tint-info",
                neutral: "surface-300",
              }[e.tone],
        ]
      : ["surface-100", "surface-200"];

  it.each(THEMES)("DS-23@PoC NFR-08: every ink reaches 4.5:1 on its ground in the %s theme", (theme) => {
    for (const e of STATUS_DICTIONARY) {
      if (e.ink === "disabled-ink") continue; // disabled: exempt from contrast, shown with its reason (DS-06)
      for (const ground of grounds(e)) {
        const ratio = contrastRatio(colors[e.ink][theme], colors[ground as keyof typeof colors][theme]);
        expect(ratio, `${e.id} ${e.ink} on ${ground}`).toBeGreaterThanOrEqual(CONTRAST_MINIMUM.text);
      }
    }
  });
});
