import { render, screen } from "@testing-library/react";
import { formatDate, I18nProvider } from "@willowsum/i18n";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { AuthApiProvider } from "../auth/api.ts";
import { fakeApi, plain } from "../auth/testing.tsx";
import type { Run } from "./api.ts";
import { RunNotice } from "./RunNotice.tsx";

/**
 * BUD-14@PoC FR 7, AC6 (follow-up of #511, issue #516): the line «Відмінити можна до {date}» of the run summary. Only
 * `RunNotice` is rendered. Synthetic data only.
 */
const RUN: Run = {
  id: "00000000-0000-4000-8000-0000000000f1",
  ruleId: "00000000-0000-4000-8000-0000000000e1",
  status: "completed",
  count: 14,
  changed: 12,
  progress: { done: 14, total: 14 },
  skipped: { manual: 1, unavailable: 1 },
  undo: { available: true, until: "2026-11-24T10:00:00Z", restored: 0, notRestored: 0 },
  createdAt: "2026-11-17T10:00:00Z",
  endedAt: "2026-11-17T10:00:05Z",
} as unknown as Run;

function show(run: Run) {
  render(
    <I18nProvider initialLocale="uk">
      <AuthApiProvider value={fakeApi({}).client}>
        <RunNotice
          run={run}
          onChange={() => undefined}
          onReload={() => undefined}
          onDismiss={() => undefined}
        />
      </AuthApiProvider>
    </I18nProvider>,
  );
}

beforeEach(() => installMatchMedia({ width: 1280 }));

describe("BUD-14@PoC AC6: «Відмінити можна до {date}»", () => {
  it("BUD-14@PoC AC6: a finished run that can be undone says until which day, as the user's calendar shows it", () => {
    // Noon of the day in the user's time zone, so the expected day does not depend on the machine's zone.
    show({ ...RUN, undo: { ...RUN.undo, until: new Date(2026, 10, 24, 12).toISOString() } });
    const line = screen.getByText(/^Відмінити можна до /);
    expect(plain(line.textContent)).toBe(`Відмінити можна до ${formatDate("uk", "2026-11-24")}`);
    expect(plain(line.textContent)).toMatch(/24/);
    expect(plain(line.textContent)).toMatch(/2026/);
    expect(screen.getByRole("button", { name: "Відмінити" })).toBeTruthy();
  });

  it("BUD-14@PoC AC6: past the 7 days there is no deadline line and no «Відмінити»", () => {
    show({ ...RUN, undo: { ...RUN.undo, available: false } });
    expect(screen.queryByText(/Відмінити можна до/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Відмінити" })).toBeNull();
  });

  it("BUD-14@PoC AC6: a run that was undone shows the result, not the deadline", () => {
    show({ ...RUN, status: "undone", undo: { ...RUN.undo, available: false, restored: 11, notRestored: 1 } });
    expect(screen.queryByText(/Відмінити можна до/)).toBeNull();
    expect(screen.getByText("Запуск відмінено: відновлено 11, не відновлено 1")).toBeTruthy();
  });
});
