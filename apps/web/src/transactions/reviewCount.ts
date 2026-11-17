import { useEffect, useSyncExternalStore } from "react";
import type { ApiClient } from "@willowsum/api-contract";
import { outcome, useAuthApi } from "../auth/api.ts";

/**
 * BUD-12@PoC FR 2, AC9: the number of «До розбору» — on «Транзакції» of the side menu (none when the queue is empty)
 * and on the tab «До розбору · N». One value for both, so an action in the queue changes them together (AC2: the tab
 * shows «До розбору · 11» right after «Підтвердити»). `null` — not read yet, or the read failed (the function is off):
 * the tab then shows its name only and the menu no number.
 */
let count: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setReviewCount(next: number | null): void {
  if (next === count) return;
  count = next;
  emit();
}

/** Reads the number again from the server (after an action in the queue). */
export async function refreshReviewCount(api: ApiClient): Promise<number | null> {
  const o = await outcome(api.GET("/v1/transaction-review"));
  setReviewCount(o.ok ? o.data.count : null);
  return o.ok ? o.data.count : null;
}

/** For tests: forget the number. */
export function resetReviewCount(): void {
  count = null;
}

/** The number, read once when the screen that shows it opens (`enabled`). */
export function useReviewCount(enabled = true): number | null {
  const api = useAuthApi();
  useEffect(() => {
    if (enabled) void refreshReviewCount(api);
  }, [api, enabled]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
  );
}
