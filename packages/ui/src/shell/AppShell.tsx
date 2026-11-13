import { useState, type MouseEvent, type ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { WillowsumMark } from "../brand/Mark.tsx";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { IconButton } from "../icons/IconButton.tsx";
import { readStorage, writeStorage } from "../storage.ts";
import { MenuButton, type MenuItem } from "./MenuButton.tsx";

/** An L2 page of a section (UX-09@PoC item 2). */
export interface NavPage {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** A count (e.g. the «До розбору» queue); hidden at 0. `label` is read as part of the item name. */
  badge?: { count: number; label: string };
}

/** An L1 section (UX-09@PoC item 1). */
export interface NavSection {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  pages: readonly NavPage[];
  onClick?: ((e: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}

export const MAIN_ID = "ws-main";
export const NAV_ID = "ws-nav";
/** CMP-69@PoC: the collapsed / expanded choice. On this device until the profile API exists. */
export const NAV_COLLAPSED_STORAGE_KEY = "ws-nav-collapsed";

/** Moves focus without changing the URL (the app routes on the hash). */
const focusTarget = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  const focusable = id === NAV_ID ? el.querySelector<HTMLElement>("a, button") : el;
  focusable?.focus();
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * The PoC application shell (CMP-69@PoC, UX-09@PoC items 4, 13–17, GRID-00@PoC items 10–11):
 * skip links, a 212 px sidebar (from 1280 px) that the user can collapse to a 64 px icon rail,
 * the brand link, «+ Додати», the L1 sections with the L2 pages of the current one, the profile
 * at the bottom, and the main area. No top row, bottom bar or width-driven rail.
 */
export function AppShell({
  sections,
  currentSectionId,
  currentPageId,
  brand,
  add,
  profile,
  children,
}: {
  sections: readonly NavSection[];
  currentSectionId: string | null;
  currentPageId: string | null;
  /** CMP-71@PoC: the mark links here; `label` is the accessible name («Willowsum, Бюджет»). */
  brand: { href: string; label: string };
  add: { label: string; items: readonly MenuItem[] };
  profile: { name: string; space: string; menuLabel: string; items: readonly MenuItem[] };
  children: ReactNode;
}) {
  const t = useT();
  const [collapsed, setCollapsedState] = useState(() => readStorage(NAV_COLLAPSED_STORAGE_KEY) === "1");
  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    writeStorage(NAV_COLLAPSED_STORAGE_KEY, value ? "1" : null);
  };
  const tip = (label: string) => (collapsed ? label : undefined);

  return (
    <div className="ws-shell" data-nav="sidebar" data-collapsed={collapsed}>
      <a className="ws-skip" href={`#${MAIN_ID}`} onClick={focusTarget(MAIN_ID)}>
        {t("shell.skipToContent")}
      </a>
      <a className="ws-skip" href={`#${NAV_ID}`} onClick={focusTarget(NAV_ID)}>
        {t("shell.skipToNav")}
      </a>

      <nav id={NAV_ID} className="ws-nav ws-nav-sidebar" aria-label={t("shell.mainNav")}>
        <div className="ws-nav-top">
          <div className="ws-nav-brand">
            <a className="ws-nav-brand-link" href={brand.href} aria-label={brand.label}>
              {collapsed ? (
                <WillowsumMark size={24} decorative />
              ) : (
                <span className="ws-wordmark">
                  <WillowsumMark size={24} decorative />
                  <span className="ws-wordmark-name">{t("brand.name")}</span>
                </span>
              )}
            </a>
            {collapsed ? null : (
              <IconButton
                icon="collapse"
                label={t("shell.nav.collapse")}
                onClick={() => setCollapsed(true)}
              />
            )}
          </div>
          <MenuButton
            menuLabel={add.label}
            items={add.items}
            placement="down"
            className={
              collapsed
                ? "ws-icon-button ws-button-primary ws-nav-add"
                : "ws-button ws-button-primary ws-nav-add"
            }
            ariaLabel={collapsed ? add.label : undefined}
            title={tip(add.label)}
          >
            <Icon name="plus" size={20} inButton />
            {collapsed ? null : <span>{add.label}</span>}
          </MenuButton>
        </div>

        <ul className="ws-nav-list">
          {sections.map((section) => {
            const current = section.id === currentSectionId;
            return (
              <li key={section.id} className="ws-nav-section">
                <a
                  className="ws-nav-item"
                  href={section.href}
                  aria-current={current ? "page" : undefined}
                  onClick={section.onClick}
                >
                  <Icon name={section.icon} size={20} />
                  <span className="ws-nav-label">{section.label}</span>
                </a>
                {current && section.pages.length > 0 ? (
                  <ul className="ws-nav-pages">
                    {section.pages.map((page) => {
                      const badge = page.badge && page.badge.count > 0 ? page.badge : null;
                      return (
                        <li key={page.id} className="ws-nav-page">
                          <a
                            className="ws-nav-item ws-nav-subitem"
                            href={page.href}
                            aria-current={page.id === currentPageId ? "page" : undefined}
                          >
                            <Icon name={page.icon} size={16} />
                            <span className="ws-nav-label">
                              {page.label}
                              {badge ? <span className="ws-visually-hidden">, {badge.label}</span> : null}
                            </span>
                            {badge ? (
                              <span className="ws-nav-badge" aria-hidden="true">
                                {badge.count}
                              </span>
                            ) : null}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="ws-nav-bottom-area">
          <MenuButton
            menuLabel={profile.menuLabel}
            items={profile.items}
            placement="up"
            className="ws-nav-profile"
            ariaLabel={collapsed ? profile.menuLabel : undefined}
            title={tip(profile.name)}
          >
            <span className="ws-avatar" aria-hidden="true">
              {initials(profile.name)}
            </span>
            {collapsed ? null : (
              <span className="ws-nav-profile-text">
                <span className="ws-nav-profile-name">{profile.name}</span>
                <span className="ws-visually-hidden">, </span>
                <span className="ws-nav-profile-space">{profile.space}</span>
                <span className="ws-visually-hidden">, {profile.menuLabel}</span>
              </span>
            )}
          </MenuButton>
        </div>

        {collapsed ? (
          <div className="ws-nav-edge">
            <button
              type="button"
              className="ws-nav-expand"
              aria-label={t("shell.nav.expand")}
              title={t("shell.nav.expand")}
              onClick={() => setCollapsed(false)}
            >
              ›
            </button>
          </div>
        ) : null}
      </nav>

      <div className="ws-shell-body">
        <main id={MAIN_ID} className="ws-main" tabIndex={-1}>
          <div className="ws-main-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Focus mode (UX-09@PoC item 10, GRID-00@PoC item 12): no navigation, a title and «×». */
export function FocusShell({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="ws-shell ws-focus" data-nav="none">
      <a className="ws-skip" href={`#${MAIN_ID}`} onClick={focusTarget(MAIN_ID)}>
        {t("shell.skipToContent")}
      </a>
      <main id={MAIN_ID} className="ws-main" tabIndex={-1}>
        <div className="ws-focus-inner">
          <div className="ws-focus-head">
            <h1>{title}</h1>
            <IconButton icon="close" label={closeLabel} onClick={onClose} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
