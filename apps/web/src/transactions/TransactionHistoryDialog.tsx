import {
  formatDate,
  formatDateTime,
  formatMoney,
  useI18n,
  useT,
  type Locale,
  type MessageKey,
  type Translate,
} from "@willowsum/i18n";
import { Button, Dialog, Skeleton } from "@willowsum/ui";
import { loadHistory, useLoaded, type DetailData, type HistoryEntry } from "./detail.ts";

/** The label of each audited field (the hand-off's and the category's, `apps/api` domain/history.ts). */
const FIELD_KEYS: Readonly<Record<string, MessageKey>> = {
  amount: "newTx.amount",
  currency: "newAccount.currency",
  accountId: "newTx.account",
  date: "newTx.date",
  counterparty: "newTx.counterparty",
  description: "newTx.description",
  status: "newTx.status",
  hidden: "txDetail.hidden",
  mergedInto: "txDetail.merged",
  note: "txHistory.field.note",
  tags: "newTx.tags",
  review: "tx.tab.review",
  categoryId: "newTx.category",
  source: "txHistory.field.source",
  ruleId: "txHistory.field.ruleId",
};
const SOURCE_VALUES: Readonly<Record<string, MessageKey>> = {
  manual: "txDetail.source.manual",
  rule: "txDetail.source.rule",
  merchant: "txDetail.source.merchant",
  bank: "txDetail.source.bank",
  dictionary: "txDetail.source.dictionary",
};
const ACTOR_KEYS: Readonly<Record<HistoryEntry["actor"], MessageKey>> = {
  you: "txHistory.actor.you",
  member: "txHistory.actor.member",
  staff: "txHistory.actor.staff",
  system: "txHistory.actor.system",
};
const ACTION_KEYS: Readonly<Record<HistoryEntry["action"], MessageKey>> = {
  create: "txHistory.action.create",
  update: "txHistory.action.update",
  delete: "txHistory.action.delete",
};

function fieldLabel(t: Translate, field: string): string {
  if (field.startsWith("transfer.")) return t("txHistory.field.transfer");
  if (field.startsWith("split.")) return t("txHistory.field.split");
  const key = FIELD_KEYS[field];
  return key ? t(key) : t("txHistory.field.other");
}

/**
 * A value as the details show it, or `undefined` when it cannot be shown: masked free text (П-10) and the ids of
 * tags, rules, transfers, splits and merges, which have no name here — the line then says «змінено».
 */
function shownValue(
  t: Translate,
  locale: Locale,
  data: DetailData,
  field: string,
  value: string | null,
): string | undefined {
  if (value === null) return field === "hidden" ? t("txHistory.no") : "—";
  try {
    switch (field) {
      case "amount":
        return formatMoney(locale, value, data.transaction.amount.currency);
      case "date":
        return formatDate(locale, value);
      case "currency":
        return value;
      case "status":
        return t(value === "pending" ? "newTx.status.pending" : "newTx.status.posted");
      case "hidden":
        return t(value === "true" ? "txHistory.yes" : "txHistory.no");
      case "accountId":
      case "categoryId":
        return data.names.get(value);
      case "source":
        return value === "none"
          ? t("transactionRow.uncategorized")
          : SOURCE_VALUES[value] && t(SOURCE_VALUES[value]);
      default:
        return undefined;
    }
  } catch {
    // A value the log holds in a shape the formatter does not take is not shown rather than shown wrong.
    return undefined;
  }
}

/** «17 лист. 2026 р., 09:14» in the browser's time zone; a stamp the formatter refuses is left out. */
function whenOf(locale: Locale, instant: string, zone: string): string | undefined {
  try {
    return formatDateTime(locale, instant, zone);
  } catch {
    return undefined;
  }
}

/** The lines of one entry: «Сума: −42,80 € → −40,00 €»; a created record lists what it was created with. */
function changeLines(t: Translate, locale: Locale, data: DetailData, entry: HistoryEntry): string[] {
  if (entry.action === "delete") return [];
  const lines: string[] = [];
  for (const c of entry.changes) {
    const field = fieldLabel(t, c.field);
    const after = c.masked ? undefined : shownValue(t, locale, data, c.field, c.after);
    if (entry.action === "create") {
      if (c.after !== null && after !== undefined) lines.push(t("txHistory.value", { field, value: after }));
      continue;
    }
    const before = c.masked ? undefined : shownValue(t, locale, data, c.field, c.before);
    lines.push(
      before === undefined || after === undefined
        ? t("txHistory.changed", { field })
        : t("txHistory.change", { field, before, after }),
    );
  }
  // Several parts of one transfer or split read as one line.
  return [...new Set(lines)];
}

/**
 * «Історія змін» from the menu «…» of S-047 (FIN-03@PoC FR 20, FR 27; leader's decisions of 2026-11-17 in
 * docs/decisions/log/2026-11-17-fin03-tx-history.md): what the space's audit log recorded about the transaction and its
 * category, oldest first; who — relative to the reader; free text never shown (П-10). A bulk action is not in it
 * (DAT-03@PoC edge case 3: the server leaves it out). Over 500 entries the server sends the newest and `truncated`.
 */
export function TransactionHistoryDialog({ data, onClose }: { data: DetailData; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { state, retry } = useLoaded(data.transaction.id, loadHistory);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("txDetail.menu.history")}
      closeLabel={t("shell.close")}
      align="start"
      actions={[{ label: t("shell.close"), onClick: onClose }]}
    >
      {state.kind === "loading" ? (
        <div aria-busy="true">
          <Skeleton variant="row" lines={3} />
        </div>
      ) : state.kind === "ready" ? (
        state.data.items.length === 0 ? (
          <p className="ws-muted">{t("txHistory.empty")}</p>
        ) : (
          <>
            {state.data.truncated ? (
              <p className="ws-muted">{t("txHistory.truncated", { count: state.data.items.length })}</p>
            ) : null}
            <ol className="txd-history">
              {state.data.items.map((entry) => {
                const lines = changeLines(t, locale, data, entry);
                return (
                  <li key={entry.id}>
                    <p className="txd-history-head">
                      {[
                        whenOf(locale, entry.occurredAt, zone),
                        t(ACTOR_KEYS[entry.actor]),
                        t(ACTION_KEYS[entry.action]),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {lines.length > 0 ? (
                      <ul>
                        {lines.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </>
        )
      ) : (
        // `missing`: the transaction went away while the dialog opened (404) — the same error with its retry.
        <LoadError
          body={t("txHistory.error")}
          supportId={state.kind === "error" ? state.supportId : undefined}
          retry={retry}
        />
      )}
    </Dialog>
  );
}

/** «✕ Помилка», what failed, «Спробувати ще раз» and «Код: …» (canvas PocStates). */
export function LoadError({
  body,
  supportId,
  retry,
}: {
  body: string;
  supportId: string | undefined;
  retry: () => void;
}) {
  const t = useT();
  return (
    <div className="txd-state" role="alert">
      <p className="txd-error-title">{t("tx.error.title")}</p>
      <p>{body}</p>
      <Button label={t("tx.error.retry")} onClick={retry} />
      {supportId ? <p className="ws-muted">{t("tx.error.code", { code: supportId })}</p> : null}
    </div>
  );
}
