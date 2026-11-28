import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, operations } from "@willowsum/api-contract";
import { outcome, useAuthApi, type Outcome } from "../../auth/api.ts";
import { failed, type Loaded } from "../../transactions/list.ts";
import { loadCategories } from "../../transactions/review.ts";
import { loadAccounts, type Condition, type Refs, type RuleBody } from "../api.ts";
import { loadDerivation, loadHistoryFile, startDerivation, type Derivation } from "../history/api.ts";

/**
 * BUD-21@PoC i) (wave 2, row 241): what S-301 «Пропозиції правил» and S-302 «Прийняти правила» read and send on the
 * merged server parts (module `categorization`, `derivations.ts`, rows 235–237). The page computes nothing about rules or
 * money: the server says which suggestions exist, which are selected, how many existing transactions each matches and
 * which of them conflict with a rule; the page keeps the user's choices until «Прийняти вибране» and sends them at once.
 */
type Json<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } }
  ? B
  : T extends { responses: { 201: { content: { "application/json": infer B } } } }
    ? B
    : never;

export type Derivations = Json<operations["listHistoryDerivations"]>;
export type DerivationRun = Derivation["derivation"];
export type Suggestion = Derivation["suggestions"][number];
export type Accepted = Json<operations["acceptHistorySuggestions"]>;
export type AcceptMatches = Json<operations["matchHistorySuggestions"]>;
export type AcceptBody = operations["acceptHistorySuggestions"]["requestBody"]["content"]["application/json"];
export type AcceptItem = AcceptBody["suggestions"][number];

/** The groups of the page (FR 21): «Переказ» by its action, the others by the suggestion's kind. */
export type GroupId = "confident" | "conflicting" | "transfer";
export const GROUPS: readonly GroupId[] = ["confident", "conflicting", "transfer"];
export const groupOf = (s: Suggestion): GroupId =>
  s.action === "transfer" ? "transfer" : s.kind === "conflicting" ? "conflicting" : "confident";

/**
 * FR 21: «Впевнені» come selected, «Суперечливі» do not; the server's `selected` (confident, no conflict with a rule,
 * the category there) decides it. «Переказ» comes not selected, as the board shows it: a rule «Переказ» is a choice.
 */
export const selectedByDefault = (s: Suggestion): boolean => s.action !== "transfer" && s.selected;

/** The newest derivation, or `null`: the page shows the file the user uploaded last. */
export function newest(list: Derivations): Derivations["items"][number] | null {
  const items = [...list.items].sort((a, b) => b.derivation.createdAt.localeCompare(a.derivation.createdAt));
  return items[0] ?? null;
}

export type Page =
  | { readonly kind: "loading" }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly supportId?: string | undefined }
  | { readonly kind: "none" }
  | {
      readonly kind: "ready";
      readonly run: DerivationRun;
      readonly fileName: string | null;
      readonly view: Derivation | null;
    };

const POLL_MS = 1000;

/** The newest derivation with its suggestions (read again every second while it runs), and the names the rows show. */
export function useSuggestions(): { page: Page; refs: Refs; reload: () => void; retry: () => void } {
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [refs, setRefs] = useState<Refs>({ categories: null, accounts: [] });
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    let timer: number | undefined;
    const read = async (id: string, fileName: string | null) => {
      const o = await loadDerivation(api, id);
      if (!live.current) return;
      if (!o.ok) return setPage(fail(o));
      const run = o.data.derivation;
      setPage({ kind: "ready", run, fileName, view: run.status === "completed" ? o.data : null });
      if (run.status === "running") timer = window.setTimeout(() => void read(id, fileName), POLL_MS);
    };
    void (async () => {
      const list = await outcome(api.GET("/v1/category-rule-derivations"));
      if (!live.current) return;
      if (!list.ok) return setPage(fail(list));
      const latest = newest(list.data);
      if (!latest) return setPage({ kind: "none" });
      const file = await loadHistoryFile(api, latest.derivation.batchId);
      if (!live.current) return;
      await read(latest.derivation.id, file.ok ? file.data.batch.fileName : null);
    })();
    return () => {
      live.current = false;
      window.clearTimeout(timer);
    };
  }, [api, attempt]);

  useEffect(() => {
    let current = true;
    void Promise.all([loadCategories(api), loadAccounts(api)]).then(([c, accounts]) => {
      if (current) setRefs({ categories: c.kind === "ready" ? c.data : null, accounts });
    });
    return () => {
      current = false;
    };
  }, [api, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const retry = useCallback(() => {
    setPage({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { page, refs, reload, retry };
}

function fail(o: Extract<Outcome<unknown>, { ok: false }>): Page {
  const l: Loaded<never> = failed(o);
  return l.kind === "off"
    ? { kind: "off" }
    : { kind: "error", supportId: l.kind === "error" ? l.supportId : undefined };
}

/** «Повторити» after a failed derivation: the same file is derived again (FR 10). */
export const restartDerivation = (api: ApiClient, batchId: string) => startDerivation(api, batchId);

/** FR 23: «Відхилити» — this conditions-and-category pair is not offered again. */
export const rejectSuggestion = (api: ApiClient, derivationId: string, ordinal: number) =>
  outcome(
    api.POST("/v1/category-rule-derivations/{derivationId}/suggestions/{ordinal}/reject", {
      params: { path: { derivationId, ordinal } },
      body: {},
    }),
  );

/** One suggestion as the accept requests send it: its ordinal, and its changed rule when the pencil saved one. */
export const itemOf = (ordinal: number, rule: RuleBody | undefined): AcceptItem =>
  rule ? { ordinal, rule: rule as NonNullable<AcceptItem["rule"]> } : { ordinal };

export const matchSelected = (api: ApiClient, derivationId: string, suggestions: AcceptItem[]) =>
  outcome(
    api.POST("/v1/category-rule-derivations/{derivationId}/matches", {
      params: { path: { derivationId } },
      body: { suggestions },
    }),
  );

export const acceptSelected = (
  api: ApiClient,
  derivationId: string,
  suggestions: AcceptItem[],
  apply: boolean,
) =>
  outcome(
    api.POST("/v1/category-rule-derivations/{derivationId}/accept", {
      params: { path: { derivationId } },
      body: { suggestions, ...(apply ? { apply: true } : {}) },
    }),
  );

/** The names of the space's tags in lower case: a tag outside it is created by the acceptance (FR 22). */
export async function loadTagNames(api: ApiClient): Promise<ReadonlySet<string> | null> {
  const o = await outcome(api.GET("/v1/transaction-tags"));
  return o.ok
    ? new Set(o.data.items.map((t) => t.name.normalize("NFC").trim().toLocaleLowerCase("uk")))
    : null;
}

/** The conditions of a suggestion as the rule table and the dialog read them. */
export const conditionsOf = (s: Pick<Suggestion, "conditions">): Condition[] => s.conditions as Condition[];

/** The count on «Правила категорій» (BUD-14 FR 16): the suggestions not accepted yet; `null` — not read, `"off"` — off. */
export function usePendingSuggestions(): number | null {
  const api = useAuthApi();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    void outcome(api.GET("/v1/category-rule-derivations")).then((o) => {
      if (current) setCount(o.ok ? o.data.pending : null);
    });
    return () => {
      current = false;
    };
  }, [api]);
  return count;
}
