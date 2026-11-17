import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";

export interface PartialDataBannerProps {
  /** The link to the result of the last import (DAT-05@PoC FR 5). */
  importHref: string;
  /** What exactly is not updated, one sentence; optional. */
  text?: string;
}

/**
 * DAT-05@PoC FR 5 «Часткові дані»: one of the sources is unavailable, so the page shows what it has under this
 * banner «Частина даних не оновлена» with a link to the last import's result. A warning with a symbol and words
 * (colour is not the only sign); a polite status, not an alert.
 */
export function PartialDataBanner({ importHref, text }: PartialDataBannerProps) {
  const t = useT();
  return (
    <div className="ws-state-banner" role="status" data-state="partial">
      <Icon name="warning" size={20} />
      <div>
        <p className="ws-state-banner-title">{t("state.partial.title")}</p>
        {text ? <p className="ws-state-banner-text">{text}</p> : null}
        <a className="ws-link" href={importHref}>
          {t("state.partial.link")}
        </a>
      </div>
    </div>
  );
}
