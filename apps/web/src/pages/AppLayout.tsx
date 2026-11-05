import type { ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { AppShell, type NavItem } from "@willowsum/ui";
import { SECTIONS } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";

/**
 * The user app shell with the L1 sections. PoC has no «Приховати суми» action (UX-09@PoC; the mode
 * arrives in MVP), so no global action is passed to the shell.
 */
export function AppLayout({ currentId, children }: { currentId: string | null; children: ReactNode }) {
  const t = useT();
  const items: NavItem[] = SECTIONS.map((s) => ({
    id: s.id,
    label: t(s.label),
    icon: s.icon,
    href: hrefFor(s.path),
  }));
  return (
    <AppShell items={items} currentId={currentId}>
      {children}
    </AppShell>
  );
}
