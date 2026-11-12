import { hrefFor } from "../routing/useHashPath.ts";

/** The screens of ACC-01@PoC (screen map: S-001 `/signup`, S-002 `/signup/check-email`, S-003 `/verify`, S-004 `/login`). */
export const SIGN_UP_PATH = "/signup";
export const CHECK_EMAIL_PATH = "/signup/check-email";
export const VERIFY_PATH = "/verify";
export const SIGN_IN_PATH = "/login";

export function navigate(path: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.location.replace(hrefFor(path));
  else window.location.hash = hrefFor(path);
}

/** A query parameter of the hash route (`#/verify?token=…`): the fragment never reaches a server or a Referer. */
export function hashParam(name: string, hash: string = window.location.hash): string | null {
  const q = hash.indexOf("?");
  return q < 0 ? null : new URLSearchParams(hash.slice(q + 1)).get(name);
}

/** Drops the query of the hash route from the address bar and the history entry (the token is single use). */
export function forgetHashQuery(path: string): void {
  window.history.replaceState(window.history.state, "", hrefFor(path));
}
