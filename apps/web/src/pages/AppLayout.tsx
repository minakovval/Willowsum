import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { AppShell, HideAmountsToggle, type NavItem } from "@willowsum/ui";
import { SECTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";

/** The user app shell with the L1 sections and the L0 «Приховати суми» action. */
export function AppLayout({ currentId, children }: { currentId: string | null; children: ReactNode }) {
  const t = useT();
  const items: NavItem[] = SECTIONS.map((s) => ({
    id: s.id,
    label: t(s.label),
    icon: s.icon,
    href: hrefFor(s.path),
  }));
  return (
    <AppShell items={items} currentId={currentId} actions={<HideAmountsToggle />}>
      {children}
    </AppShell>
  );
}
