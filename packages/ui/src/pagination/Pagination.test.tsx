import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { Pagination, type PageSize } from "./Pagination.tsx";
import { useRestoredListState } from "./listState.ts";

/** CMP-13@PoC Pagination: markup, keyboard, focus and announcements; sizes and colours are in `Pagination.css.test.ts`. */
afterEach(cleanup);

const norm = (s: string | null) => (s ?? "").replace(/\u00A0|\u202F/g, " ");
const nav = () => screen.getByRole("navigation", { name: "Сторінки списку" });
const prev = () => within(nav()).getByRole("button", { name: "Попередня сторінка" });
const next = () => within(nav()).getByRole("button", { name: "Наступна сторінка" });
const live = () => within(nav()).getByRole("status");

/** A list the way a screen uses it: rows of the page, a first row to focus, a load that takes a moment. */
function List({
  recordCount = 1240,
  initial = 1,
  size = 25,
  delay = false,
}: {
  recordCount?: number;
  initial?: number;
  size?: PageSize;
  delay?: boolean;
}) {
  const [view, setView] = useState({ page: initial, pageSize: size });
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<typeof view | null>(null);
  const rows = Array.from({ length: 3 }, (_, i) => (view.page - 1) * view.pageSize + i + 1);
  return (
    <>
      <ul>
        {rows.map((n) => (
          <li key={n} data-row>
            Рядок {n}
          </li>
        ))}
      </ul>
      <Pagination
        page={view.page}
        recordCount={recordCount}
        pageSize={view.pageSize}
        loading={loading}
        firstRow={() => document.querySelector<HTMLElement>("[data-row]")}
        onChange={(next) => {
          if (!delay) return setView(next);
          setLoading(true);
          setPending(next);
        }}
      />
      {pending && (
        <button
          type="button"
          onClick={() => {
            setView(pending);
            setPending(null);
            setLoading(false);
          }}
        >
          дані прийшли
        </button>
      )}
    </>
  );
}

describe("CMP-13@PoC Pagination", () => {
  it("CMP-13@PoC AC1 FR 1: 1 240 records, size 25, first page — one block «Рядків на сторінці 25 · 1–25 з 1 240» with «‹» visible and disabled", () => {
    render(<List />);
    expect(norm(nav().textContent)).toContain("Рядків на сторінці");
    expect((screen.getByRole("combobox", { name: "Рядків на сторінці" }) as HTMLSelectElement).value).toBe(
      "25",
    );
    expect(norm(nav().textContent)).toContain("1–25 з 1 240");
    expect(prev().getAttribute("aria-disabled")).toBe("true");
    expect(prev().classList.contains("ws-button")).toBe(true);
    expect(next().hasAttribute("aria-disabled")).toBe(false);
    expect(nav().tagName).toBe("NAV");
  });

  it("CMP-13@PoC FR 2: the size offers 25, 50 and 100 only", () => {
    render(<List />);
    const options = within(screen.getByRole("combobox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["25", "50", "100"]);
  });

  it("CMP-13@PoC FR 2: «›» is disabled on the last page; «‹» works from the middle; a click on a disabled arrow does nothing", () => {
    const onChange = vi.fn();
    render(<Pagination page={50} recordCount={1240} pageSize={25} onChange={onChange} />);
    expect(norm(nav().textContent)).toContain("1 226–1 240 з 1 240");
    expect(next().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(next());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(prev());
    expect(onChange).toHaveBeenCalledWith({ page: 49, pageSize: 25 });
  });

  it("CMP-13@PoC FR 2: each disabled arrow is described by its reason, which is read but not drawn", () => {
    const { rerender } = render(
      <Pagination page={1} recordCount={100} pageSize={25} onChange={() => undefined} />,
    );
    const reason = (el: HTMLElement) =>
      el
        .getAttribute("aria-describedby")!
        .split(" ")
        .map((id) => document.getElementById(id)!)
        .find((n) => n.classList.contains("ws-disabled-reason"))!;
    expect(reason(prev()).textContent).toBe("Це перша сторінка");
    expect(reason(prev()).closest(".ws-pagination__arrows")).not.toBeNull();
    rerender(<Pagination page={4} recordCount={100} pageSize={25} onChange={() => undefined} />);
    expect(reason(next()).textContent).toBe("Це остання сторінка");
  });

  it("CMP-13@PoC FR 3: while a page loads both arrows and the size are disabled and the range stays", () => {
    render(<Pagination page={2} recordCount={1240} pageSize={25} loading onChange={() => undefined} />);
    expect(prev().getAttribute("aria-disabled")).toBe("true");
    expect(next().getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
    expect(norm(nav().textContent)).toContain("26–50 з 1 240");
  });

  it("CMP-13@PoC FR 3: after «›» the range changes only when the data has arrived", () => {
    render(<List delay />);
    act(() => next().click());
    expect(norm(nav().textContent)).toContain("1–25 з 1 240");
    expect(next().getAttribute("aria-disabled")).toBe("true");
    expect(live().textContent).toBe("");
    act(() => screen.getByRole("button", { name: "дані прийшли" }).click());
    expect(norm(nav().textContent)).toContain("26–50 з 1 240");
    expect(norm(live().textContent)).toBe("Показано 26–50 з 1 240");
  });

  it("CMP-13@PoC FR 4: an empty list shows no pagination", () => {
    const { container } = render(
      <Pagination page={1} recordCount={0} pageSize={25} onChange={() => undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("CMP-13@PoC AC3: changing the size to 100 asks for the first page and shows «1–100 з 1 240»", () => {
    render(<List initial={3} />);
    expect(norm(nav().textContent)).toContain("51–75 з 1 240");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "100" } });
    expect(norm(nav().textContent)).toContain("1–100 з 1 240");
    expect(norm(live().textContent)).toBe("Показано 1–100 з 1 240");
  });

  it("CMP-13@PoC AC3: the size changes by keyboard on the native list, and the focus stays on it", () => {
    render(<List />);
    const select = screen.getByRole("combobox");
    select.focus();
    fireEvent.change(select, { target: { value: "50" } });
    expect(document.activeElement).toBe(select);
  });

  it("CMP-13@PoC AC4: «›» moves focus to the first row of the new page and announces the range politely", () => {
    render(<List />);
    expect(live().getAttribute("aria-live") ?? "polite").toBe("polite");
    expect(live().textContent).toBe("");
    act(() => next().click());
    const row = document.querySelector<HTMLElement>("[data-row]")!;
    expect(row.textContent).toBe("Рядок 26");
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("tabindex")).toBe("-1");
    expect(norm(live().textContent)).toBe("Показано 26–50 з 1 240");
  });

  it("CMP-13@PoC AC4: with a slow page the focus and the announcement wait for the data", () => {
    render(<List delay />);
    act(() => next().click());
    expect(document.activeElement).not.toBe(document.querySelector("[data-row]"));
    expect(live().textContent).toBe("");
    act(() => screen.getByRole("button", { name: "дані прийшли" }).click());
    expect(document.activeElement).toBe(document.querySelector("[data-row]"));
    expect(norm(live().textContent)).toBe("Показано 26–50 з 1 240");
  });

  it("CMP-13@PoC NFR-08 FR 4: the arrows are named for a screen reader and carry the tooltip; state is not by colour alone (disabled arrow says so)", () => {
    render(<Pagination page={1} recordCount={100} pageSize={25} onChange={() => undefined} />);
    expect(prev().getAttribute("aria-label")).toBe("Попередня сторінка");
    expect(next().getAttribute("aria-label")).toBe("Наступна сторінка");
    fireEvent.focus(next());
    expect(screen.getByRole("tooltip").textContent).toBe("Наступна сторінка");
    expect(prev().getAttribute("aria-disabled")).toBe("true");
  });

  it("CMP-13@PoC: texts come from the catalogue in the interface language", () => {
    render(
      <I18nProvider initialLocale="en">
        <Pagination page={1} recordCount={1240} pageSize={25} onChange={() => undefined} />
      </I18nProvider>,
    );
    const en = screen.getByRole("navigation", { name: "List pages" });
    expect(norm(en.textContent)).toContain("Rows per page");
    expect(norm(en.textContent)).toContain("1–25 of 1,240");
    expect(within(en).getByRole("button", { name: "Next page" })).toBeTruthy();
  });
});

describe("CMP-13@PoC list state", () => {
  /** A list that stores its page, filter and sort, and a way to leave it and come back. */
  function Screen({ listKey = "test-list" }: { listKey?: string }) {
    const [open, setOpen] = useState(false);
    return open ? (
      <button type="button" onClick={() => setOpen(false)}>
        назад
      </button>
    ) : (
      <>
        <Records listKey={listKey} />
        <button type="button" onClick={() => setOpen(true)}>
          відкрити запис
        </button>
      </>
    );
  }
  function Records({ listKey }: { listKey: string }) {
    const [state, setState] = useRestoredListState(listKey, { page: 1, filter: "", sort: "date" });
    return (
      <p>
        <span data-state>
          {state.page}|{state.filter}|{state.sort}
        </span>
        <button
          type="button"
          onClick={() => setState((s) => ({ ...s, page: 3, filter: "кафе", sort: "-amount" }))}
        >
          змінити
        </button>
      </p>
    );
  }

  beforeEach(() => {
    sessionStorage.clear();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("CMP-13@PoC AC2 FR 2: page 3, filters, sort and scroll position come back after a record is opened and «назад»", () => {
    const { rerender, container } = render(<Screen />);
    act(() => screen.getByRole("button", { name: "змінити" }).click());
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });
    act(() => void window.dispatchEvent(new Event("scroll")));
    act(() => screen.getByRole("button", { name: "відкрити запис" }).click()); // the list unmounts
    expect(container.querySelector("[data-state]")).toBeNull();
    act(() => screen.getByRole("button", { name: "назад" }).click()); // and mounts again
    expect(container.querySelector("[data-state]")!.textContent).toBe("3|кафе|-amount");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 480);
    rerender(<Screen />);
  });

  it("CMP-13@PoC AC2: a list nobody visited starts from the initial state, and a blocked sessionStorage does not break it", () => {
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = render(<Screen listKey="never-visited" />);
    expect(container.querySelector("[data-state]")!.textContent).toBe("1||date");
    blocked.mockRestore();
  });
});
