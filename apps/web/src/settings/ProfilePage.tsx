import { useState, type FormEvent } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, Skeleton } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { failureOf, type Failure } from "../auth/failure.ts";
import { TextField, useFieldError } from "../auth/fields.tsx";
import { nameError } from "../auth/rules.ts";
import { AppLayout } from "../pages/AppLayout.tsx";
import { SETTINGS_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { initialsOf, isSignedOut, useProfile, type Profile } from "./api.ts";
import { PasswordChange } from "./PasswordChange.tsx";
import { ProfileLoadError } from "./parts.tsx";
import "./settings.css";

/**
 * S-187 «Профіль» (ACC-05@PoC FR 1, 2, 4, 5; board PocProfilePassword): initials, the name with «Зберегти», the
 * email read-only (no «Змінити email» in this release) and «Змінити пароль». No photo and no phone. The states of
 * the view: field placeholders while loading, «Профіль збережено», «Не вдалося зберегти. Спробуйте ще раз» with
 * the typed name kept. The profile is read again when the tab gets the focus back (FR 2).
 */
export function ProfilePage() {
  const t = useT();
  const title = t("settings.profile");
  useDocumentTitle(title);
  const { load, reload, replace } = useProfile();
  return (
    <AppLayout sectionId={null} pageId={null}>
      <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
        <ol>
          <li>
            <a href={hrefFor(SETTINGS_PATH)}>{t("shell.settings")}</a>
          </li>
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <h1>{title}</h1>
      <div className="profile-page">
        {load.state === "loading" ? (
          <section className="ws-card settings-section" aria-label={t("profile.loading")}>
            <Skeleton variant="row" lines={3} />
          </section>
        ) : load.state === "error" ? (
          <section className="ws-card settings-section" aria-label={title}>
            <ProfileLoadError failure={load.failure} onRetry={reload} />
          </section>
        ) : (
          <>
            <ProfileForm profile={load.profile} onSaved={replace} />
            <PasswordChange />
          </>
        )}
      </div>
    </AppLayout>
  );
}

type SaveState = { kind: "idle" } | { kind: "saved" } | { kind: "failed"; failure: Failure };

/**
 * The name and «Зберегти» (AC1). While the field is untouched it follows the profile as it is reloaded (another tab
 * renamed it); once edited, the typed text stays — also after a failed save — until it is saved.
 */
function ProfileForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const t = useT();
  const api = useAuthApi();
  const [draft, setDraft] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const name = draft ?? profile.name;
  const error = nameError(name);
  const errorText = useFieldError(touched ? error : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (busy || error) return;
    setBusy(true);
    setSave({ kind: "idle" });
    const o = await outcome(api.PATCH("/v1/profile", { body: { name: name.trim() } }));
    setBusy(false);
    if (o.ok) {
      setDraft(null);
      setTouched(false);
      onSaved(o.data);
      setSave({ kind: "saved" });
      return;
    }
    const failure = failureOf(o);
    setSave({
      kind: "failed",
      failure:
        o.kind === "network"
          ? { key: "profile.error.save" }
          : isSignedOut(o)
            ? { key: "settings.error.signedOut", code: failure.code }
            : failure.key === "auth.error.generic"
              ? { key: "profile.error.save", code: failure.code }
              : failure,
    });
  }

  return (
    <form
      className="ws-card settings-section profile-form"
      onSubmit={submit}
      noValidate
      aria-labelledby="profile-who"
    >
      <div className="profile-who">
        <span className="profile-initials" aria-hidden="true">
          {initialsOf(profile.name)}
        </span>
        <span className="profile-who-text">
          <b id="profile-who">{profile.name}</b>
          <span className="ws-muted">{t("profile.initialsNote")}</span>
        </span>
      </div>
      <TextField
        label={t("settings.row.name")}
        value={name}
        onChange={(v) => {
          setDraft(v);
          setSave({ kind: "idle" });
        }}
        onBlur={() => setTouched(true)}
        error={errorText}
        required
        autoComplete="name"
        name="name"
      />
      {/* FR 4, AC6: the sign-in address, read-only; no «Змінити email». */}
      <div className="profile-email">
        <span className="settings-row-label">{t("settings.row.email")}</span>
        <span>{profile.email}</span>
        <span className="ws-muted profile-email-note">{t("profile.email.note")}</span>
      </div>
      <div className="profile-actions">
        <p className="profile-status" role="status">
          {save.kind === "saved" ? (
            <>
              <Icon name="check" size={16} />
              {t("profile.saved")}
            </>
          ) : null}
        </p>
        {save.kind === "failed" ? (
          <p className="step-up-alert" role="alert">
            <Icon name="warning" size={16} />
            <span>
              {t(save.failure.key)}
              {save.failure.code ? ` · ${t("auth.error.code", { code: save.failure.code })}` : null}
            </span>
          </p>
        ) : null}
        <button type="submit" className="ws-button ws-button-primary" aria-disabled={busy || undefined}>
          {busy ? t("auth.busy") : t("profile.save")}
        </button>
      </div>
    </form>
  );
}
