import { formatDate, formatMoney, formatNumber, formatPercent, useI18n } from "@willowsum/i18n";
import {
  DeviationMark,
  Stepper,
  STATUS_DICTIONARY,
  STATUS_FAMILIES,
  StatusMark,
  UsageStatus,
  type StepperStep,
  type StepState,
} from "@willowsum/ui";

/**
 * DS-23@PoC status dictionary in the design-system gallery (a developer tool, not DS-22): the whole dictionary by
 * family on synthetic values (each entry as a real mark with its id, tone, marker and source requirements), the
 * usage scale in every state and the eight overspend levels, the deviation steps and the form steps.
 */
const STEP_STATES: readonly StepState[] = ["current", "done", "available", "unavailable", "error"];
const OVER_SHARES = [2, 7, 15, 35, 75, 150, 350, 800] as const;

export function StatusDemo() {
  const { t, locale } = useI18n();
  const money = (value: string) => formatMoney(locale, value, "EUR");
  const num = (n: number) => formatNumber(locale, String(n));
  const params = {
    amount: money("50.20"),
    percent: formatPercent(locale, "86"),
    date: formatDate(locale, "2026-11-05"),
    days: num(5),
    count: num(3),
    months: num(2),
    month: t("gallery.status.month"),
    state: t("gallery.status.filterState"),
    total: num(9),
    covered: money("120"),
    fields: t("gallery.status.fields"),
  };
  const steps: StepperStep[] = STEP_STATES.map((state, i) => ({
    label: t("gallery.status.step", { number: num(i + 1) }),
    state,
  }));
  const stepper = (s: readonly StepperStep[]) => <Stepper steps={s} onSelect={() => {}} />;

  return (
    <div className="gallery-status">
      <p className="ws-muted">{t("gallery.status.intro")}</p>

      {STATUS_FAMILIES.map((family) => (
        <figure className="gallery-status__family" key={family.id} data-family={family.id}>
          <figcaption className="ws-text-label ws-muted">{t(family.titleKey)}</figcaption>
          <table className="gallery-status__table">
            <thead>
              <tr>
                <th scope="col">{t("gallery.status.col.state")}</th>
                <th scope="col">{t("gallery.status.col.id")}</th>
                <th scope="col">{t("gallery.status.col.tone")}</th>
                <th scope="col">{t("gallery.status.col.source")}</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_DICTIONARY.filter((e) => e.family === family.id).map((e) => (
                <tr key={e.id} data-status-row={e.id}>
                  <td>
                    {e.family === "k" && e.id !== "k.hint" ? (
                      <span className="ws-muted">
                        {t(e.textKey, { number: num(1), step: t("gallery.status.step", { number: num(1) }) })}
                      </span>
                    ) : (
                      <StatusMark id={e.id} params={params} arrow="▲" />
                    )}
                  </td>
                  <td>
                    <code>{e.id}</code>
                  </td>
                  <td>
                    {e.tone} · {e.marker || t("gallery.status.noMarker")} · {e.ink}
                  </td>
                  <td>{e.sources.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      ))}

      <figure className="gallery-status__case" data-case="usage">
        <figcaption className="ws-text-label ws-muted">{t("gallery.status.usage")}</figcaption>
        <div className="gallery-status__grid">
          {([0, 35, 60, 86, 100] as const).map((spent) => (
            <div className="ws-card" key={spent} data-usage={spent}>
              <UsageStatus spent={spent} limit={100} />
            </div>
          ))}
          <div className="ws-card" data-usage="mandatory">
            <UsageStatus spent={100} limit={100} mandatory />
          </div>
        </div>
      </figure>

      <figure className="gallery-status__case" data-case="over">
        <figcaption className="ws-text-label ws-muted">{t("gallery.status.over")}</figcaption>
        <div className="gallery-status__grid">
          {OVER_SHARES.map((share) => (
            <div className="ws-card" key={share} data-over={share}>
              <UsageStatus spent={100 + share} limit={100} optionalLimits={100} />
            </div>
          ))}
        </div>
      </figure>

      <figure className="gallery-status__case" data-case="deviation">
        <figcaption className="ws-text-label ws-muted">{t("gallery.status.deviation")}</figcaption>
        <ul className="ws-card gallery-status__row">
          {(
            [
              [400, 500, "expense"],
              [480, 500, "expense"],
              [5600.4, 5600, "income"],
              [550.2, 500, "expense"],
              [650, 500, "expense"],
              [400, 500, "income"],
            ] as const
          ).map(([value, base, kind]) => (
            <li key={`${value}-${kind}`}>
              <DeviationMark
                value={value}
                base={base}
                kind={kind}
                amount={money(String(Math.abs(Math.round((value - base) * 100) / 100)))}
              />
            </li>
          ))}
        </ul>
      </figure>

      <figure className="gallery-status__case" data-case="steps">
        <figcaption className="ws-text-label ws-muted">{t("gallery.status.steps")}</figcaption>
        <div className="ws-card">{stepper(steps)}</div>
      </figure>
    </div>
  );
}
