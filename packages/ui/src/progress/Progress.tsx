import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { motion } from "../tokens/motion.ts";

/**
 * `running` — the fill follows `value` of `max`; `counting` — the number of steps is not known yet: an empty
 * track and «Рахуємо…»; `done` — the whole track in `gain`, «✓ Готово · N»; `error` — the fill stops where it
 * was, «✕ Помилка · N з M» in `loss` and the place's `action`.
 */
export type ProgressState = "running" | "counting" | "done" | "error";

export interface ProgressProps {
  /** The accessible name of the bar: what is in progress («Розібрано», «Поточний ··4417»). */
  label: string;
  /** Steps done (a whole number, kept within 0 … `max`). */
  value?: number;
  /** All steps. Without it the process is `counting`. */
  max?: number;
  /** Default: `counting` without `max`, otherwise `running`. */
  state?: ProgressState | undefined;
  /** What is counted, for the announcement of the completion («транзакцій» → «Готово, 1 214 транзакцій»). */
  unit?: string;
  /** While running: the status in the place's own words («Розпізнаємо сторінку 4 з 12») instead of «4 з 12 · лишилось 8». */
  text?: ReactNode;
  /** The place's action for an error («Спробувати ще раз»); shown only in the `error` state. */
  action?: ReactNode;
  /** `inline` — the text beside the bar (12 px); `stacked` — the text above it (6 px). */
  layout?: "inline" | "stacked";
  className?: string;
}

/**
 * CMP-74@PoC: the determinate progress of a long process with a known number of steps (bank sync, statement
 * pages, file upload, a bulk action, the review queue). Not a loading state (that is Skeleton, CMP-22) and not a
 * share of an amount (goal progress, budget row). A 6 px pill on a `surface-300` track; the state is always named
 * in text; no shimmer in any mode, and with reduced motion the fill changes without a transition. The bar is a
 * `progressbar` that never takes focus; one polite status beside it announces a running change at most once every
 * 5 s (`duration-progress-announce`) and the completion or an error at once.
 */
export function Progress({
  label,
  value = 0,
  max,
  state,
  unit,
  text,
  action,
  layout = "inline",
  className,
}: ProgressProps) {
  const { t, locale } = useI18n();
  const known = max !== undefined && Number.isFinite(max) && max > 0;
  const current: ProgressState = state ?? (known ? "running" : "counting");
  const determinate = known && current !== "counting";
  const total = known ? Math.floor(max) : 0;
  const done = current === "done" ? total : Math.min(total, Math.max(0, Math.floor(value)));
  const num = (n: number) => formatNumber(locale, String(n));
  const counts = { done: num(done), total: num(total), left: num(total - done) };
  const counted = (n: number) => (unit ? t("progress.withUnit", { count: num(n), unit }) : num(n));

  let spoken = "";
  if (determinate) {
    if (current === "done") spoken = t("progress.spoken.done", { count: counted(total) });
    else if (current === "error") spoken = t("progress.spoken.error", counts);
    else spoken = t("progress.spoken.running", counts);
  }
  const announcement = useThrottledAnnouncement(spoken, current === "done" || current === "error");

  const percent = determinate ? Math.round((done / total) * 10000) / 100 : 0;

  const status =
    current === "counting" ? (
      <span className="ws-progress-text">{t("progress.counting")}</span>
    ) : current === "done" ? (
      <span className="ws-progress-text ws-progress-text--done">
        {t("progress.done", { count: counts.total })}
      </span>
    ) : current === "error" ? (
      <span className="ws-progress-text ws-progress-text--error">{t("progress.error", counts)}</span>
    ) : text !== undefined ? (
      <span className="ws-progress-text">{text}</span>
    ) : (
      <span className="ws-progress-text">
        <b className="ws-progress-count">{t("progress.count", counts)}</b> {t("progress.left", counts)}
      </span>
    );

  const track = (
    <div
      className="ws-progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={determinate ? total : undefined}
      aria-valuenow={determinate ? done : undefined}
      aria-valuetext={determinate ? spoken : undefined}
    >
      {determinate && (
        <span className="ws-progress-fill" style={{ inlineSize: `${percent}%` } as CSSProperties} />
      )}
    </div>
  );
  const side = (
    <>
      {status}
      {current === "error" && action !== undefined && <span className="ws-progress-action">{action}</span>}
    </>
  );

  return (
    <div className={["ws-progress", className].filter(Boolean).join(" ")} data-state={current}>
      <div className={`ws-progress-row ws-progress-row--${layout}`}>
        {layout === "stacked" ? (
          <>
            <span className="ws-progress-head">{side}</span>
            {track}
          </>
        ) : (
          <>
            {track}
            {side}
          </>
        )}
      </div>
      {/* One polite status outside the bar: running changes at most once every 5 s, the end at once. */}
      <span role="status" className="ws-visually-hidden">
        {announcement}
      </span>
    </div>
  );
}

/**
 * The text for the live region: empty at mount (a region is announced when its text changes); then each new
 * `message` at once when `final` or when 5 s have passed since the last announcement, otherwise the latest message
 * once those 5 s are up.
 */
function useThrottledAnnouncement(message: string, final: boolean): string {
  const gap = motion["duration-progress-announce"];
  const [said, setSaid] = useState("");
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const latest = useRef(message);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // What the bar said at mount is not news; StrictMode's second effect run must not announce it either.
  const seen = useRef(message);

  useEffect(() => {
    latest.current = message;
    if (message === seen.current) return;
    seen.current = message;
    const say = () => {
      timer.current = undefined;
      lastAt.current = Date.now();
      setSaid(latest.current);
    };
    if (final) {
      clearTimeout(timer.current);
      say();
      return;
    }
    const wait = lastAt.current + gap - Date.now();
    if (wait <= 0) {
      clearTimeout(timer.current);
      say();
    } else if (timer.current === undefined) timer.current = setTimeout(say, wait);
  }, [message, final, gap]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return said;
}
