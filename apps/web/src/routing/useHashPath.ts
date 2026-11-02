import { useSyncExternalStore } from "react";

/**
 * The current route from the URL hash (`#/gallery/tokens` → `/gallery/tokens`). Hash routing keeps
 * the static build working from any folder with `base: "./"`. Hashes that are not routes (e.g. a
 * skip-link target) leave the route unchanged.
 */
export function pathFromHash(hash: string): string {
  if (!hash.startsWith("#/")) return "/";
  const path = hash.slice(1).split("?")[0] ?? "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function useHashPath(): string {
  return useSyncExternalStore(
    subscribe,
    () => pathFromHash(window.location.hash),
    () => "/",
  );
}

export const hrefFor = (path: string): string => `#${path}`;
