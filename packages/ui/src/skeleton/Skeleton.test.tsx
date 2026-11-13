import { act, cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { motion, space } from "../tokens/index.ts";
import { Skeleton } from "./Skeleton.tsx";

/**
 * CMP-22@PoC Skeleton, built on the DS-13 `.ws-skeleton` style: the markup, timing and screen-reader behaviour.
 * The sizes, colour and reduced motion of the shapes are checked on the stylesheet in `Skeleton.css.test.ts`.
 */
const shapes = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".ws-skeleton")];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CMP-22@PoC Skeleton", () => {
  it("CMP-22@PoC AC1: a list of transactions loading shows 8 rows, each a tile (or a circle) and two bars", () => {
    const { container } = render(<Skeleton variant="row" />);
    const rows = [...container.querySelectorAll(".ws-skeleton-row")];
    // «списки — 8 рядків».
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const [lead, ...bars] = shapes(row);
      expect(lead!.classList.contains("ws-skeleton--tile")).toBe(true);
      const lines = bars.filter((b) => !b.classList.contains("ws-skeleton--amount"));
      // Two plain 12 px bars (`.ws-skeleton` with no size modifier).
      expect(lines).toHaveLength(2);
      for (const bar of lines) expect(bar.className).toBe("ws-skeleton");
    }
    cleanup();

    const { container: avatars } = render(<Skeleton variant="row" leading="circle" lines={3} />);
    expect(avatars.querySelectorAll(".ws-skeleton-row > .ws-skeleton--circle")).toHaveLength(3);
  });

  it("CMP-22@PoC AC1: the text variant cycles bars 100 / 80 / 60 % wide; the block variant is a block, a chart height or a field", () => {
    const { container } = render(<Skeleton variant="text" lines={4} />);
    expect(shapes(container).map((s) => s.dataset["width"])).toEqual(["100", "80", "60", "100"]);
    cleanup();

    const { container: block } = render(<Skeleton variant="block" />);
    expect(shapes(block)[0]!.classList.contains("ws-skeleton--block")).toBe(true);
    expect(shapes(block)[0]!.style.blockSize).toBe("");
    cleanup();

    const { container: chart } = render(<Skeleton variant="block" height={space["space-8"] * 3} />);
    expect(shapes(chart)[0]!.style.blockSize).toBe(`${space["space-8"] * 3}px`);
    cleanup();

    const { container: field } = render(<Skeleton variant="block" field />);
    expect(shapes(field)[0]!.classList.contains("ws-skeleton--field")).toBe(true);
  });

  it("CMP-22@PoC AC2: after 3 s of loading «Ще завантажується…» appears under the skeleton in 14/20 px `ink-muted`", () => {
    vi.useFakeTimers();
    const { container } = render(<Skeleton variant="row" lines={5} />);
    expect(screen.queryByText("Ще завантажується…")).toBeNull();

    act(() => vi.advanceTimersByTime(motion["duration-skeleton-slow"] - 1));
    expect(screen.queryByText("Ще завантажується…")).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    const slow = screen.getByText("Ще завантажується…");
    expect(motion["duration-skeleton-slow"]).toBe(3000);
    // Under the shapes, not inside them.
    const shapesBox = container.querySelector(".ws-skeleton-shapes")!;
    expect(shapesBox.compareDocumentPosition(slow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shapesBox.contains(slow)).toBe(false);
    expect(slow.classList.contains("ws-text-body-sm")).toBe(true);
    expect(slow.classList.contains("ws-muted")).toBe(true);
  });

  it("CMP-22@PoC AC2: a consumer that already knows the load is slow passes `slow`; English text from the catalogue", () => {
    render(
      <I18nProvider initialLocale="en">
        <Skeleton variant="text" slow />
      </I18nProvider>,
    );
    expect(screen.getByText("Still loading…")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading");
  });

  it("CMP-22@PoC AC3: every shape is a `.ws-skeleton`, so the reduced-motion rule stops all of them; there is no spinner", () => {
    const { container } = render(
      <>
        <Skeleton variant="row" lines={2} />
        <Skeleton variant="text" />
        <Skeleton variant="block" field />
      </>,
    );
    const leaves = [...container.querySelectorAll(".ws-skeleton-shapes span")].filter(
      (s) => s.children.length === 0,
    );
    expect(leaves.length).toBeGreaterThan(0);
    for (const s of leaves) expect(s.classList.contains("ws-skeleton")).toBe(true);
    expect(container.querySelector(".ws-spinner")).toBeNull();
  });

  it("CMP-22@PoC AC4: a screen reader hears «Завантаження» once; the bars are hidden and never take focus", () => {
    vi.useFakeTimers();
    const { container } = render(<Skeleton variant="row" lines={3} />);
    const region = container.querySelector(".ws-skeleton-region")!;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".ws-skeleton-shapes")!.getAttribute("aria-hidden")).toBe("true");

    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    expect(status[0]!.textContent).toBe("Завантаження");
    expect(status[0]!.classList.contains("ws-visually-hidden")).toBe(true);

    // The slow line appears later but is not a second announcement.
    act(() => vi.advanceTimersByTime(motion["duration-skeleton-slow"]));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Завантаження");
    expect(screen.getByText("Ще завантажується…").closest("[aria-live],[role=status]")).toBeNull();

    // Not focusable: no focusable element and no tabindex inside the region.
    expect(
      region.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable]"),
    ).toHaveLength(0);
  });

  it("CMP-22@PoC AC5: the shapes repeat the content they stand for (row count, bar count, chart height)", () => {
    const { container, rerender } = render(<Skeleton variant="row" lines={5} />);
    expect(container.querySelectorAll(".ws-skeleton-row")).toHaveLength(5);
    rerender(<Skeleton variant="text" lines={2} />);
    expect(shapes(container)).toHaveLength(2);
    rerender(<Skeleton variant="block" height={space["space-8"] * 2} />);
    expect(shapes(container)[0]!.style.blockSize).toBe(`${space["space-8"] * 2}px`);
  });
});
