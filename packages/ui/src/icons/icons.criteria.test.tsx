import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { CirclePercent, CreditCard, House } from "lucide";
import { I18nProvider } from "@willowsum/i18n";
import { AppShell } from "../shell/AppShell.tsx";
import { iconSizes } from "../tokens/layout.ts";
import {
  Icon,
  ICON_GROUPS,
  ICON_NAMES,
  IconSvg,
  POC_ICON_GROUPS,
  PRODUCT_ICONS,
  productIcon,
} from "./Icon.tsx";
import { IconTile } from "./IconTile.tsx";

/** CMP-33@PoC and DS-12@PoC: the icon set, by acceptance criterion. Icon-only buttons: `IconButton.test.tsx`. */

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/components.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) =>
  css.match(
    new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? "";

const shellCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/shell.css"),
  "utf8",
);

const svgOf = (el: Element | null) => el!.querySelector("svg")!;
/** Line weight on screen: the SVG stroke is in 24-unit grid space, scaled to the rendered size. */
const screenStroke = (svg: SVGSVGElement) =>
  Number(svg.getAttribute("stroke-width")) * (Number(svg.getAttribute("width")) / 24);
const dsOf = (node: readonly (readonly [string, Record<string, unknown>])[]) =>
  node.map(([, a]) => a.d).filter((d): d is string => typeof d === "string");

function expectSetStyle(svg: SVGSVGElement, stroke: number) {
  expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(screenStroke(svg)).toBeCloseTo(stroke, 2);
  expect(svg.getAttribute("stroke-linecap")).toBe("round");
  expect(svg.getAttribute("stroke-linejoin")).toBe("round");
  expect(svg.getAttribute("fill")).toBe("none");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
  for (const el of svg.querySelectorAll("[fill]")) {
    if (el === svg) continue;
    expect(el.closest("mask"), "only child-icon masks are filled").not.toBeNull();
  }
}

describe("CMP-33@PoC / DS-12@PoC icon set", () => {
  it.each(ICON_NAMES)(
    "CMP-33@PoC AC1, DS-12@PoC AC1: %s — 24 px grid, 1.8 px on screen at every size, round caps and joins, outline, currentColor",
    (name) => {
      for (const size of iconSizes) {
        expectSetStyle(svgOf(render(<Icon name={name} size={size} />).container), 1.8);
      }
    },
  );

  it("DS-12@PoC AC1: «+» and «✓» inside buttons draw 2 px; elsewhere, and other icons in buttons, 1.8 px", () => {
    for (const name of ["plus", "check"] as const) {
      for (const size of iconSizes) {
        expectSetStyle(svgOf(render(<Icon name={name} size={size} inButton />).container), 2);
        expectSetStyle(svgOf(render(<Icon name={name} size={size} />).container), 1.8);
      }
    }
    expectSetStyle(svgOf(render(<Icon name="filter" size={20} inButton />).container), 1.8);
  });

  it("DS-12@PoC FR 2: dots («ще», «список», «інфо») are solid dots 2.5 px across on screen at every size", () => {
    for (const size of iconSizes) {
      const scale = size / 24;
      for (const name of ["more"] as const) {
        const dots = [
          ...svgOf(render(<Icon name={name} size={size} />).container).querySelectorAll("circle"),
        ].filter((c) => Number(c.getAttribute("r")) < 2);
        expect(dots.length, name).toBeGreaterThan(0);
        for (const dot of dots) {
          const r = Number(dot.getAttribute("r"));
          const sw = Number(dot.getAttribute("stroke-width"));
          expect(sw, "the stroke covers the centre: no hole").toBeGreaterThanOrEqual(2 * r);
          expect((2 * r + sw) * scale).toBeCloseTo(2.5, 2);
        }
      }
      for (const name of ["list", "info"] as const) {
        const segments = [
          ...svgOf(render(<Icon name={name} size={size} />).container).querySelectorAll("path"),
        ].filter((p) => /h\.01/.test(p.getAttribute("d")!));
        expect(segments.length, name).toBeGreaterThan(0);
        for (const p of segments) expect(Number(p.getAttribute("stroke-width")) * scale).toBeCloseTo(2.5, 2);
      }
    }
  });

  it("CMP-33@PoC AC2: an icon in a button with text is 20 px and takes the colour of the button text", () => {
    render(
      <button type="button" className="ws-button ws-button-primary">
        <Icon name="plus" size={20} inButton />
        <span>Додати</span>
      </button>,
    );
    const button = screen.getByRole("button", { name: "Додати" });
    const svg = svgOf(button);
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    // The icon wrapper inherits the button's text colour; only the tones set their own.
    expect(rule(".ws-icon")).toMatch(/color:\s*inherit/);
    expect(button.querySelector(".ws-icon")!.className).toBe("ws-icon");
  });

  it("CMP-33@PoC AC4, DS-12@PoC AC4: mortgage = the loan glyph at 75 % top left + a house in the bottom-right 8 px box; loan and card differ", () => {
    const mortgage = svgOf(render(<Icon name={PRODUCT_ICONS.mortgage} />).container);
    const parent = mortgage.querySelector('g[transform="translate(0.5 0.5) scale(0.75)"]');
    expect(parent, "the parent glyph, scaled to 75 % at the top left").not.toBeNull();
    for (const d of dsOf(CirclePercent)) expect(parent!.innerHTML).toContain(d);
    // The house badge sits inside x, y 14…22.
    const badge = [...mortgage.querySelectorAll(":scope > path")].map((p) => p.getAttribute("d")!);
    expect(badge.join(" ")).toMatch(/^M15 22/);
    expect(mortgage.querySelector("mask"), "the parent is cut back around the badge").not.toBeNull();
    // The house badge is Lucide's house, scaled into the box, not the full-size house.
    expect(mortgage.innerHTML).not.toContain(dsOf(House)[0]);

    const loan = render(<Icon name={PRODUCT_ICONS.loan} />).container.innerHTML;
    const card = render(<Icon name={PRODUCT_ICONS.card} />).container.innerHTML;
    for (const d of dsOf(CirclePercent)) expect(loan).toContain(d);
    expect(card).toContain('rx="2"');
    expect(dsOf(CreditCard).every((d) => card.includes(d))).toBe(true);
    expect(card).not.toBe(loan);
  });

  it("DS-12@PoC FR 3: sizes 16, 20, 24 (default), 32 and 40 px; tones ink, ink-muted, brand and on-brand", () => {
    expect(svgOf(render(<Icon name="home" />).container).getAttribute("width")).toBe("24");
    for (const size of [16, 20, 24, 32, 40] as const) {
      const svg = svgOf(render(<Icon name="home" size={size} />).container);
      expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual([String(size), String(size)]);
    }
    expect(render(<Icon name="home" />).container.firstElementChild!.className).toBe("ws-icon");
    for (const [tone, token] of [
      ["muted", "ink-muted"],
      ["brand", "brand"],
      ["on-brand", "on-brand"],
    ] as const) {
      expect(render(<Icon name="home" tone={tone} />).container.firstElementChild!.className).toContain(
        `ws-icon-${tone}`,
      );
      expect(rule(`.ws-icon-${tone}`)).toMatch(new RegExp(`color:\\s*var\\(--ws-${token}\\)`));
    }
  });

  it("DS-12@PoC FR 7: the current navigation item keeps its icon; it is marked by a darker colour on a tinted background", () => {
    const html = (current: boolean) =>
      render(
        <a className="ws-nav-item" href="#/b" aria-current={current ? "page" : undefined}>
          <Icon name="budget" size={20} />
          <span>Бюджет</span>
        </a>,
      ).container.querySelector("svg")!.innerHTML;
    expect(html(true)).toBe(html(false));
    const current = shellCss.match(/\.ws-nav-item\[aria-current="page"\]\s*\{([^}]*)\}/)![1]!;
    expect(current).toMatch(/background:\s*var\(--ws-surface-300\)/);
    expect(current).toMatch(/color:\s*var\(--ws-brand\)/);
  });

  it("CMP-33@PoC AC5, DS-12@PoC AC3: a decorative icon next to «Бюджет» in the navigation is not read; only «Бюджет» is", () => {
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
          <p />
        </AppShell>
      </I18nProvider>,
    );
    const link = screen.getByRole("link", { name: "Бюджет" });
    expect(link.textContent).toBe("Бюджет");
    const icon = link.querySelector(".ws-icon")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("role")).toBeNull();
    expect(icon.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("CMP-33@PoC «Доступність»: an icon that carries meaning alone is one image with a name", () => {
    expect(screen.queryByRole("img")).toBeNull();
    render(<Icon name="search" label="Пошук" />);
    expect(screen.getByRole("img", { name: "Пошук" })).toBeTruthy();
  });

  it("DS-12@PoC AC5, FR 13: a tile with a 24 px icon and a long label in a narrow cell — the icon stays 24 px, the label wraps under it", () => {
    render(
      <div style={{ inlineSize: "64px" }}>
        <IconTile icon="recurring" label="Регулярні платежі і передплати родини" />
      </div>,
    );
    const label = screen.getByText("Регулярні платежі і передплати родини");
    const tile = label.parentElement!;
    const icon = tile.querySelector(".ws-icon")!;
    // Read as the label only.
    expect(tile.textContent).toBe("Регулярні платежі і передплати родини");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    // The icon keeps 24 px and comes before the label, in a column.
    expect(icon.querySelector("svg")!.getAttribute("width")).toBe("24");
    expect(tile.firstElementChild).toBe(icon);
    expect(rule(".ws-icon-tile")).toMatch(/flex-direction:\s*column/);
    expect(rule(".ws-icon-tile > .ws-icon")).toMatch(/flex:\s*none/);
    // The label wraps inside the cell instead of running over the icon.
    expect(rule(".ws-icon-tile-label")).toMatch(/overflow-wrap:\s*break-word/);
    expect(rule(".ws-icon-tile-label")).toMatch(/max-inline-size:\s*100%/);
    expect(rule(".ws-icon-tile-label")).not.toMatch(/position:\s*absolute|white-space:\s*nowrap/);
  });

  it("DS-12@PoC EC1: a product without an icon of its own shows the generic «інше»; known products keep theirs", () => {
    expect(productIcon("brokerage")).toBe("other");
    expect(productIcon("")).toBe("other");
    expect(productIcon("toString")).toBe("other");
    expect(productIcon("card")).toBe("card");
    expect(productIcon("mortgage")).toBe("mortgage");
    const other = render(<IconSvg name={productIcon("brokerage")} px={24} />).container.innerHTML;
    for (const name of ICON_NAMES.filter((n) => n !== "other")) {
      expect(render(<IconSvg name={name} px={24} />).container.innerHTML, `«інше» ≠ ${name}`).not.toBe(other);
    }
  });

  it("DS-12@PoC FR 1: one icon, one meaning — no two names draw the same glyph", () => {
    const drawn = new Map<string, string>();
    for (const name of ICON_NAMES) {
      const html = render(<IconSvg name={name} px={24} />).container.innerHTML.replace(/ws-m-[\w-]+/g, "m");
      expect(drawn.get(html), `${name} draws the same as ${drawn.get(html)}`).toBeUndefined();
      drawn.set(html, name);
    }
  });

  it("DS-12@PoC FR 4, FR 9: the PoC set — 22 sections, money = card and mortgage, no asset-type, insurance or investment icons", () => {
    expect(POC_ICON_GROUPS.sections).toHaveLength(22);
    expect(POC_ICON_GROUPS.money).toEqual(["card", "mortgage"]);
    const poc = new Set<string>(Object.values(POC_ICON_GROUPS).flat());
    for (const name of ICON_GROUPS.assetTypes) expect(poc.has(name), name).toBe(false);
    for (const name of ICON_NAMES.filter((n) => /^(insurance-|investment-)/.test(n))) {
      expect(poc.has(name), name).toBe(false);
    }
    // List parameters are sliders, never «…».
    expect(poc.has("options")).toBe(true);
    expect(poc.has("columns")).toBe(true);
  });
});
