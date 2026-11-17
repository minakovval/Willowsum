import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { DateField } from "./DateField.tsx";

const TODAY = "2026-11-02";

function Controlled({ initial = TODAY, required = true }: { initial?: string; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <DateField
      label="Дата"
      required={required}
      value={value}
      onChange={setValue}
      today={TODAY}
      max={TODAY}
      chips={[
        { label: "Сьогодні", value: TODAY },
        { label: "Учора", value: "2026-11-01" },
      ]}
      limitNote="Майбутні дати недоступні — для запланованих платежів є «Регулярні платежі»."
    />
  );
}

const field = () => screen.getByRole("button", { name: /^Дата/ });
const calendar = () => screen.getByRole("dialog", { name: "Оберіть дату" });
const day = (n: number) =>
  within(calendar())
    .getAllByRole("gridcell")
    .find((c) => c.textContent === String(n))!;

describe("CMP-02@PoC Field, type «дата»", () => {
  it("CMP-02@PoC AC8: the date of a new transaction on 2 November 2026 opens November 2026 with the 2nd chosen, chips «Сьогодні» and «Учора», future days aria-disabled", () => {
    render(<Controlled />);
    expect(field().textContent).toContain("2 лист. 2026");
    expect(field().textContent).toContain("· сьогодні");
    act(() => field().click());
    expect(within(calendar()).getByText("Листопад 2026")).toBeTruthy();
    expect(day(2).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(day(2));
    expect(day(3).getAttribute("aria-disabled")).toBe("true");
    expect(day(30).getAttribute("aria-disabled")).toBe("true");
    expect(day(1).getAttribute("aria-disabled")).toBeNull();
    expect(within(calendar()).getByRole("button", { name: "Сьогодні" })).toBeTruthy();
    expect(within(calendar()).getByRole("button", { name: "Учора" })).toBeTruthy();
    expect(calendar().textContent).toContain("Майбутні дати недоступні");
    // The week starts on Monday.
    expect(within(calendar()).getAllByRole("columnheader")[0]!.textContent).toMatch(/^Пн/);
    fireEvent.click(day(5));
    expect(screen.getByRole("dialog", { name: "Оберіть дату" })).toBeTruthy();
  });

  it("CMP-02@PoC AC8: «Учора» chooses the day before, closes the calendar and gives the focus back to the field", () => {
    render(<Controlled />);
    act(() => field().click());
    act(() => within(calendar()).getByRole("button", { name: "Учора" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field().textContent).toContain("1 лист. 2026");
    expect(field().textContent).not.toContain("сьогодні");
    expect(document.activeElement).toBe(field());
  });

  it("CMP-02@PoC FR 8: arrows move by a day and a week, PageUp by a month, Enter chooses, Esc closes back to the field", () => {
    render(<Controlled />);
    act(() => field().click());
    const grid = within(calendar()).getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day(1));
    fireEvent.keyDown(grid, { key: "PageUp" });
    expect(within(calendar()).getByText("Жовтень 2026")).toBeTruthy();
    expect(document.activeElement).toBe(day(1));
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(document.activeElement).toBe(day(8));
    act(() => (document.activeElement as HTMLElement).click());
    expect(field().textContent).toContain("8 жовт. 2026");
    act(() => field().click());
    fireEvent.keyDown(calendar(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("CMP-02@PoC FR 8: Alt+↓ on the field opens the calendar; «Наступний місяць» shows December", () => {
    render(<Controlled />);
    fireEvent.keyDown(field(), { key: "ArrowDown", altKey: true });
    act(() => within(calendar()).getByRole("button", { name: "Наступний місяць" }).click());
    expect(within(calendar()).getByText("Грудень 2026")).toBeTruthy();
    expect(day(1).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(day(1));
    expect(field().textContent).toContain("2 лист. 2026");
  });

  it("CMP-02@PoC FR 8: an error is shown under the field with «Помилка.» and aria-invalid", () => {
    render(<DateField label="Дата" value="" onChange={() => {}} today={TODAY} error="Вкажіть дату." />);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Помилка. Вкажіть дату.");
  });
  it("CMP-02@PoC FR 8: an optional date with no value shows «Без дати»; a required one «Оберіть…»", () => {
    const { unmount } = render(
      <DateField label="Дата завершення" value="" onChange={() => {}} today={TODAY} />,
    );
    expect(screen.getByRole("button", { name: /^Дата завершення/ }).textContent).toContain("Без дати");
    unmount();
    render(<DateField label="Дата" required value="" onChange={() => {}} today={TODAY} />);
    expect(field().textContent).toContain("Оберіть…");
    expect(field().textContent).not.toContain("Без дати");
  });

  it("CMP-02@PoC FR 8: an optional date once chosen is cleared with «Без дати» in the calendar; a required one has no such choice", () => {
    const { unmount } = render(<Controlled required={false} />);
    act(() => field().click());
    act(() => within(calendar()).getByRole("button", { name: "Без дати" }).click());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(field().textContent).toContain("Без дати");
    expect(document.activeElement).toBe(field());
    act(() => field().click());
    // Nothing to clear when there is no date.
    expect(within(calendar()).queryByRole("button", { name: "Без дати" })).toBeNull();
    unmount();
    render(<Controlled />);
    act(() => field().click());
    expect(within(calendar()).queryByRole("button", { name: "Без дати" })).toBeNull();
  });

  it("CMP-02@PoC FR 8: Home and End move to the start and the end of the week; PageDown by a month", () => {
    render(<Controlled initial="2026-10-14" />);
    act(() => field().click());
    const grid = within(calendar()).getByRole("grid");
    fireEvent.keyDown(grid, { key: "Home" });
    expect(document.activeElement).toBe(day(12));
    fireEvent.keyDown(grid, { key: "End" });
    expect(document.activeElement).toBe(day(18));
    fireEvent.keyDown(grid, { key: "PageDown" });
    expect(within(calendar()).getByText("Листопад 2026")).toBeTruthy();
    expect(document.activeElement).toBe(day(18));
  });

  it("CMP-02@PoC FR 8: Tab out of the calendar closes it", () => {
    render(
      <>
        <Controlled />
        <input aria-label="Далі" />
      </>,
    );
    act(() => field().click());
    const next = screen.getByRole("textbox", { name: "Далі" });
    act(() => {
      fireEvent.blur(day(2), { relatedTarget: next });
      next.focus();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CMP-02@PoC FR 8: the month arrows are both on the right of the title", () => {
    render(<Controlled />);
    act(() => field().click());
    const head = calendar().querySelector(".ws-calendar-head")!;
    expect(head.firstElementChild!.textContent).toBe("Листопад 2026");
    expect([...head.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Попередній місяць",
      "Наступний місяць",
    ]);
  });
});
