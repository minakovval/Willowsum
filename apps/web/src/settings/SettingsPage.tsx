import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Skeleton } from "@willowsum/ui";
import { AppLayout } from "../pages/AppLayout.tsx";
import {
  CATEGORIES_SETTINGS_PATH,
  IMPORT_WIZARD_PATH,
  PROFILE_PATH,
  SETTINGS_PATH,
  SPACE_SETTINGS_PATH,
} from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import { useSpaceName } from "../space/api.ts";
import { useDocumentTitle } from "../useDocumentTitle.ts";
import { useProfile } from "./api.ts";
import { ProfileLoadError } from "./parts.tsx";
import "./settings.css";

/**
 * S-186 «Налаштування» (GRID-05@PoC, board PocSettings): opened from the profile menu, not a navigation section
 * (FR 2). Header, then navigation in 3 columns and the form in 9 (FR 1, AC1). The form lists the PoC settings:
 * the profile (name and email read from the account; the password and the name change on «Профіль», S-187), the
 * space (S-200) and the statement import. No «Мова і формати» and no language choice (ACC-05@PoC AC2).
 */
export function SettingsPage() {
  const t = useT();
  const title = t("shell.settings");
  useDocumentTitle(title);
  // ACC-08@PoC FR 2: the space's name, shared with the profile in the shell (one request); empty until known.
  const spaceName = useSpaceName() ?? undefined;
  return (
    <AppLayout sectionId={null} pageId={null}>
      <h1>{title}</h1>
      <div className="settings-layout">
        <SettingsNav current={SETTINGS_PATH} />
        <div className="settings-form">
          <ProfileSection />
          <Section id="settings-space" title={t("settings.space")}>
            <Row label={t("settings.row.spaceName")} value={spaceName}>
              <ActionLink
                href={SPACE_SETTINGS_PATH}
                action={t("settings.action.rename")}
                item={t("settings.row.spaceName")}
              />
            </Row>
          </Section>
          <Section id="settings-data" title={t("settings.data")}>
            <Row label={t("settings.row.import")} value={t("settings.row.importFormats")}>
              <ActionLink
                href={IMPORT_WIZARD_PATH}
                action={t("settings.action.import")}
                item={t("settings.row.import")}
              />
            </Row>
          </Section>
          {/* BUD-01@PoC c): «Модулі → Категорії» opens S-196 (board PocSettings). */}
          <Section id="settings-modules" title={t("settings.modules")}>
            <Row label={t("settings.row.categories")}>
              <ActionLink
                href={CATEGORIES_SETTINGS_PATH}
                action={t("settings.action.configure")}
                item={t("settings.row.categories")}
              />
            </Row>
          </Section>
        </div>
      </div>
    </AppLayout>
  );
}

/** The 3-column navigation of the settings (GRID-05@PoC FR 1): the current page is marked `aria-current`. */
export function SettingsNav({ current }: { current: string }) {
  const t = useT();
  const items = [
    { path: SETTINGS_PATH, label: t("settings.nav.general") },
    { path: PROFILE_PATH, label: t("settings.profile") },
    { path: SPACE_SETTINGS_PATH, label: t("settings.space") },
  ];
  return (
    <nav className="settings-nav" aria-label={t("settings.nav")}>
      <ul>
        {items.map((i) => (
          <li key={i.path}>
            <a href={hrefFor(i.path)} aria-current={i.path === current ? "page" : undefined}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ProfileSection() {
  const t = useT();
  const { load, reload } = useProfile();
  return (
    <Section id="settings-profile" title={t("settings.profile")}>
      {load.state === "loading" ? (
        <Skeleton variant="row" lines={3} />
      ) : load.state === "error" ? (
        <ProfileLoadError failure={load.failure} onRetry={reload} />
      ) : (
        <>
          <Row label={t("settings.row.name")} value={load.profile.name}>
            <ActionLink
              href={PROFILE_PATH}
              action={t("settings.action.change")}
              item={t("settings.row.name")}
            />
          </Row>
          {/* ACC-05@PoC FR 4, AC6: the email is shown read-only, with no «Змінити». */}
          <Row label={t("settings.row.email")} value={load.profile.email} />
          <Row label={t("settings.row.password")} value={"•".repeat(12)}>
            <ActionLink
              href={PROFILE_PATH}
              action={t("settings.action.change")}
              item={t("settings.row.password")}
            />
          </Row>
        </>
      )}
    </Section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="ws-card settings-section" aria-labelledby={id}>
      <h2 id={id} className="settings-section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-label">{label}</span>
      <span className="settings-row-value">{value}</span>
      {children}
    </div>
  );
}

/** «Змінити» and the like: the visible word starts the accessible name, the row names what it changes. */
function ActionLink({ href, action, item }: { href: string; action: string; item: string }) {
  const t = useT();
  return (
    <a className="ws-button" href={hrefFor(href)} aria-label={t("settings.action.for", { action, item })}>
      {action}
    </a>
  );
}
