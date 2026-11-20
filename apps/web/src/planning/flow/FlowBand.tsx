import type { ReactNode } from "react";
import { Decimal } from "@willowsum/domain-kernel";
import { formatMoney, useI18n } from "@willowsum/i18n";
import { Icon } from "@willowsum/ui";
import type { Money } from "./model.ts";

export interface BandPart {
  readonly id: string;
  readonly label: string;
  readonly amount: Money;
  /** The colour token of the part (`chart-cat-N`): the swatch of its legend row repeats it. */
  readonly tone: number;
  /** A quiet «›» after the amount, with its hint (the debt row opens «Борги»). */
  readonly open?: { readonly href: string; readonly label: string };
}

/** The width of a segment: the part's share is drawn by the browser (`flex-grow`), nothing is summed or divided here. */
const grow = (m: Money): string => (new Decimal(m.amount).gt(0) ? new Decimal(m.amount).toFixed(2) : "0");

/**
 * CHT-03 «Смуга» of the card «Куди пішов дохід» (BUD-08@PoC FR 2: the card has this view only): the row «Усього», the band
 * of the parts and the legend with the sums. The legend is the text of the band: every part has its name and amount
 * there, so the colour is not the only sign (NFR-08 FR 4). The percent labels of the board wait for the API to send
 * the shares: the web does no arithmetic on money.
 */
export function FlowBand({ total, parts }: { total: Money; parts: readonly BandPart[] }) {
  const { t, locale } = useI18n();
  const money = (m: Money) => formatMoney(locale, m.amount, m.currency);
  const drawn = parts.filter((p) => grow(p.amount) !== "0");
  const summary = parts.map((p) => `${p.label} ${money(p.amount)}`).join(", ");
  return (
    <div className="flow-band-box">
      <div className="flow-band-total">
        <b>{t("flow.where.total")}</b>
        <b className="ws-tabular">{money(total)}</b>
      </div>
      <div
        className="flow-band"
        role="img"
        aria-label={t("flow.where.band", { parts: summary })}
        data-segments={drawn.length}
      >
        {drawn.map((p) => (
          <span
            key={p.id}
            className="flow-band-part"
            data-part={p.id}
            style={{ flexGrow: grow(p.amount), background: `var(--ws-chart-cat-${p.tone})` }}
            title={`${p.label} · ${money(p.amount)}`}
          />
        ))}
      </div>
      <ul className="flow-legend">
        {parts.map((p) => (
          <li key={p.id} data-part={p.id}>
            <span
              className="flow-swatch"
              aria-hidden="true"
              style={{ background: `var(--ws-chart-cat-${p.tone})` }}
            />
            <span className="flow-legend-name">{p.label}</span>
            <b className="ws-tabular flow-legend-amount">{money(p.amount)}</b>
            <OpenLink open={p.open} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenLink({ open }: { open: BandPart["open"] }): ReactNode {
  if (!open) return <span className="flow-open-gap" aria-hidden="true" />;
  return (
    <a className="flow-open" href={open.href} aria-label={open.label} title={open.label}>
      <Icon name="chevron-right" size={16} tone="muted" />
    </a>
  );
}
