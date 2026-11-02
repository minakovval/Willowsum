import type { MessageKey } from "@willowsum/i18n";
import type { IconName } from "@willowsum/ui";

export interface Section {
  id: string;
  path: string;
  label: MessageKey;
  icon: IconName;
}

/**
 * L1 sections of the navigation (UX-09 item 1, CMP-69). Placeholders for now: each opens the
 * shell with the section heading and an empty state. Visibility rules (complexity level, plan,
 * role) arrive with their requirements.
 */
export const SECTIONS: readonly Section[] = [
  { id: "home", path: "/", label: "shell.nav.home", icon: "home" },
  { id: "money", path: "/money", label: "shell.nav.money", icon: "transactions" },
  { id: "assets", path: "/assets", label: "shell.nav.assets", icon: "assets" },
  { id: "planning", path: "/planning", label: "shell.nav.planning", icon: "budget" },
  { id: "more", path: "/more", label: "shell.nav.more", icon: "more" },
];

/** DS-22: the design-system sample page, outside the app navigation. */
export const GALLERY_TOKENS_PATH = "/gallery/tokens";

export const sectionForPath = (path: string): Section | undefined => SECTIONS.find((s) => s.path === path);
