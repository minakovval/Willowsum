import { useEffect } from "react";
import { outcome, useAuthApi, type Outcome } from "./api.ts";
import { pathFromHash } from "../routing/useHashPath.ts";
import { navigate, SIGN_IN_PATH } from "./navigation.ts";

/**
 * The web session of ACC-04@PoC on the client. The server owns the timeout (15 min without a user action, 12 h in
 * all; FR 1): the client never counts down and never warns (no countdown, AC1). It only
 * - tells the server about user actions — a click, a key, a navigation — with `POST /v1/session/refresh`, at most
 *   once per `REFRESH_GAP_MS` (the last action of a burst is sent when the gap is over); background requests never
 *   do (business rules);
 * - checks with `GET /v1/session`, which does not extend the session, when the page is shown again (EC2: a laptop
 *   woke up), on a page load and every `CHECK_EVERY_MS` (a revoked session is noticed within 60 s) — the last two at
 *   most once a minute for the whole browser, and never without the `ws-signed-in` marker: the session routes are
 *   public and share the per-address budget of NFR-14 FR 5 (60 a minute) with sign-in, sign-up, reset and «Це був
 *   не я» (review round 1 of #365);
 * - treats UNAUTHENTICATED after a live session as the 12 h end: the browser drops the cookie at its Max-Age (AC5);
 * - opens the sign-in screen with the reason once an answer says SESSION_ENDED. The page is replaced, so an
 *   unsaved form is gone and no draft is kept (FR 2, AC2);
 * - shares the end with the other tabs of the browser through `localStorage` (FR 3, AC3): the server's timer is
 *   already common to them, and a tab that learns of the end tells the rest at once.
 */
export type SessionEnd = "idle" | "expired" | "signed-out" | "ended-elsewhere";
const ENDS: readonly SessionEnd[] = ["idle", "expired", "signed-out", "ended-elsewhere"];

export const REFRESH_GAP_MS = 15_000;
export const CHECK_EVERY_MS = 60_000;
/** The key another tab watches; the value changes on every end, so the `storage` event always fires. */
export const SESSION_END_KEY = "ws-session-end";
/**
 * Set when this browser signs in, removed when its session ends. Without it a page sends nothing for the session:
 * `GET /v1/session` counts in the per-address budget of public routes (60 a minute, NFR-14 FR 5), shared with
 * sign-up and sign-in, so a page load without a session must not spend it. Unreadable storage counts as set.
 */
export const SIGNED_IN_KEY = "ws-signed-in";

export function markSignedIn(): void {
  try {
    window.localStorage.setItem(SIGNED_IN_KEY, "1");
  } catch {
    // Without storage every page checks the session (mightBeSignedIn).
  }
}

function forgetSignedIn(): void {
  try {
    window.localStorage.removeItem(SIGNED_IN_KEY);
    window.localStorage.removeItem(SESSION_CHECKED_KEY);
  } catch {
    // Nothing to forget.
  }
}

function mightBeSignedIn(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * When a tab of this browser last read the session (epoch ms). A page load or the 60 s check within
 * `CHECK_EVERY_MS` of another one sends nothing: all tabs and page loads share the public per-address budget
 * (NFR-14 FR 5) with sign-in. A showing of the page (EC2) and user actions are not held back by it.
 */
export const SESSION_CHECKED_KEY = "ws-session-checked";

function checkedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SESSION_CHECKED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < CHECK_EVERY_MS;
  } catch {
    return false;
  }
}

function noteChecked(): void {
  try {
    window.localStorage.setItem(SESSION_CHECKED_KEY, String(Date.now()));
  } catch {
    // Without storage every page load and every minute checks.
  }
}

/** The query of the sign-in route that carries the reason (`#/login?ended=idle`). */
export const ENDED_PARAM = "ended";

export const isSessionEnd = (value: unknown): value is SessionEnd =>
  typeof value === "string" && (ENDS as readonly string[]).includes(value);

/** The reason of a SESSION_ENDED answer, or null for any other answer. */
export function sessionEndOf(o: Outcome<unknown>): SessionEnd | null {
  if (o.ok || o.kind !== "problem" || o.problem.code !== "SESSION_ENDED") return null;
  const reason = (o.problem as { sessionEndReason?: unknown }).sessionEndReason;
  return isSessionEnd(reason) ? reason : "signed-out";
}

/** Opens the sign-in screen with the reason; `share` also tells the other tabs of this browser. */
export function endSession(reason: SessionEnd, { share = true }: { share?: boolean } = {}): void {
  forgetSignedIn();
  if (share)
    try {
      window.localStorage.setItem(SESSION_END_KEY, JSON.stringify({ reason, at: Date.now() }));
    } catch {
      // Without storage the other tabs learn of the end with their next request or check.
    }
  navigate(`${SIGN_IN_PATH}?${ENDED_PARAM}=${reason}`, { replace: true });
}

function sharedEnd(value: string | null): SessionEnd | null {
  if (!value) return null;
  try {
    const reason = (JSON.parse(value) as { reason?: unknown }).reason;
    return isSessionEnd(reason) ? reason : null;
  } catch {
    return null;
  }
}

/** Mounted on the app's own pages (not on sign-in, sign-up or the gallery). */
export function useSessionKeeper(): void {
  const api = useAuthApi();
  useEffect(() => {
    let live = true;
    // Actions are sent only for a session that exists: browsing without one sends nothing.
    let signedIn = false;
    let lastSent = 0;
    let trailing: number | undefined;
    let shownPath = pathFromHash(window.location.hash);

    const stop = (reason: SessionEnd, share: boolean) => {
      if (!live) return;
      live = false;
      endSession(reason, { share });
    };
    const settle = (o: Outcome<unknown>) => {
      if (!live) return;
      const reason = sessionEndOf(o);
      if (reason) stop(reason, true);
      else if (o.ok) signedIn = true;
      // A session this tab had is gone without a reason: the cookie lapsed at the 12 h end (its Max-Age is the time
      // left) or was cleared. The plain sign-in screen opens (AC5); never seen signed in → nothing happens.
      else if (o.kind === "problem" && o.problem.code === "UNAUTHENTICATED") {
        if (signedIn) stop("expired", true);
        else forgetSignedIn();
      }
    };
    // `throttled`: the page load and the 60 s check skip a read another tab or load made within the minute.
    const check = (throttled: boolean) => {
      if (!signedIn && !mightBeSignedIn()) return;
      if (throttled && checkedRecently()) {
        // The marker stands and the session was alive a moment ago: actions may be sent.
        signedIn = true;
        return;
      }
      noteChecked();
      void outcome(api.GET("/v1/session")).then(settle);
    };
    const refresh = () => {
      lastSent = Date.now();
      noteChecked();
      void outcome(api.POST("/v1/session/refresh")).then(settle);
    };
    const onAction = () => {
      if (!live || !signedIn) return;
      const wait = lastSent + REFRESH_GAP_MS - Date.now();
      if (wait <= 0) refresh();
      else
        trailing ??= window.setTimeout(() => {
          trailing = undefined;
          if (live && signedIn) refresh();
        }, wait);
    };
    // A navigation is a move to another page; the same address again (a re-sent fragment) is not an action.
    const onNavigate = () => {
      const path = pathFromHash(window.location.hash);
      if (path === shownPath) return;
      shownPath = path;
      onAction();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check(false);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_END_KEY) return;
      const reason = sharedEnd(e.newValue);
      if (reason) stop(reason, false);
    };

    check(true);
    const every = window.setInterval(() => check(true), CHECK_EVERY_MS);
    window.addEventListener("pointerdown", onAction, true);
    window.addEventListener("keydown", onAction, true);
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.clearInterval(every);
      window.clearTimeout(trailing);
      window.removeEventListener("pointerdown", onAction, true);
      window.removeEventListener("keydown", onAction, true);
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [api]);
}

/** Renders nothing; keeps the session of the app's pages (see `useSessionKeeper`). */
export function SessionKeeper() {
  useSessionKeeper();
  return null;
}
