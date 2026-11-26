import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  formatDate,
  formatLocaleOf,
  formatMoney,
  useI18n,
  useT,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import {
  Button,
  CategoryChip,
  CategorySelect,
  Dialog,
  Icon,
  IconButton,
  Progress,
  Skeleton,
  Toast,
  type CategoryChoice,
  type ToastTone,
} from "@willowsum/ui";
import { useAuthApi, type Outcome } from "../auth/api.ts";
import { TRANSACTIONS, transactionPath } from "../routing/routes.ts";
import { hrefFor } from "../routing/useHashPath.ts";
import type { Loaded, TransactionItem } from "./list.ts";
import { QuickCategory } from "./NewTransactionDialog.tsx";
import { refreshReviewCount, useReviewCount } from "./reviewCount.ts";
import {
  confirmCard,
  frequentFor,
  groupIds,
  loadCards,
  loadCategories,
  loadGroups,
  loadNoMerchantCards,
  merchantFromDescription,
  reloadCard,
  rememberRule,
  reopenCard,
  runBulk,
  setCategory,
  undoableReports,
  undoBulk,
  type BulkReport,
  type Categories,
  type ReviewCard,
  type ReviewGroup,
  type ReviewGroups,
} from "./review.ts";

/**
 * BUD-12@PoC b) (wave 2, row 121): S-058 «До розбору», the tab of «Гроші → Транзакції» (canvas PocMoneyReview,
 * PocMoneyReviewDone; texts PocMoneyReviewTexts). The progress in transactions (FR 15), the switch «Мерчанти / По
 * одній» (FR 14; «Мерчанти» by default when a merchant has more than one transaction), the merchant groups with
 * «Підтвердити» of a group and «Запам'ятати» (FR 14), the cards one by one with «Пропустити», «Змінити категорію»
 * and «Підтвердити» (FR 2–5), «Відмінити» of the last action in a toast (FR 6), the version conflict (FR 7), the
 * category picker (FR 16) and «Усе розібрано» (FR 13). There is no group «Без мерчанта» (owner correction 2026-11-26,
 * row 226): the server's group of transactions without a merchant is not shown as a group; its transactions follow the
 * merchant groups as cards one by one, each with the merchant its bank description names (FR 14). On a page of groups read from part of the queue (`truncated`,
 * #491 security review) a group's suggestion may come from part of the group: no «Підтвердити» of a group there.
 */
type Mode = "groups" | "cards";
const FORMS = ["one", "few", "many", "other"] as const;

function plural(t: Translate, locale: Locale, base: string, count: number): string {
  const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(count);
  const form = (FORMS as readonly string[]).includes(rule) ? rule : "other";
  return t(`${base}.${form}` as MessageKey, { count });
}

interface ToastState {
  readonly key: number;
  readonly text: string;
  readonly tone: ToastTone;
  readonly undo?: (() => void) | undefined;
}

interface Base {
  readonly groups: ReviewGroups | null;
  readonly categories: Categories;
}

export function ReviewQueue() {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const count = useReviewCount(false);
  const [attempt, setAttempt] = useState(0);
  const [base, setBase] = useState<Loaded<Base>>({ kind: "loading" });
  const [chosen, setChosen] = useState<Mode | null>(null);
  const [done, setDone] = useState(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const modeId = useId();

  useEffect(() => {
    let live = true;
    void Promise.all([loadGroups(api), loadCategories(api), refreshReviewCount(api)]).then(
      ([groups, categories]) => {
        if (!live) return;
        if (categories.kind !== "ready") return setBase(categories);
        // Grouping switched off (`merchants.review-groups`): the queue is the cards alone.
        if (groups.kind === "off")
          return setBase({ kind: "ready", data: { groups: null, categories: categories.data } });
        if (groups.kind !== "ready") return setBase(groups);
        setBase({ kind: "ready", data: { groups: groups.data, categories: categories.data } });
      },
      () => live && setBase({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const reloadGroups = useCallback(async () => {
    const [groups] = await Promise.all([loadGroups(api), refreshReviewCount(api)]);
    if (groups.kind === "ready")
      setBase((b) => (b.kind === "ready" ? { kind: "ready", data: { ...b.data, groups: groups.data } } : b));
  }, [api]);
  const reloadCategories = useCallback(async () => {
    const categories = await loadCategories(api);
    if (categories.kind === "ready")
      setBase((b) =>
        b.kind === "ready" ? { kind: "ready", data: { ...b.data, categories: categories.data } } : b,
      );
  }, [api]);

  const reloadCount = useCallback(() => void reloadGroups(), [reloadGroups]);
  const show = useCallback(
    (text: string, undo?: () => void, tone: ToastTone = "success") =>
      setToast((prev) => ({ key: (prev?.key ?? 0) + 1, text, tone, undo })),
    [],
  );

  if (base.kind === "loading")
    return (
      <div className="review" aria-busy="true">
        <div className="ws-card review-card">
          <Skeleton variant="row" lines={4} />
        </div>
      </div>
    );
  if (base.kind === "off" || base.kind === "error")
    return (
      <section className="ws-card tx-state" role="alert">
        <p className="tx-error-title">{t("tx.error.title")}</p>
        <p>{t("review.error.body")}</p>
        <Button
          label={t("tx.error.retry")}
          onClick={() => {
            setBase({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
        />
        {base.kind === "error" && base.supportId ? (
          <p className="ws-muted">{t("tx.error.code", { code: base.supportId })}</p>
        ) : null}
      </section>
    );

  const { groups, categories } = base.data;
  const left = count ?? groups?.transactionCount ?? 0;
  const total = done + left;
  // FR 14: the server's group of transactions without a merchant is no group here: they follow the groups as cards.
  const noMerchant = groups?.items.find((g) => g.merchant === null) ?? null;
  const merchantGroups: ReviewGroups | null = groups
    ? {
        ...groups,
        items: groups.items.filter((g) => g.merchant !== null),
        count: groups.count - (noMerchant ? 1 : 0),
      }
    : null;
  // FR 14: «Мерчанти» by default when a merchant has more than one transaction in the queue.
  const mode: Mode =
    merchantGroups === null
      ? "cards"
      : (chosen ?? (merchantGroups.items.some((g) => g.count > 1) ? "groups" : "cards"));
  const confirmed = (n: number) => setDone((d) => Math.max(0, d + n));

  const toastView = toast ? (
    <Toast
      key={toast.key}
      text={toast.text}
      tone={toast.tone}
      closeLabel={t("shell.close")}
      onDismiss={() => setToast(null)}
      action={
        toast.undo
          ? {
              label: t("review.undo"),
              onAction: () => {
                setToast(null);
                toast.undo?.();
              },
            }
          : undefined
      }
    />
  ) : null;

  if (left === 0)
    return (
      <div className="review">
        {done > 0 ? (
          <Progress label={t("review.progress.label")} value={done} max={done} state="done" />
        ) : null}
        <section className="ws-card review-done" aria-labelledby="review-done-title">
          <span className="review-done-icon" aria-hidden="true">
            <Icon name="check" size={32} />
          </span>
          <h2 id="review-done-title" className="ws-text-heading-3">
            {t("review.empty.title")}
          </h2>
          <p className="ws-muted">
            {done > 0 ? plural(t, locale, "review.empty.done", done) : t("review.empty.none")}
          </p>
          <Button label={t("review.empty.back")} href={hrefFor(TRANSACTIONS.path)} />
        </section>
        {toastView}
      </div>
    );

  return (
    <div className="review">
      <div className="review-head">
        <Progress label={t("review.progress.label")} value={done} max={total} />
        {groups !== null ? (
          <fieldset className="ws-segmented review-mode">
            <legend className="ws-visually-hidden">{t("review.mode.label")}</legend>
            <div className="ws-segmented-options">
              {(["groups", "cards"] as const).map((m) => (
                <label key={m} className="ws-segmented-option">
                  <input
                    type="radio"
                    name={modeId}
                    value={m}
                    checked={mode === m}
                    onChange={() => setChosen(m)}
                  />
                  {t(m === "groups" ? "review.mode.groups" : "review.mode.cards")}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {mode === "groups" ? (
          <Button variant="primary" label={t("review.start")} onClick={() => setChosen("cards")} />
        ) : null}
      </div>
      {mode === "groups" && merchantGroups ? (
        <GroupsView
          groups={merchantGroups}
          noMerchant={noMerchant}
          categories={categories}
          onCardConfirmed={confirmed}
          show={show}
          reloadCount={reloadCount}
          onConfirmed={async (n, reports) => {
            confirmed(n);
            // FR 6, AC12: «Відмінити» only while the API says `undo.available`, and not after its `undo.until`.
            const undoable = undoableReports(reports);
            show(
              t("review.toast.group", { transactions: plural(t, locale, "bulk.tx", n) }),
              undoable
                ? () => {
                    void (async () => {
                      if (Date.now() >= undoable.until)
                        return show(t("bulk.error.title"), undefined, "error");
                      const back = await undoBulk(api, undoable.ids);
                      if (back.restored > 0) confirmed(-back.restored);
                      await reloadGroups();
                      // The first undo passed and a later one failed: the group is back, its category is not.
                      if (back.failure && back.undone > 0)
                        show(
                          back.notRestored > 0
                            ? t("review.undo.partialCount", { notRestored: back.notRestored })
                            : t("review.undo.partial"),
                          undefined,
                          "error",
                        );
                      else if (back.failure) show(failureText(t, back.failure), undefined, "error");
                    })();
                  }
                : undefined,
            );
            await reloadGroups();
          }}
          reloadCategories={reloadCategories}
        />
      ) : (
        <CardsView
          categories={categories}
          onConfirmed={confirmed}
          show={show}
          reloadCategories={reloadCategories}
          reloadCount={reloadCount}
        />
      )}
      {toastView}
    </div>
  );
}

/** The circle tone and icon of a category for the picker (the chart palette of its group). */
function choicesOf(
  categories: Categories,
  kind: "expense" | "income" | null,
): { id: string; title: string; categories: CategoryChoice[] }[] {
  return categories.groups
    .filter((g) => g.kind !== "service" && (kind === null || g.kind === kind))
    .map((g) => ({
      id: g.id,
      title: g.name,
      categories: g.categories
        .filter((c) => !c.hidden)
        .map((c) => {
          const shown = categories.byId.get(c.id);
          const tone = shown?.tone;
          return {
            value: c.id,
            label: c.name,
            color: typeof tone === "number" ? `chart-cat-${tone}` : "chart-transfer",
            icon: shown?.icon ?? "budget",
          };
        }),
    }));
}

/**
 * FR 16: the pencil «Змінити категорію» — search, «Часто для <мерчанта>» first, every category by group, «Нова
 * категорія» last. The choice is the action: it is applied (to the whole group in «Мерчанти») and confirmed.
 */
function CategoryDialog({
  merchant,
  counterparty,
  kind,
  categories,
  onChoose,
  onClose,
  reloadCategories,
}: {
  merchant: string;
  counterparty: string | null;
  kind: "expense" | "income" | null;
  categories: Categories;
  onChoose: (categoryId: string) => void;
  onClose: () => void;
  reloadCategories: () => Promise<void>;
}) {
  const t = useT();
  const api = useAuthApi();
  const [frequent, setFrequent] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let live = true;
    void frequentFor(api, counterparty).then((ids) => live && setFrequent(ids));
    return () => {
      live = false;
    };
  }, [api, counterparty]);
  const groups = useMemo(() => choicesOf(categories, kind), [categories, kind]);
  const top = useMemo(() => {
    const all = new Map(groups.flatMap((g) => g.categories.map((c) => [c.value, c] as const)));
    return frequent.flatMap((id) => {
      const c = all.get(id);
      return c ? [c] : [];
    });
  }, [groups, frequent]);

  if (creating)
    return (
      <QuickCategory
        groups={categories.groups.filter((g) => g.kind !== "service" && (kind === null || g.kind === kind))}
        onCancel={() => setCreating(false)}
        onCreated={async (id) => {
          await reloadCategories();
          onChoose(id);
        }}
      />
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("review.edit")}
      align="start"
      closeLabel={t("shell.close")}
      actions={[{ label: t("newTx.cancel"), onClick: onClose }]}
    >
      {/* Room for the open list inside the dialog, so it is not cut by the dialog's scrolling body. */}
      <div className="review-picker">
        <CategorySelect
          label={t("review.dialog.label")}
          value=""
          onChange={onChoose}
          merchant={merchant}
          top={top}
          groups={groups}
          onCreate={() => setCreating(true)}
          placeholder={t("transactionRow.uncategorized")}
        />
      </div>
    </Dialog>
  );
}

/** «−74,60 €» or «−74,60 € · −1 200,00 ₴»: the group's signed sum in each of its currencies, never converted. */
function totalsText(locale: Locale, totals: ReviewGroup["totals"]): string {
  return totals.map((x) => formatMoney(locale, x.amount, x.currency, { signed: true })).join(" · ");
}

function failureText(t: Translate, o: Exclude<Outcome<unknown>, { ok: true }>): string {
  const code = o.kind === "problem" ? o.supportId : undefined;
  return code ? `${t("bulk.error.title")} · ${t("tx.error.code", { code })}` : t("bulk.error.title");
}

/** FR 14: the groups by merchant on the left, the chosen group on the right (canvas PocMoneyReview). */
function GroupsView({
  groups,
  noMerchant,
  categories,
  onConfirmed,
  onCardConfirmed,
  show,
  reloadCount,
  reloadCategories,
}: {
  /** The merchant groups only: the server's group without a merchant is `noMerchant`, shown as cards. */
  groups: ReviewGroups;
  noMerchant: ReviewGroup | null;
  categories: Categories;
  onConfirmed: (count: number, reports: BulkReport[]) => Promise<void>;
  onCardConfirmed: (n: number) => void;
  show: (text: string, undo?: () => void, tone?: ToastTone) => void;
  reloadCount: () => void;
  reloadCategories: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const group = groups.items.find((g) => g.id === selectedId) ?? groups.items[0];
  const name = (g: ReviewGroup) => g.merchant?.name ?? "";
  return (
    <>
      {group ? (
        <div className="review-groups">
          <section className="ws-card review-group-list" aria-labelledby="review-queue-title">
            <p className="review-group-list-head">
              <span id="review-queue-title" className="review-eyebrow">
                {t("review.queue.title")}
              </span>{" "}
              <span className="ws-muted">
                {t("review.queue.byMerchant", {
                  transactions: plural(t, locale, "review.count", groups.transactionCount),
                })}
              </span>
            </p>
            <ul className="review-group-rows" aria-label={t("review.groups.label")}>
              {groups.items.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="review-group-row"
                    aria-current={g.id === group?.id ? "true" : undefined}
                    onClick={() => setSelectedId(g.id)}
                  >
                    <span className="review-initials" aria-hidden="true">
                      {g.merchant?.initials ?? "··"}
                    </span>
                    <span className="review-group-name">
                      <span>{name(g)}</span>
                      <span className="ws-muted">{plural(t, locale, "review.count", g.count)}</span>
                    </span>
                    <span className="ws-tabular review-amount">{totalsText(locale, g.totals)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {groups.count > groups.items.length ? (
              <p className="ws-muted review-more">
                {t("review.groups.more", { count: groups.count, shown: groups.items.length })}
              </p>
            ) : null}
          </section>
          {group ? (
            <GroupDetail
              key={group.id}
              group={group}
              name={name(group)}
              truncated={groups.truncated}
              categories={categories}
              onConfirmed={onConfirmed}
              reloadCategories={reloadCategories}
            />
          ) : null}
        </div>
      ) : null}
      {noMerchant ? (
        <section className="review-nomerchant" aria-labelledby="review-nomerchant-title">
          <h2 id="review-nomerchant-title" className="review-eyebrow">
            {t("review.noMerchant.title")}
          </h2>
          <p className="ws-muted review-more">
            {t("review.noMerchant.hint", {
              transactions: plural(t, locale, "review.count", noMerchant.count),
            })}
          </p>
          <CardsView
            source={{ groupId: noMerchant.id, count: noMerchant.count }}
            categories={categories}
            onConfirmed={onCardConfirmed}
            show={show}
            reloadCategories={reloadCategories}
            reloadCount={reloadCount}
          />
        </section>
      ) : null}
    </>
  );
}

function GroupDetail({
  group,
  name,
  truncated,
  categories,
  onConfirmed,
  reloadCategories,
}: {
  group: ReviewGroup;
  name: string;
  truncated: boolean;
  categories: Categories;
  onConfirmed: (count: number, reports: BulkReport[]) => Promise<void>;
  reloadCategories: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const suggested = group.suggestedCategoryId;
  const category = suggested ? (categories.byId.get(suggested) ?? null) : null;

  /** FR 14 «Підтвердити» (`override` — the pencil's category, FR 16): every transaction of the group. */
  const confirm = async (override?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const target = override ?? suggested;
    const ids = await groupIds(api, group.id);
    const fail = (o: Exclude<Outcome<unknown>, { ok: true }>) => {
      setBusy(false);
      setError(failureText(t, o));
    };
    if (!ids.ok) return fail(ids);
    // The rule is for the category the label «Запам'ятати: <мерчант> → <категорія>» shows (the group's suggestion), never
    // for the pencil's pick the user was not shown next to the checkbox (#498 item 1).
    if (remember && group.merchant && suggested) {
      const rule = await rememberRule(api, group.merchant.name, suggested);
      if (!rule.ok) return fail(rule);
    }
    // A category chosen with the pencil, or a group with different categories: the category goes to all of them first
    // (lead decision 2026-11-17 in #491: the client sets the suggestion on the whole group before it confirms it).
    let setReports: BulkReport[] = [];
    if (target && (override !== undefined || group.mixedCategories)) {
      const set = await runBulk(api, "transactions.set-category", ids.data, { categoryId: target });
      if (!set.ok) return fail(set);
      setReports = set.data;
    }
    const confirmedAll = await runBulk(api, "transactions.confirm-category", ids.data, {});
    if (!confirmedAll.ok) return fail(confirmedAll);
    const changed = confirmedAll.data.reduce((n, r) => n + r.changed, 0);
    await onConfirmed(changed, [...setReports, ...confirmedAll.data]);
  };

  const transactions = plural(t, locale, "review.count", group.count);
  return (
    <section
      className="ws-card review-group"
      aria-labelledby="review-group-title"
      aria-busy={busy || undefined}
    >
      <div className="review-group-head">
        <span className="review-initials" aria-hidden="true">
          {group.merchant?.initials ?? "··"}
        </span>
        <h2 id="review-group-title" className="ws-text-heading-3">
          {t("review.group.title", { merchant: name, transactions })}
        </h2>
        <span className="ws-tabular review-amount review-group-total">
          {totalsText(locale, group.totals)}
        </span>
      </div>
      <div className="review-group-category">
        <span className="ws-muted">{t("review.group.category")}</span>
        <span className="review-category-line">
          <CategoryChip category={category} />
          {truncated ? null : (
            <IconButton icon="edit" label={t("review.edit")} onClick={() => setEditing(true)} />
          )}
        </span>
        {truncated ? (
          <p className="review-note">{t("review.group.truncated")}</p>
        ) : (
          <>
            {group.mixedCategories && category ? (
              <p className="review-note">{t("review.group.mixed", { category: category.name })}</p>
            ) : null}
            {group.merchant && category ? (
              <label className="review-remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t("review.group.remember", { merchant: group.merchant.name, category: category.name })}
              </label>
            ) : null}
          </>
        )}
      </div>
      {error ? (
        <p className="review-error" role="alert">
          {error}
        </p>
      ) : null}
      {truncated ? null : (
        <div className="review-actions">
          <Button
            variant="primary"
            icon="check"
            label={t("review.group.confirm", { count: group.count })}
            loading={busy}
            onClick={() => void confirm()}
          />
        </div>
      )}
      {editing ? (
        <CategoryDialog
          merchant={name}
          counterparty={group.counterparty}
          kind={null}
          categories={categories}
          reloadCategories={reloadCategories}
          onClose={() => setEditing(false)}
          onChoose={(id) => {
            setEditing(false);
            void confirm(id);
          }}
        />
      ) : null}
    </section>
  );
}

/** FR 2–7: the cards one by one, the oldest first. */
function CardsView({
  source,
  categories,
  onConfirmed,
  show,
  reloadCategories,
  reloadCount,
}: {
  /** FR 14: only the transactions without a merchant (the server's group of them); absent — the whole queue. */
  source?: { groupId: string; count: number };
  categories: Categories;
  onConfirmed: (n: number) => void;
  show: (text: string, undo?: () => void, tone?: ToastTone) => void;
  reloadCategories: () => Promise<void>;
  reloadCount: () => void;
}) {
  const { t, locale } = useI18n();
  const api = useAuthApi();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded<ReviewCard[]>>({ kind: "loading" });
  /** The queue had more than the cards read: when they are done, the next oldest ones are read. */
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /** FR 14: the merchant the bank's text names, by transaction (null — the API names none). */
  const [named, setNamed] = useState<ReadonlyMap<string, string | null>>(new Map());
  const groupId = source?.groupId;
  const groupCount = useRef(source?.count ?? 0);
  useEffect(() => {
    groupCount.current = source?.count ?? 0;
  }, [source?.count]);

  useEffect(() => {
    let live = true;
    void (groupId ? loadNoMerchantCards(api, groupId, groupCount.current) : loadCards(api)).then(
      (o) => {
        if (!live) return;
        setMore(o.kind === "ready" && o.data.count > o.data.cards.length);
        // Nothing left to read: the number of the queue is read again, so «Усе розібрано» follows.
        if (o.kind === "ready" && o.data.cards.length === 0) reloadCount();
        setState(o.kind === "ready" ? { kind: "ready", data: o.data.cards } : o);
      },
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, attempt, reloadCount, groupId]);

  const cards = state.kind === "ready" ? state.data : null;
  const top = cards?.[0] ?? null;
  const topId = top?.item.id;
  const topText = top && top.item.counterparty === null ? (top.item.description?.trim() ?? "") : "";
  useEffect(() => {
    if (!topId || topText === "") return;
    let live = true;
    void merchantFromDescription(api, topText).then((m) => {
      if (live) setNamed((prev) => (prev.has(topId) ? prev : new Map(prev).set(topId, m)));
    });
    return () => {
      live = false;
    };
  }, [api, topId, topText]);

  if (state.kind === "loading" || (cards && cards.length === 0))
    return (
      <div className="ws-card review-card" aria-busy="true">
        <Skeleton variant="row" lines={4} />
      </div>
    );
  if (!cards)
    return (
      <section className="ws-card tx-state" role="alert">
        <p className="tx-error-title">{t("tx.error.title")}</p>
        <p>{t("review.error.body")}</p>
        <Button
          label={t("tx.error.retry")}
          onClick={() => {
            setState({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
        />
        {state.kind === "error" && state.supportId ? (
          <p className="ws-muted">{t("tx.error.code", { code: state.supportId })}</p>
        ) : null}
      </section>
    );

  const card = cards[0]!;
  const rest = cards.slice(1);
  // The cards read so far are done while the queue had more: the next oldest ones are read.
  const put = (next: ReviewCard[]) => {
    if (next.length === 0 && more) {
      setState({ kind: "loading" });
      setAttempt((n) => n + 1);
    } else setState({ kind: "ready", data: next });
  };
  /** «Відмінити» brings the card back on top, as it was (FR 6). */
  const backOnTop = (back: ReviewCard) =>
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", data: [back, ...s.data.filter((c) => c.item.id !== back.item.id)] }
        : s,
    );

  const confirm = async (categoryId: string | null, previous?: string | null) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    if (previous !== undefined) {
      const set = await setCategory(api, card.item.id, categoryId);
      if (!set.ok) {
        setBusy(false);
        return setError(failureText(t, set));
      }
    }
    const o = await confirmCard(api, card.item, categoryId);
    setBusy(false);
    if (o.ok) {
      put(rest);
      onConfirmed(1);
      reloadCount();
      const after = o.data as TransactionItem;
      const was: ReviewCard = {
        item: card.item,
        categoryId: previous !== undefined ? previous : card.categoryId,
        account: card.account,
      };
      show(t(previous !== undefined ? "review.toast.changed" : "review.toast.confirmed"), () => {
        void (async () => {
          const back = await reopenCard(api, after);
          if (!back.ok) return show(failureText(t, back), undefined, "error");
          if (previous !== undefined) await setCategory(api, card.item.id, previous);
          backOnTop({ ...was, item: back.data as TransactionItem });
          onConfirmed(-1);
          reloadCount();
        })();
      });
      return;
    }
    if (o.kind === "problem" && o.problem.code === "VERSION_CONFLICT") {
      // FR 7, AC5: refused; the card shows what the transaction is now, and «Транзакцію змінено, перевірте ще раз».
      const fresh = await reloadCard(api, card);
      if (fresh) put([fresh, ...rest]);
      else setError(failureText(t, o));
      return;
    }
    if (o.kind === "problem" && o.problem.code === "TRANSACTION_NOT_IN_REVIEW") {
      put(rest);
      reloadCount();
      return;
    }
    setError(failureText(t, o));
  };

  /** FR 5: «Пропустити» changes nothing on the server; the card goes to the end of the queue. */
  const skip = () => {
    if (busy) return;
    setError(null);
    put([...rest, card]);
    show(t("review.toast.skipped"), () => backOnTop(card));
  };

  const category = card.categoryId ? (categories.byId.get(card.categoryId) ?? null) : null;
  // FR 14: a card without a merchant shows the merchant its bank description names as a hint (nothing is saved).
  const suggested = card.item.counterparty === null ? (named.get(card.item.id) ?? null) : null;
  const merchant = card.item.counterparty ?? t("review.group.noMerchant");
  // The statement's own text under the title: always without a merchant; with one, only when it says more.
  const text = card.item.description?.trim() ?? "";
  const statement =
    text !== "" &&
    (card.item.counterparty === null || text.toLowerCase() !== card.item.counterparty.trim().toLowerCase())
      ? text
      : null;
  return (
    <section
      className="ws-card review-card"
      aria-labelledby="review-card-title"
      aria-busy={busy || undefined}
    >
      <p className="ws-visually-hidden">{t("review.card.label")}</p>
      <h2 id="review-card-title" className="ws-text-heading-3">
        <a className="review-card-link" href={hrefFor(transactionPath(card.item.id))}>
          {merchant}
        </a>
      </h2>
      {statement ? <p className="review-card-text ws-muted">{statement}</p> : null}
      {suggested !== null ? (
        <p className="review-card-suggest">
          <span className="ws-muted">{t("review.card.suggested")}</span> <strong>{suggested}</strong>
        </p>
      ) : null}
      <dl className="review-card-facts">
        <div>
          <dt className="ws-muted">{t("review.card.amount")}</dt>
          <dd className="ws-tabular review-amount">
            {formatMoney(locale, card.item.amount.amount, card.item.amount.currency, { signed: true })}
          </dd>
        </div>
        <div>
          <dt className="ws-muted">{t("review.card.date")}</dt>
          <dd>{formatDate(locale, card.item.date)}</dd>
        </div>
        <div>
          <dt className="ws-muted">{t("review.card.account")}</dt>
          <dd>{card.account ?? "—"}</dd>
        </div>
        <div>
          <dt className="ws-muted">{t("review.card.category")}</dt>
          <dd>
            <CategoryChip category={category} />
          </dd>
        </div>
      </dl>
      {card.changed ? (
        <p className="review-note" role="alert">
          {t("review.conflict")}
        </p>
      ) : null}
      {error ? (
        <p className="review-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="review-actions">
        <Button label={t("review.skip")} onClick={skip} />
        <IconButton icon="edit" label={t("review.edit")} onClick={() => setEditing(true)} />
        <Button
          variant="primary"
          icon="check"
          label={t("review.confirm")}
          loading={busy}
          onClick={() => void confirm(card.categoryId)}
        />
      </div>
      {editing ? (
        <CategoryDialog
          merchant={card.item.counterparty === null ? (suggested ?? "") : merchant}
          counterparty={card.item.counterparty ?? (suggested !== null ? statement : null)}
          kind={card.item.type === "income" ? "income" : "expense"}
          categories={categories}
          reloadCategories={reloadCategories}
          onClose={() => setEditing(false)}
          onChoose={(id) => {
            setEditing(false);
            void confirm(id, card.categoryId);
          }}
        />
      ) : null}
    </section>
  );
}
