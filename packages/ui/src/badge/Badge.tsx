export type BadgeTone = "positive" | "negative" | "attention" | "info" | "neutral";

/** The symbol of each tone: the colour only strengthens it (CMP-18 «Будова», NFR-08 FR 4). */
const SYMBOL: Record<BadgeTone, string> = {
  positive: "✓",
  negative: "✕",
  attention: "!",
  info: "i",
  neutral: "•",
};

/**
 * The part of CMP-18 Badge that the rows use (CMP-27, CMP-28): a flat 20 px plate with the tone's symbol and a
 * one- or two-word label on its tint; not a button, never wrapped, the symbol is always there. The `label` is
 * passed in (no strings here). The full Badge (tooltip on a cut label, every tone's use rules) is its own PR.
 */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  return (
    <span className={`ws-badge ws-badge-${tone}`} data-tone={tone}>
      <span aria-hidden="true">{SYMBOL[tone]}</span>
      <span className="ws-badge-label">{label}</span>
    </span>
  );
}
