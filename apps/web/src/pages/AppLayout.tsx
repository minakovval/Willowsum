import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { AppShell, type MenuItem, type NavSection } from "@willowsum/ui";
import {
  BUDGET,
  childPath,
  rootOf,
  SECTIONS,
  SETTINGS_PATH,
  START_PATH,
  type SectionId,
} from "../routing/routes.ts";
import { lastPageOf } from "../routing/session.ts";
import { useGoShortcuts } from "../routing/useGoShortcuts.ts";
import { hrefFor, useHashPath } from "../routing/useHashPath.ts";

/**
 * The PoC user shell (UX-09@PoC, CMP-69@PoC): L1 «Гроші» and «Планування» with the L2 pages of the
 * current one, «+ Додати» (Транзакція, Рахунок, Ціль), the profile menu with «Налаштування» and
 * the G-shortcuts. No «Приховати суми», search or notifications.
 */
export function AppLayout({
  sectionId,
  pageId,
  children,
}: {
  sectionId: SectionId | null;
  pageId: string | null;
  children: ReactNode;
}) {
  const t = useT();
  const path = useHashPath();
  useGoShortcuts();

  const sections: NavSection[] = SECTIONS.map((s) => {
    const root = rootOf(s).path;
    const current = s.id === sectionId;
    // UX-09 item 6: the first press opens the last L2 page of this session; the active section
    // returns to its root and scrolls up.
    const target = current ? root : (lastPageOf(s.id) ?? root);
    return {
      id: s.id,
      label: t(s.label),
      icon: s.icon,
      href: hrefFor(target),
      onClick: current && path === root ? () => window.scrollTo(0, 0) : undefined,
      pages: s.pages.map((p) => ({ id: p.id, label: t(p.label), icon: p.icon, href: hrefFor(p.path) })),
    };
  });

  const addItems: MenuItem[] = [
    {
      id: "transaction",
      label: t("shell.add.transaction"),
      icon: "transactions",
      href: hrefFor(childPath("newTransaction")),
      shortcut: { code: "KeyT", label: "T" },
    },
    {
      id: "account",
      label: t("shell.add.account"),
      icon: "accounts",
      href: hrefFor(childPath("newAccount")),
    },
    { id: "goal", label: t("shell.add.goal"), icon: "goals", href: hrefFor(childPath("newGoal")) },
  ];

  return (
    <AppShell
      sections={sections}
      currentSectionId={sectionId}
      currentPageId={pageId}
      brand={{
        href: hrefFor(START_PATH),
        label: t("shell.brandLink", { brand: t("brand.name"), page: t(BUDGET.label) }),
      }}
      add={{ label: t("shell.add"), items: addItems }}
      profile={{
        name: t("shell.profile.name"),
        space: t("shell.profile.space"),
        menuLabel: t("shell.profile.menu"),
        items: [
          { id: "settings", label: t("shell.settings"), icon: "settings", href: hrefFor(SETTINGS_PATH) },
        ],
      }}
    >
      {children}
    </AppShell>
  );
}
