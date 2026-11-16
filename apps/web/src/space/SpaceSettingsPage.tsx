import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT, type MessageKey } from "@willowsum/i18n";
import { Skeleton } from "@willowsum/ui";
import { outcome, useAuthApi } from "../auth/api.ts";
import { TextField } from "../auth/fields.tsx";
import { AppLayout } from "../pages/AppLayout.tsx";
import { EmptyState } from "../pages/SectionPage.tsx";
import { SETTINGS_PATH } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { publishSpace, useSpace, type Space } from "./api.ts";
import "./space.css";

/**
 * S-200 «Налаштування → Простір» (canvas PocSettingsSpace): the space's name with renaming by its Owner
 * (ACC-08@PoC FR 5, AC5) and the reporting currency, read only — EUR, set when the space is created, with no choice
 * (ACC-06@PoC FR 1, FR 2). Transfer of ownership, deletion and the inactivity time-out are later releases.
 */
export function SpaceSettingsPage() {
  const t = useT();
  const title = t("space.title");
  useDocumentTitle(title);
  const { state, retry } = useSpace();

  return (
    <AppLayout sectionId={null} pageId={null}>
      <div className="space-page">
        <nav className="ws-breadcrumbs" aria-label={t("shell.breadcrumbs")}>
          <ol>
            <li>
              <a href={hrefFor(SETTINGS_PATH)}>{t("shell.settings")}</a>
            </li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
        <div className="space-head">
          <h1>{title}</h1>
          {state.kind !== "off" ? <p className="ws-muted">{t("space.subtitle")}</p> : null}
        </div>
        {state.kind === "loading" ? (
          <section className="ws-card space-card">
            <Skeleton variant="text" lines={4} />
          </section>
        ) : state.kind === "off" ? (
          <EmptyState icon="settings" />
        ) : state.kind === "error" ? (
          <LoadError supportId={state.supportId} retry={retry} />
        ) : (
          <>
            <NameCard space={state.space} />
            <CurrencyCard currency={state.space.reportingCurrency} />
          </>
        )}
      </div>
    </AppLayout>
  );
}

const NAME_MAX = 60;
/** Nothing but spaces and format characters (zero-width space, joiners) counts as empty, as on the server. */
const BLANK = /^[\s\p{Cf}]*$/u;

/** The name as the server counts it: NFC, trimmed, in code points (an emoji is one character). */
const visibleName = (value: string): string => value.normalize("NFC").trim();
const lengthOf = (value: string): number => [...visibleName(value)].length;

/** AC5: an empty name or one over 60 characters is not saved. The server checks the one-line rule too. */
function checkName(value: string): MessageKey | null {
  const name = visibleName(value);
  if (BLANK.test(name)) return "space.name.error.empty";
  if ([...name].length > NAME_MAX) return "space.name.error.long";
  return null;
}

type Failure = { readonly key: MessageKey; readonly code?: string | undefined };

/** ACC-08@PoC FR 5, AC5: the one field of the section, «Скасувати» and «Зберегти». */
function NameCard({ space }: { space: Space }) {
  const t = useT();
  const api = useAuthApi();
  const [saved, setSaved] = useState(space.name);
  const [value, setValue] = useState(space.name);
  const [error, setError] = useState<MessageKey | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [focusError, setFocusError] = useState(0);
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // After the render that marks the field, focus moves to it (the error is its description).
  useEffect(() => {
    if (focusError > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  const invalid = (key: MessageKey) => {
    setError(key);
    setFocusError((n) => n + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    setFailure(null);
    setDone(false);
    const found = checkName(value);
    if (found) {
      invalid(found);
      return;
    }
    setError(null);
    busy.current = true;
    setSaving(true);
    const o = await outcome(api.PATCH("/v1/space", { body: { name: value } }));
    busy.current = false;
    setSaving(false);
    if (o.ok) {
      publishSpace(api, o.data);
      setSaved(o.data.name);
      setValue(o.data.name);
      setDone(true);
    } else if (o.kind === "problem" && o.problem.code === "VALIDATION_FAILED") {
      invalid("space.name.error.invalid");
    } else {
      // «Помилка» (ACC-08 «Стани інтерфейсу»): the space keeps its name; the typed one stays for another try.
      setFailure(
        o.kind === "network"
          ? { key: "space.error.network" }
          : { key: "space.error.save", code: o.supportId },
      );
    }
  };

  const cancel = () => {
    setValue(saved);
    setError(null);
    setFailure(null);
    setDone(false);
  };

  return (
    <section className="ws-card space-card" aria-labelledby="space-name-title">
      <h2 id="space-name-title" className="space-card-title">
        {t("space.name.title")}
      </h2>
      <form ref={formRef} className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
        <TextField
          label={t("space.name.label")}
          name="spaceName"
          autoComplete="off"
          required
          value={value}
          onChange={(next) => {
            setValue(next);
            setError(null);
            setDone(false);
          }}
          error={error ? t(error) : null}
          hint={t("space.name.hint", { count: String(lengthOf(value)), max: String(NAME_MAX) })}
        />
        {failure ? (
          <div className="space-failure" role="alert">
            <p>{t(failure.key)}</p>
            {failure.code ? (
              <p className="ws-muted">{t("space.error.code", { code: failure.code })}</p>
            ) : null}
          </div>
        ) : null}
        <div className="space-actions">
          <p role="status" className="space-saved">
            {done ? t("space.name.saved") : ""}
          </p>
          <button type="button" className="ws-button" onClick={cancel}>
            {t("space.name.cancel")}
          </button>
          <button type="submit" className="ws-button ws-button-primary" aria-disabled={saving || undefined}>
            {t(saving ? "space.name.saving" : "space.name.save")}
          </button>
        </div>
      </form>
    </section>
  );
}

/** ACC-06@PoC FR 1, FR 2: the reporting currency, read only — no control chooses it in this release. */
function CurrencyCard({ currency }: { currency: string }) {
  const t = useT();
  return (
    <section className="ws-card space-card" aria-labelledby="space-currency-title">
      <h2 id="space-currency-title" className="space-card-title">
        {t("space.currency.title")}
      </h2>
      <dl className="space-facts">
        <div>
          <dt>{t("space.currency.label")}</dt>
          <dd>{t("space.currency.value", { currency })}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Error: «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (PocStates). */
function LoadError({ supportId, retry }: { supportId: string | undefined; retry: () => void }) {
  const t = useT();
  return (
    <section className="ws-card space-card space-error" role="alert">
      <p className="space-error-title">{t("space.load.error.title")}</p>
      <p>{t("space.load.error.body")}</p>
      <button type="button" className="ws-button" onClick={retry}>
        {t("space.load.error.retry")}
      </button>
      {supportId ? <p className="ws-muted">{t("space.error.code", { code: supportId })}</p> : null}
    </section>
  );
}
