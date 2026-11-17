import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@willowsum/i18n";
import { CONTRAST_PAIRS } from "../tokens/index.ts";
import { Skeleton } from "../skeleton/Skeleton.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { ErrorState } from "./ErrorState.tsx";
import { NoAccessState } from "./NoAccessState.tsx";
import { PartialDataBanner } from "./PartialDataBanner.tsx";

/**
 * DAT-05@PoC «Стани екранів»: the shared empty, error, «Немає доступу» and partial-data states. The loading state is
 * CMP-22 (`Skeleton`), checked here only for its 3 s line.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("DAT-05@PoC states", () => {
  it("DAT-05@PoC FR 2, AC1, AC2: the empty list explains and offers the main and one other action", () => {
    wrap(
      <EmptyState
        title="Транзакцій ще немає"
        text="Додайте першу вручну або імпортуйте виписку."
        icon="transactions"
        primary={{ label: "Імпортувати виписку" }}
        secondary={{ label: "Додати вручну" }}
      />,
    );
    const region = screen.getByRole("region", { name: "Транзакцій ще немає" });
    expect(within(region).getByRole("heading", { level: 2 }).textContent).toBe("Транзакцій ще немає");
    expect(within(region).getByText("Додайте першу вручну або імпортуйте виписку.")).toBeTruthy();
    expect(
      within(region)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Імпортувати виписку", "Додати вручну"]);
    expect(region.querySelector(".ws-button-primary")!.textContent).toBe("Імпортувати виписку");
  });

  it("DAT-05@PoC FR 2: an action the user's rights do not allow is not shown", () => {
    wrap(
      <EmptyState
        placement="block"
        title="Бюджету ще немає"
        text="Створіть бюджет — тут з’явиться, скільки можна витратити."
        primary={{ label: "Створити бюджет", allowed: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Створити бюджет" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Бюджету ще немає");
  });

  it("DAT-05@PoC FR 2: an action that leads to a page is a link", () => {
    wrap(<EmptyState title="Т" text="Х" primary={{ label: "Імпортувати", href: "#/import" }} />);
    expect(screen.getByRole("link", { name: "Імпортувати" }).getAttribute("href")).toBe("#/import");
  });

  it("DAT-05@PoC FR 3, AC3: loading is a skeleton, and after 3 s «Ще завантажується…» appears under it", () => {
    vi.useFakeTimers();
    const { container } = wrap(<Skeleton variant="row" lines={3} />);
    expect(container.querySelectorAll(".ws-skeleton-row")).toHaveLength(3);
    expect(screen.queryByText("Ще завантажується…")).toBeNull();
    act(() => void vi.advanceTimersByTime(2900));
    expect(screen.queryByText("Ще завантажується…")).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByText("Ще завантажується…")).toBeTruthy();
  });

  it("DAT-05@PoC FR 4: an error shows «✕ Помилка», what failed, the code, and «Спробувати ще раз» asks again", () => {
    const retry = vi.fn();
    wrap(<ErrorState text="Не вдалося завантажити транзакції." code="TX-503" onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("✕ Помилка");
    expect(within(alert).getByText("Не вдалося завантажити транзакції.")).toBeTruthy();
    expect(within(alert).getByText("Код: TX-503")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Спробувати ще раз" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("DAT-05@PoC FR 4: the error does not rely on colour alone and the technical details stay out", () => {
    wrap(<ErrorState text="Не вдалося показати картку. Решта сторінки працює." onRetry={() => undefined} />);
    const alert = screen.getByRole("alert");
    // The word is read; the «✕» marker is decoration.
    expect(alert.querySelector('[aria-hidden="true"]')!.textContent).toContain("✕");
    expect(alert.textContent).toContain("Помилка");
    // No code given: no «Код:» line.
    expect(alert.textContent).not.toContain("Код");
  });

  it("DAT-05@PoC FR 4: the error of one widget leaves the neighbouring widgets as they are", () => {
    wrap(
      <div>
        <ErrorState text="Не вдалося показати картку." code="BUD-500" onRetry={() => undefined} />
        <section aria-label="Можна витратити">12 480,00 ₴</section>
      </div>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Можна витратити" }).textContent).toBe("12 480,00 ₴");
  });

  it("DAT-05@PoC FR 4: a retry in progress shows the button as busy, and the first load speaks politely", () => {
    const { container } = wrap(
      <ErrorState text="Не вдалося." onRetry={() => undefined} retrying role="status" />,
    );
    expect(container.querySelector("section")!.getAttribute("role")).toBe("status");
    expect(container.querySelector("section")!.getAttribute("data-state")).toBe("error");
    expect(screen.getByRole("button", { name: /Спробувати ще раз/ }).getAttribute("aria-busy")).toBe("true");
  });

  it("DAT-05@PoC FR 5, AC4, EC1: partial data keeps what is there under «Частина даних не оновлена» with the import link", () => {
    wrap(<PartialDataBanner importHref="#/money/import-history" text="Одне з джерел недоступне." />);
    const banner = screen.getByRole("status");
    expect(within(banner).getByText("Частина даних не оновлена")).toBeTruthy();
    expect(within(banner).getByText("Одне з джерел недоступне.")).toBeTruthy();
    expect(
      within(banner).getByRole("link", { name: "Результат останнього імпорту" }).getAttribute("href"),
    ).toBe("#/money/import-history");
  });

  it("DAT-05@PoC FR 6: «Немає доступу» for a module has one h1, the text and «На Головну», and no names, counts or sums", () => {
    wrap(
      <NoAccessState
        title="Немає доступу"
        text="Цей розділ для вас закритий у налаштуваннях простору."
        action={{ label: "На Головну", href: "#/" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Немає доступу");
    expect(screen.getByRole("link", { name: "На Головну" }).getAttribute("href")).toBe("#/");
    expect(document.body.textContent).not.toMatch(/\d/);
  });

  it("DAT-05@PoC FR 6: «Немає доступу» for a widget is an h3 with no action and differs from the empty state", () => {
    wrap(<NoAccessState scope="widget" title="Немає доступу" text="Цей віджет закритий." />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Немає доступу");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.querySelector('[data-state="no-access"]')).not.toBeNull();
    expect(document.querySelector('[data-state="empty"]')).toBeNull();
  });

  it("DAT-05@PoC FR 8: the texts the components add come from the localization", () => {
    render(
      <I18nProvider initialLocale="en">
        <ErrorState text="Could not load." code="X-1" onRetry={() => undefined} />
        <PartialDataBanner importHref="#/i" />
      </I18nProvider>,
    );
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.getByText("Code: X-1")).toBeTruthy();
    expect(screen.getByText("Some data is not updated")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("✕ Error");
  });

  it("DAT-05@PoC FR 1: the colour pairs of the states pass in both themes", () => {
    const has = (fg: string, bg: string) => CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg === bg);
    expect(has("loss", "surface-200")).toBe(true);
    expect(has("ink-muted", "surface-200")).toBe(true);
    expect(has("on-warning", "tint-warning")).toBe(true);
    expect(has("brand", "tint-info")).toBe(true);
    expect(has("brand", "surface-300")).toBe(true);
    expect(has("ink", "surface-300")).toBe(true);
  });
});
