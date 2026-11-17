import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListToolbar } from "./ListToolbar.tsx";

function Bar({ status }: { status?: string }) {
  return (
    <ListToolbar
      label="Керування списком"
      status={status}
      end={
        <button type="button" aria-label="Параметри">
          ⚙
        </button>
      }
    >
      <input type="search" aria-label="Пошук" defaultValue="abc" />
      <button type="button">Фільтри</button>
    </ListToolbar>
  );
}

describe("CMP-60@PoC Toolbar", () => {
  it("CMP-60@PoC AC4, FR «Клавіатура і екранний читач»: a named toolbar with one control in the Tab order; → and ← move between the controls, in a text field only from its end or start", () => {
    render(<Bar />);
    const bar = screen.getByRole("toolbar", { name: "Керування списком" });
    const search = screen.getByRole("searchbox") as HTMLInputElement;
    const filters = screen.getByRole("button", { name: "Фільтри" });
    const options = screen.getByRole("button", { name: "Параметри" });
    expect([search, filters, options].map((el) => el.tabIndex)).toEqual([0, -1, -1]);
    act(() => search.focus());
    search.setSelectionRange(1, 1);
    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(document.activeElement).toBe(search);
    search.setSelectionRange(3, 3);
    fireEvent.keyDown(search, { key: "ArrowRight" });
    expect(document.activeElement).toBe(filters);
    fireEvent.keyDown(filters, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options);
    fireEvent.keyDown(options, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options);
    expect([search, filters, options].map((el) => el.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(options, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(filters);
    expect(bar.contains(document.activeElement)).toBe(true);
  });

  it("CMP-60@PoC FR «Клавіатура і екранний читач»: the change of the number of results is announced politely", () => {
    const { rerender } = render(<Bar />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    rerender(<Bar status="Знайдено 42 транзакції" />);
    expect(status.textContent).toBe("Знайдено 42 транзакції");
  });
});
