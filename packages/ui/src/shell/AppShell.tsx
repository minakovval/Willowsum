import type { MouseEvent, ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { WillowsumMark, Wordmark } from "../brand/Mark.tsx";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { mediaQueries, type NavForm } from "../tokens/layout.ts";
import { useMediaQuery } from "../useMediaQuery.ts";

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
}

/** DS-10 acceptance 1 / CMP-69: bottom bar < 600 px, 64 px rail 600–1279 px, 212 px sidebar ≥ 1280 px. */
export function useNavForm(): NavForm {
  const medium = useMediaQuery(mediaQueries.medium);
  const sidebar = useMediaQuery(mediaQueries.sidebar);
  return sidebar ? "sidebar" : medium ? "rail" : "bottom";
}

export const MAIN_ID = "ws-main";
export const NAV_ID = "ws-nav";

/** Moves focus without changing the URL (the app routes on the hash). */
const focusTarget = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  const focusable = id === NAV_ID ? el.querySelector<HTMLElement>("a, button") : el;
  focusable?.focus();
};

/**
 * The application shell (CMP-69, UX-09 item 5, DS-10): skip links, primary navigation in the form
 * that fits the window width, a top row with global (L0) actions, and the main area. The page
 * never scrolls sideways: the content column is `min-width: 0` and capped at 1200 px.
 */
export function AppShell({
  items,
  currentId,
  actions,
  children,
}: {
  items: readonly NavItem[];
  currentId: string | null;
  /** Global actions (search, add, «Приховати суми», notifications, profile). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const form = useNavForm();

  return (
    <div className="ws-shell" data-nav={form}>
      <a className="ws-skip" href={`#${MAIN_ID}`} onClick={focusTarget(MAIN_ID)}>
        {t("shell.skipToContent")}
      </a>
      <a className="ws-skip" href={`#${NAV_ID}`} onClick={focusTarget(NAV_ID)}>
        {t("shell.skipToNav")}
      </a>

      <nav id={NAV_ID} className={`ws-nav ws-nav-${form}`} aria-label={t("shell.mainNav")}>
        {form === "sidebar" ? (
          <div className="ws-nav-brand">
            <Wordmark markSize={24} />
          </div>
        ) : form === "rail" ? (
          <div className="ws-nav-brand">
            <WillowsumMark size={24} />
          </div>
        ) : null}
        <ul className="ws-nav-list">
          {items.map((item) => {
            const current = item.id === currentId;
            return (
              <li key={item.id}>
                <a
                  className="ws-nav-item"
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  title={form === "rail" ? item.label : undefined}
                >
                  <Icon name={item.icon} size={form === "sidebar" ? 20 : 24} />
                  <span className="ws-nav-label">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ws-shell-body">
        <header className="ws-topbar">
          {form === "bottom" ? <WillowsumMark size={24} /> : null}
          <div className="ws-topbar-actions" role="group" aria-label={t("shell.globalActions")}>
            {actions}
          </div>
        </header>
        <main id={MAIN_ID} className="ws-main" tabIndex={-1}>
          <div className="ws-main-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
