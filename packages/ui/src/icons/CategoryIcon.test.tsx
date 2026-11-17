import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { CATEGORY_ICON_NAMES, CategoryDisc } from "./CategoryIcon.tsx";

/** BUD-01@PoC FR 10: the icon of a category on its coloured circle (S-196 and the screens that show categories). */
describe("BUD-01@PoC FR 10: CategoryDisc", () => {
  it("BUD-01@PoC FR 10: every icon of the system tree is in the category set, so none falls back", () => {
    const catalogue = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../apps/api/src/modules/categories/domain/catalogue.ts",
      ),
      "utf8",
    );
    // A category line: key | name | #colour | icon | …
    const icons = [...catalogue.matchAll(/^ {2}\S+ \| [^|]+ \| #[0-9A-Fa-f]{6} \| ([a-z-]+) \|/gm)].map(
      (m) => m[1],
    );
    expect(icons.length).toBeGreaterThanOrEqual(50);
    expect(icons.filter((i) => !CATEGORY_ICON_NAMES.includes(i as never))).toEqual([]);
    expect(CATEGORY_ICON_NAMES).toContain("shapes");
  });

  it("BUD-01@PoC FR 10: the circle takes the category's colour and icon tone; an unknown icon is drawn as «shapes», a malformed colour is not put into the style", () => {
    const { container, rerender } = render(<CategoryDisc color="#959FFE" icon="sprout" iconTone="ink" />);
    const disc = container.querySelector<HTMLElement>(".ws-category-disc")!;
    expect(disc.style.backgroundColor).toBe("rgb(149, 159, 254)");
    expect(disc.dataset.iconTone).toBe("ink");
    expect(disc.dataset.icon).toBe("sprout");
    expect(disc.getAttribute("aria-hidden")).toBe("true");
    expect(disc.querySelector("svg")?.getAttribute("width")).toBe("16");
    rerender(<CategoryDisc color="red;background:url(x)" icon="rocket" iconTone="white" size={32} />);
    expect(disc.style.backgroundColor).toBe("");
    expect(disc.dataset.icon).toBe("shapes");
    expect(disc.querySelector("svg")?.getAttribute("width")).toBe("20");
  });
});
