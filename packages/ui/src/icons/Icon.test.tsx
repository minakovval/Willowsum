import { render } from "@testing-library/react";
import { Car, HeartPulse, House, Plane, Shield, UserRound } from "lucide";
import { Icon, ICON_GROUPS, ICON_NAMES, ICON_PARENT_CHILD, IconSvg } from "./Icon.tsx";

describe("icon set (DS-12)", () => {
  it.each(ICON_NAMES)("%s: 24 px grid, 1.8 px round stroke, outline, currentColor", (name) => {
    const { container } = render(<IconSvg name={name} px={24} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke-width")).toBe("1.8");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    // Outline only: nothing drawn with a fill except the luminance masks of child icons.
    for (const el of svg.querySelectorAll("[fill]")) {
      if (el === svg) continue;
      expect(el.closest("mask"), `${name} has a filled shape`).not.toBeNull();
    }
  });

  it("keeps a 1.8 px line at every size (absolute stroke)", () => {
    for (const px of [16, 20, 24, 32, 40]) {
      const svg = render(<IconSvg name="home" px={px} />).container.querySelector("svg")!;
      expect(Number(svg.getAttribute("stroke-width")) * (px / 24)).toBeCloseTo(1.8, 2);
    }
    const thin = render(<IconSvg name="property" px={96} stroke={1.1} absoluteStroke={false} />);
    expect(thin.container.querySelector("svg")!.getAttribute("stroke-width")).toBe("1.1");
  });

  it.each(ICON_NAMES)("%s draws something", (name) => {
    const svg = render(<IconSvg name={name} px={24} />).container.querySelector("svg")!;
    expect(
      svg.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse").length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ["insurance-health", HeartPulse],
    ["insurance-life", UserRound],
    ["insurance-home", House],
    ["insurance-vehicle", Car],
    ["insurance-travel", Plane],
  ] as const)(
    "%s = the insured object + a shield badge (one rule for every insurance kind)",
    (name, object) => {
      const svg = render(<IconSvg name={name} px={24} />).container.querySelector("svg")!;
      expect(svg.querySelector("mask"), "the object is cut back around the badge").not.toBeNull();
      const html = svg.innerHTML;
      for (const [, attrs] of object) if (attrs.d) expect(html).toContain(String(attrs.d));
      const badge = render(
        <IconSvg name={name === "insurance-health" ? "insurance-travel" : "insurance-health"} px={24} />,
      )
        .container.querySelector("svg > path:last-of-type")!
        .getAttribute("d");
      expect(html).toContain(badge!);
      expect(html, "no full-size shield any more").not.toContain(String(Shield[0]![1].d));
    },
  );

  it("is based on the Lucide set", () => {
    const html = render(<IconSvg name="home" px={24} />).container.innerHTML;
    for (const [, attrs] of House) expect(html).toContain(String(attrs.d));
  });

  it("has the 22 section, 12 asset-type and 9 money-and-cover icons", () => {
    expect(ICON_GROUPS.sections).toHaveLength(22);
    expect(ICON_GROUPS.assetTypes).toHaveLength(12);
    expect(ICON_GROUPS.moneyAndCover).toHaveLength(9);
  });

  it("child icons contain the parent glyph (DS-12 item 5)", () => {
    for (const [parent, child] of ICON_PARENT_CHILD) {
      const p = render(<IconSvg name={parent} px={24} />)
        .container.querySelector("path")!
        .getAttribute("d");
      const c = render(<IconSvg name={child} px={24} />).container.innerHTML;
      expect(c, `${child} ⊃ ${parent}`).toContain(p!);
    }
  });

  it("is decorative next to a word and a named image when it carries meaning", () => {
    const decorative = render(<Icon name="home" />).container.firstElementChild!;
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    const named = render(<Icon name="search" label="Пошук" />).getByRole("img");
    expect(named.getAttribute("aria-label")).toBe("Пошук");
  });

  it("mirrors only directional icons", () => {
    expect(render(<Icon name="chevron-left" />).container.firstElementChild!.className).toContain(
      "ws-dir-flip",
    );
    expect(render(<Icon name="property" />).container.firstElementChild!.className).not.toContain(
      "ws-dir-flip",
    );
  });
});
