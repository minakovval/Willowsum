import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ApiClient, paths } from "@willowsum/api-contract";
import { isUnavailable, outcome, useAuthApi } from "../auth/api.ts";

/** The caller's space of `GET /v1/space` (ACC-08@PoC FR 2, FR 5; ACC-06@PoC FR 1; module `household`). */
export type Space = paths["/v1/space"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * The space as one store per API client, so the profile at the bottom of the sidebar (FR 2) and «Налаштування →
 * Простір» (FR 5) show the same name and a rename shows in both at once. The space is asked for once per client;
 * a failed answer leaves the profile with its placeholder.
 */
interface Store {
  space: Space | null;
  asked: boolean;
  readonly listeners: Set<() => void>;
}
const stores = new WeakMap<ApiClient, Store>();

function storeOf(api: ApiClient): Store {
  let store = stores.get(api);
  if (!store) {
    store = { space: null, asked: false, listeners: new Set() };
    stores.set(api, store);
  }
  return store;
}

/** A space the server answered with (a load or a rename) becomes the one every view shows. */
export function publishSpace(api: ApiClient, space: Space): void {
  const store = storeOf(api);
  store.space = space;
  store.asked = true;
  for (const listener of store.listeners) listener();
}

/**
 * A new session (sign-in) forgets the space of the one before, so the profile never shows another account's space
 * name; the next view asks again.
 */
export function forgetSpace(api: ApiClient): void {
  const store = storeOf(api);
  store.space = null;
  store.asked = false;
  for (const listener of store.listeners) listener();
}

/** ACC-08@PoC FR 2: the name of the caller's space for the profile, or null until it is known. */
export function useSpaceName(): string | null {
  const api = useAuthApi();
  const store = storeOf(api);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );
  const name = useSyncExternalStore(subscribe, () => store.space?.name ?? null);
  useEffect(() => askOnce(api), [api]);
  return name;
}

/** Marks the space as asked for; true when nobody asked before. */
function claim(api: ApiClient): boolean {
  const store = storeOf(api);
  if (store.asked) return false;
  store.asked = true;
  return true;
}

function askOnce(api: ApiClient): void {
  if (!claim(api)) return;
  void outcome(api.GET("/v1/space")).then((o) => {
    if (o.ok) publishSpace(api, o.data);
    // No session yet (401) or another failure: ask again on the next view instead of keeping the placeholder.
    else storeOf(api).asked = false;
  });
}

/**
 * The space for S-200. `off` — the function is switched off for the space (flag `household.space-settings`: 404 as
 * an unknown path) or its module is (503). `error` carries the problem's support code for «Код: …».
 */
export type SpaceState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly space: Space }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string };

export function useSpace(): { state: SpaceState; retry: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SpaceState>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    // The page asks itself; the profile does not ask again.
    claim(api);
    void outcome(api.GET("/v1/space")).then((o) => {
      if (!live) return;
      if (o.ok) {
        publishSpace(api, o.data);
        setState({ kind: "ready", space: o.data });
      } else if (isUnavailable(o)) setState({ kind: "off" });
      else
        setState(
          o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" },
        );
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
