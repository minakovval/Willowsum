import type { SectionId } from "./routes.ts";

/**
 * Navigation state for this session (UX-09@PoC items 6 and 10):
 * - the last L2 page opened in each section, kept in sessionStorage so it lasts for the tab;
 * - whether this page view has an earlier in-app page, so «×» in focus mode can go back by history.
 */
const LAST_PAGE_KEY = "ws-nav-last-page";

function readLast(): Partial<Record<SectionId, string>> {
  try {
    const raw = window.sessionStorage.getItem(LAST_PAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<SectionId, string>>) : {};
  } catch {
    return {};
  }
}

let memory: Partial<Record<SectionId, string>> | null = null;
let visited: string[] = [];

export function lastPageOf(section: SectionId): string | undefined {
  memory ??= readLast();
  return memory[section];
}

export function rememberPage(section: SectionId, path: string): void {
  memory = { ...(memory ?? readLast()), [section]: path };
  try {
    window.sessionStorage.setItem(LAST_PAGE_KEY, JSON.stringify(memory));
  } catch {
    // Without storage the memory lasts for this page view only.
  }
}

/** Records the shown path (after `/` and section paths are resolved). */
export function recordVisit(path: string): void {
  if (visited[visited.length - 1] !== path) visited = [...visited, path];
}

/** True when the current page was reached from another page of this app in this page view. */
export const hasEarlierPage = (): boolean => visited.length > 1;

/** Tests only. */
export function resetNavigationSession(): void {
  memory = null;
  visited = [];
}
