import { useT } from "@willowsum/i18n";
import { Button } from "../button/Button.tsx";
import type { StatePlacement } from "./EmptyState.tsx";

export interface ErrorStateProps {
  placement?: StatePlacement;
  /** What failed, in plain words, without the word «Помилка» and without technical details. */
  text: string;
  /** The request id for support; the component writes «Код: …» on its own line. */
  code?: string | undefined;
  onRetry: () => void;
  /** The retry is running: the button shows its loading state. */
  retrying?: boolean;
  /** `alert` for an error after a user action; `status` for the first load of a page, so it does not interrupt. */
  role?: "alert" | "status";
}

/**
 * DAT-05@PoC FR 4 «Помилка»: «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (canvas «PoC · Стани»). The
 * error of one widget stays inside its place and never breaks the others. The marker is not the only sign: the word
 * «Помилка» is read, the «✕» is decoration.
 */
export function ErrorState({
  placement = "block",
  text,
  code,
  onRetry,
  retrying = false,
  role = "alert",
}: ErrorStateProps) {
  const t = useT();
  // The text is «✕ Помилка»: the first word is the marker (decoration), the rest is read.
  const [marker = "", ...rest] = t("state.error.title").split(" ");
  const word = rest.join(" ");
  return (
    <section className="ws-state" data-state="error" data-placement={placement} role={role}>
      <p className="ws-state-title">
        <span aria-hidden="true">{marker} </span>
        {word}
      </p>
      <p className="ws-state-text">{text}</p>
      <div className="ws-state-actions">
        <Button label={t("state.error.retry")} onClick={onRetry} loading={retrying} />
      </div>
      {code ? <p className="ws-state-code">{t("state.error.code", { code })}</p> : null}
    </section>
  );
}
