import { useCallback, useEffect, useState } from "react";
import type { paths } from "@willowsum/api-contract";
import { isUnavailable, outcome, useAuthApi, type Outcome } from "../auth/api.ts";

/**
 * BUD-01@PoC c) — what S-196 «Категорії» reads: the space's tree of `GET /v1/categories` (module `categories`):
 * groups in order, each with its categories in use, hidden ones too, with colour, icon, «обов'язкова» and whether
 * the menu may offer «Видалити» (`deletable`, FR 12).
 */
export type Tree = paths["/v1/categories"]["get"]["responses"]["200"]["content"]["application/json"];
export type Group = Tree["groups"][number];
export type Category = Group["categories"][number];

/**
 * `off` — the function is switched off for the space (flag `categories.tree`: 404 as an unknown path) or its module
 * is (503). `error` carries the problem's support code for «Код: …».
 */
export type TreeState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly tree: Tree }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string };

/** The tree on mount and on `reload()`; an answer after unmount is dropped. A reload keeps the shown tree until it comes. */
export function useCategoryTree(): { state: TreeState; reload: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TreeState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void outcome(api.GET("/v1/categories")).then((o) => {
      if (!live) return;
      if (o.ok) setState({ kind: "ready", tree: o.data });
      else if (isUnavailable(o)) setState({ kind: "off" });
      else
        setState(
          o.kind === "problem" && o.supportId ? { kind: "error", supportId: o.supportId } : { kind: "error" },
        );
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

/** Only an error that the screen can name: the name is taken, the types differ, or anything else with its code. */
export type ActionFailure =
  | { readonly kind: "nameTaken" }
  | { readonly kind: "kindsDiffer" }
  | { readonly kind: "notEmpty" }
  | { readonly kind: "other"; readonly supportId?: string | undefined };

export function failureOf(o: Outcome<unknown>): ActionFailure {
  if (!o.ok && o.kind === "problem") {
    if (o.problem.code === "CATEGORY_NAME_TAKEN") return { kind: "nameTaken" };
    if (o.problem.code === "CATEGORY_KINDS_DIFFER") return { kind: "kindsDiffer" };
    if (o.problem.code === "CATEGORY_NOT_EMPTY") return { kind: "notEmpty" };
    return { kind: "other", supportId: o.supportId };
  }
  return { kind: "other" };
}
