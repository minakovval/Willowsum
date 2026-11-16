import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Stepper, type StepState } from "./Stepper.tsx";

const NAMES = ["Основне", "Контрагент і категорія", "Додатково"];
const steps = (...states: StepState[]) => states.map((state, i) => ({ label: NAMES[i]!, state }));
const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/components.css"),
  "utf8",
);
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("CMP-14@PoC Stepper", () => {
  it("CMP-14@PoC AC1: on step 2 of «Нова транзакція» step 1 has «✓» on gain and can be pressed, step 2 is the pill with aria-current, step 3 its number on surface-300", () => {
    const onSelect = vi.fn();
    render(<Stepper label="Кроки форми" steps={steps("done", "current", "available")} onSelect={onSelect} />);
    const list = screen.getByRole("list", { name: "Кроки форми" });
    const [one, two, three] = [...list.querySelectorAll("button")];
    expect(one!.getAttribute("aria-label")).toBe("Крок 1: Основне — заповнено");
    expect(one!.dataset["state"]).toBe("done");
    expect(one!.querySelector(".ws-stepper-mark svg")).toBeTruthy();
    expect(two!.getAttribute("aria-current")).toBe("step");
    expect(two!.getAttribute("aria-label")).toBe("Крок 2: Контрагент і категорія");
    expect(three!.textContent).toContain("3");
    expect(rule('.ws-stepper-step[data-state="done"] .ws-stepper-mark')).toMatch(
      /background: var\(--ws-gain\)/,
    );
    expect(rule('.ws-stepper-step[data-state="current"]')).toMatch(/background: var\(--ws-tint-info\)/);
    expect(rule('.ws-stepper-step[data-state="current"] .ws-stepper-mark')).toMatch(
      /background: var\(--ws-brand\)/,
    );
    expect(rule(".ws-stepper-mark")).toMatch(/background: var\(--ws-surface-300\)/);
    fireEvent.click(one!);
    expect(onSelect).toHaveBeenCalledWith(0);
    fireEvent.click(two!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("CMP-14@PoC AC3: on step 3 with steps 1 and 2 passed a press on step 1 opens it", () => {
    const onSelect = vi.fn();
    render(<Stepper label="Кроки форми" steps={steps("done", "done", "current")} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Крок 1: Основне — заповнено" }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("CMP-14@PoC AC4: an empty required field on step 1 — steps 2 and 3 are unavailable, aria-disabled, a press or Enter does nothing", () => {
    const onSelect = vi.fn();
    render(
      <Stepper
        label="Кроки форми"
        steps={steps("current", "unavailable", "unavailable")}
        onSelect={onSelect}
      />,
    );
    const two = screen.getByRole("button", { name: "Крок 2: Контрагент і категорія — ще недоступний" });
    expect(two.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(two);
    fireEvent.keyDown(two, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(rule('.ws-stepper-step[data-state="unavailable"] .ws-stepper-mark')).toMatch(
      /background: var\(--ws-disabled-bg\)/,
    );
  });

  it("CMP-14@PoC AC5: a passed step whose required field became empty has «!» on tint-warning and its name ends «— є помилка»", () => {
    render(
      <Stepper label="Кроки форми" steps={steps("error", "current", "unavailable")} onSelect={() => {}} />,
    );
    const one = screen.getByRole("button", { name: "Крок 1: Основне — є помилка" });
    expect(one.querySelector(".ws-stepper-mark")!.textContent).toBe("!");
    expect(rule('.ws-stepper-step[data-state="error"] .ws-stepper-mark')).toMatch(
      /background: var\(--ws-tint-warning\)/,
    );
  });

  it("CMP-14@PoC AC6: each step reads its number, name and state", () => {
    render(
      <Stepper label="Кроки форми" steps={steps("done", "current", "unavailable")} onSelect={() => {}} />,
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Крок 1: Основне — заповнено",
      "Крок 2: Контрагент і категорія",
      "Крок 3: Додатково — ще недоступний",
    ]);
  });
});
