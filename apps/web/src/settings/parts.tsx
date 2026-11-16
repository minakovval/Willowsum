import { useT } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import { failureOf } from "../auth/failure.ts";
import { AUTH_PATHS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { isSignedOut, type Failed } from "./api.ts";

const SIGN_IN_PATH = Object.keys(AUTH_PATHS).find((p) => AUTH_PATHS[p] === "signIn")!;

/**
 * The error state of the profile (П-13, board PocStates): «✕ Не вдалося завантажити профіль», the reason,
 * «Спробувати ще раз» and «Код: …» (ARC-09 FR 3). An ended session (401) offers «Увійти» instead.
 */
export function ProfileLoadError({ failure, onRetry }: { failure: Failed; onRetry: () => void }) {
  const t = useT();
  const signedOut = isSignedOut(failure);
  const reason = failureOf(failure);
  return (
    <div className="settings-error" role="alert">
      <p className="settings-error-title">
        <Icon name="close" size={16} />
        <span>{t("settings.error.load")}</span>
      </p>
      <p className="ws-muted">{signedOut ? t("settings.error.signedOut") : t(reason.key)}</p>
      <p>
        {signedOut ? (
          <a className="ws-button" href={hrefFor(SIGN_IN_PATH)}>
            {t("settings.signIn")}
          </a>
        ) : (
          <button type="button" className="ws-button" onClick={onRetry}>
            {t("settings.error.retry")}
          </button>
        )}
      </p>
      {reason.code ? (
        <p className="ws-muted settings-code">{t("auth.error.code", { code: reason.code })}</p>
      ) : null}
    </div>
  );
}

export { SIGN_IN_PATH };
