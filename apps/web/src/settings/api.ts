import { useCallback, useEffect, useRef, useState } from "react";
import type { operations } from "@willowsum/api-contract";
import { outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/**
 * ACC-05@PoC: what «Налаштування» (S-186) and «Профіль» (S-187) read. The profile is read at every load and again
 * whenever the tab gets the focus back (FR 2, AC1): a change made in another tab or on another device shows up then.
 * Nothing of it is cached or stored in the browser.
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;
export type Profile = Json<operations["getProfile"]>;

export type Failed = Exclude<Outcome<unknown>, { ok: true }>;
export type ProfileLoad =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly failure: Failed }
  | { readonly state: "ready"; readonly profile: Profile };

/** The session is over or missing (401): the screen offers «Увійти» instead of «Спробувати ще раз». */
export const isSignedOut = (o: Failed): boolean => o.kind === "problem" && o.problem.status === 401;

/**
 * Loads the profile, then reloads it when the window gets the focus or the tab becomes visible again (FR 2). A
 * failed reload keeps the profile already shown. `reload` retries after an error.
 */
export function useProfile(): { load: ProfileLoad; reload: () => void; replace: (p: Profile) => void } {
  const api = useAuthApi();
  const [load, setLoad] = useState<ProfileLoad>({ state: "loading" });
  const [round, setRound] = useState(0);
  const shown = useRef(false);

  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/profile")).then((o) => {
      if (!live) return;
      if (o.ok) {
        shown.current = true;
        setLoad({ state: "ready", profile: o.data });
      } else if (!shown.current || isSignedOut(o)) {
        setLoad({ state: "error", failure: o });
      }
    });
    return () => {
      live = false;
    };
  }, [api, round]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "hidden") setRound((n) => n + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

  const reload = useCallback(() => {
    if (!shown.current) setLoad({ state: "loading" });
    setRound((n) => n + 1);
  }, []);

  const replace = useCallback((p: Profile) => {
    shown.current = true;
    setLoad({ state: "ready", profile: p });
  }, []);

  return { load, reload, replace };
}

/** «ОК» for «Олена Коваленко»: the first letters of the first two words (FR 1: initials, no photo). */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toLocaleUpperCase() ?? "")
    .join("");
