import { useEffect, useState } from "react";
import { hrefFor, pathFromHash } from "../routing/useHashPath.ts";

/** The screens of ACC-01@PoC (screen map: S-001 `/signup`, S-002 `/signup/check-email`, S-003 `/verify`, S-004 `/login`). */
export const SIGN_UP_PATH = "/signup";
export const CHECK_EMAIL_PATH = "/signup/check-email";
export const VERIFY_PATH = "/verify";
export const SIGN_IN_PATH = "/login";
/** S-007 «Відновлення пароля»: the letters link here, with `?token=` for the new password (identity `mail.ts`). */
export const PASSWORD_RESET_PATH = "/password/reset";
/** S-004b «Це був не я» (ACC-04@PoC FR 5): the new-device letter links here with `?token=`. */
export const NOT_ME_PATH = "/not-me";

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

/**
 * The token of a letter's link (`#/<path>?token=…`) for a page that shows it: read once, then dropped from the
 * address bar; a second link opened while the page is shown changes only the fragment, so it is read here too and
 * `n` grows (key the page's content by it). `null` when the link has no token.
 */
export function useLinkToken(path: string): { readonly token: string | null; readonly n: number } {
  const [link, setLink] = useState(() => ({ token: hashParam("token"), n: 0 }));
  useEffect(() => {
    if (hashParam("token") !== null) forgetHashQuery(path);
    const onHashChange = () => {
      if (pathFromHash(window.location.hash) !== path) return;
      const token = hashParam("token");
      if (token === null) return;
      forgetHashQuery(path);
      setLink((l) => ({ token, n: l.n + 1 }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [path]);
  return link;
}

/** The shape of every link token of identity (43 characters of base64url). */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
