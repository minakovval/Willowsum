import { formatLocaleOf, useI18n, type MessageKey, type MessageParams } from "@willowsum/i18n";
import { statusEntry } from "./dictionary.ts";

export interface StatusMarkProps {
  /** An id of the dictionary (`statusEntry`): a state that is not in it cannot be shown. */
  id: string;
  /** The values of the word's `{placeholders}`, already formatted by the caller (amounts, dates, percents). */
  params?: MessageParams | undefined;
  /** The values for the spoken form when they differ from the shown ones (an amount spoken in full, DS-04). */
  spokenParams?: MessageParams | undefined;
  /** The spoken form when the shown word is only a number (the amount change «▲ 2,00 €» of a payment). */
  spokenText?: string | undefined;
  /** The direction of an entry whose marker comes from the data (`▲▼`: family Б). */
  arrow?: "▲" | "▼" | undefined;
  /** Only the marker is shown (a calendar cell); the word stays in the accessible name. */
  markerOnly?: boolean;
  className?: string;
}

const PLURAL_PARAM = { days: "days", months: "count" } as const;

/**
 * DS-23@PoC: one status of the dictionary. The marker and the word are always together (NFR-08 FR 4: the colour
 * never carries the value alone); the tone is the entry's, not the caller's. A badge entry is a flat plate on the
 * tone's tint (CMP-18), the others are text. The accessible name is «Статус: <слово>» with an abbreviated day or
 * month spoken in full («Статус: Прострочено на 5 днів»); the visible marker and word are hidden from screen
 * readers so the name is read once. Not a button; it never takes focus (the control that holds it does).
 */
export function StatusMark({
  id,
  params,
  spokenParams,
  spokenText,
  arrow,
  markerOnly = false,
  className,
}: StatusMarkProps) {
  const { t, locale } = useI18n();
  const entry = statusEntry(id);
  const word = t(entry.textKey, params);
  let spoken = spokenText ?? word;
  if (!spokenText && entry.spoken) {
    const source = spokenParams ?? params ?? {};
    const rule = new Intl.PluralRules(formatLocaleOf(locale)).select(
      Number(source[PLURAL_PARAM[entry.spoken]]),
    );
    const form = rule === "one" || rule === "few" || rule === "many" ? rule : "other";
    spoken = t(`${entry.textKey}.spoken.${form}` as MessageKey, source);
  } else if (!spokenText && spokenParams) spoken = t(entry.textKey, spokenParams);
  let marker = entry.marker;
  if (marker === "▲▼") {
    if (!arrow) throw new RangeError(`«${id}» takes its arrow from the data: pass \`arrow\``);
    marker = arrow;
  }
  const classes = ["ws-status", className].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      data-status={id}
      data-tone={entry.tone}
      data-ink={entry.ink}
      data-plate={entry.plate ? (entry.quiet ? "quiet" : entry.tone) : undefined}
    >
      {marker ? (
        <span className="ws-status-marker" aria-hidden="true">
          {marker}
        </span>
      ) : null}
      {markerOnly ? null : (
        <span className="ws-status-word" aria-hidden="true">
          {word}
        </span>
      )}
      <span className="ws-visually-hidden">{t("status.prefix", { status: spoken })}</span>
    </span>
  );
}
