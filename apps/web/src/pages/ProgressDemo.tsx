import { useState } from "react";
import { formatNumber, useI18n } from "@willowsum/i18n";
import { Progress, type ProgressState } from "@willowsum/ui";

/**
 * CMP-74@PoC Progress in the design-system gallery: every state on synthetic values (the review queue, counting,
 * text above the bar, parallel account syncs with done, running and error rows) and a live case whose buttons step,
 * fail and finish the process so the announcements can be heard.
 */
const LIVE_TOTAL = 6;

export function ProgressDemo() {
  const { t, locale } = useI18n();
  const [step, setStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const liveState: ProgressState = failed ? "error" : step >= LIVE_TOTAL ? "done" : "running";
  const retry = (
    <button type="button" className="ws-button">
      {t("gallery.progress.retry")}
    </button>
  );
  const num = (n: number) => formatNumber(locale, String(n));

  return (
    <div className="gallery-progress">
      <p className="ws-muted">{t("gallery.progress.intro")}</p>
      <div className="gallery-progress__grid">
        <figure className="gallery-progress__case" data-case="queue">
          <figcaption className="ws-text-label ws-muted">{t("gallery.progress.queue")}</figcaption>
          <div className="ws-card">
            <Progress label={t("gallery.progress.queueLabel")} value={31} max={103} />
          </div>
        </figure>
        <figure className="gallery-progress__case" data-case="counting">
          <figcaption className="ws-text-label ws-muted">{t("gallery.progress.counting")}</figcaption>
          <div className="ws-card">
            <Progress label={t("gallery.progress.queueLabel")} />
          </div>
        </figure>
        <figure className="gallery-progress__case" data-case="stacked">
          <figcaption className="ws-text-label ws-muted">{t("gallery.progress.stacked")}</figcaption>
          <div className="ws-card">
            <Progress
              label={t("gallery.progress.pagesLabel")}
              value={4}
              max={12}
              layout="stacked"
              unit={t("gallery.progress.pagesUnit")}
              text={t("gallery.progress.pages", { done: num(4), total: num(12) })}
            />
          </div>
        </figure>
      </div>

      <figure className="gallery-progress__case" data-case="sync">
        <figcaption className="ws-text-label ws-muted">{t("gallery.progress.sync")}</figcaption>
        <ul className="ws-card gallery-progress__rows">
          <li data-row="done">
            <span className="gallery-progress__name">{t("gallery.progress.account1")}</span>
            <Progress
              label={t("gallery.progress.account1")}
              value={1214}
              max={1214}
              state="done"
              unit={t("gallery.progress.transactions")}
            />
          </li>
          <li data-row="running">
            <span className="gallery-progress__name">{t("gallery.progress.account2")}</span>
            <Progress
              label={t("gallery.progress.account2")}
              value={500}
              max={1200}
              unit={t("gallery.progress.transactions")}
            />
          </li>
          <li data-row="error">
            <span className="gallery-progress__name">{t("gallery.progress.statement")}</span>
            <Progress
              label={t("gallery.progress.statement")}
              value={4}
              max={12}
              state="error"
              unit={t("gallery.progress.pagesUnit")}
              action={retry}
            />
          </li>
        </ul>
      </figure>

      <figure className="gallery-progress__case" data-case="live">
        <figcaption className="ws-text-label ws-muted">{t("gallery.progress.live")}</figcaption>
        <div className="ws-card gallery-progress__live">
          <Progress
            label={t("gallery.progress.liveLabel")}
            value={step}
            max={LIVE_TOTAL}
            state={liveState}
            unit={t("gallery.progress.filesUnit")}
            action={
              <button type="button" className="ws-button" onClick={() => setFailed(false)}>
                {t("gallery.progress.retry")}
              </button>
            }
          />
          <div className="gallery-progress__buttons">
            <button
              type="button"
              className="ws-button"
              disabled={liveState !== "running"}
              onClick={() => setStep((s) => Math.min(LIVE_TOTAL, s + 1))}
            >
              {t("gallery.progress.step")}
            </button>
            <button
              type="button"
              className="ws-button"
              disabled={liveState !== "running"}
              onClick={() => setFailed(true)}
            >
              {t("gallery.progress.fail")}
            </button>
            <button
              type="button"
              className="ws-button"
              onClick={() => {
                setStep(0);
                setFailed(false);
              }}
            >
              {t("gallery.progress.reset")}
            </button>
          </div>
        </div>
      </figure>
    </div>
  );
}
