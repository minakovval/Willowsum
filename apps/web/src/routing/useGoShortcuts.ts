import { useEffect } from "react";
import { ACCOUNTS, BUDGET, GOALS, TRANSACTIONS } from "./routes.ts";
import { hrefFor } from "./useHashPath.ts";

/** CMP-69@PoC: G, then T / B / G / A. Physical keys, so they work in the Ukrainian layout too. */
const TARGETS: Readonly<Record<string, string>> = {
  KeyT: TRANSACTIONS.path,
  KeyB: BUDGET.path,
  KeyG: GOALS.path,
  KeyA: ACCOUNTS.path,
};
const WINDOW_MS = 1500;

const isEditable = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement &&
  (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

/** The shortcuts do not act while the focus is in an input field. */
export function useGoShortcuts(): void {
  useEffect(() => {
    let pendingSince: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isEditable(e.target)) {
        pendingSince = null;
        return;
      }
      const now = Date.now();
      if (pendingSince !== null && now - pendingSince <= WINDOW_MS) {
        pendingSince = null;
        const target = TARGETS[e.code];
        if (target) {
          e.preventDefault();
          window.location.hash = hrefFor(target);
        }
        return;
      }
      pendingSince = e.code === "KeyG" ? now : null;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
