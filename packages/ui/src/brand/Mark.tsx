import { useT } from "@willowsum/i18n";

/**
 * The Willowsum mark — DS-02 item 3: three nested quarter-circle leaves sharing a sharp lower-left
 * corner, on a 64 × 64 canvas with an 8-unit margin (radii 24, 16, 8). Fills come from theme
 * tokens, so the light theme shows navy / blue / amber and the dark theme sand / steel / amber
 * (DS-02 item 11) from one file. Never mirrored in right-to-left languages (DS-02 acceptance 7).
 */
export function WillowsumMark({ size = 24, decorative = false }: { size?: number; decorative?: boolean }) {
  const t = useT();
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": t("brand.markLabel") } as const);
  return (
    <svg
      className="ws-mark"
      width={Math.max(size, 16)}
      height={Math.max(size, 16)}
      viewBox="0 0 64 64"
      focusable="false"
      {...a11y}
    >
      <path className="ws-mark-large" d="M8 56 V32 A24 24 0 0 1 32 8 H56 V32 A24 24 0 0 1 32 56 Z" />
      <path className="ws-mark-middle" d="M8 56 V40 A16 16 0 0 1 24 24 H40 V40 A16 16 0 0 1 24 56 Z" />
      <path className="ws-mark-small" d="M8 56 V48 A8 8 0 0 1 16 40 H24 V48 A8 8 0 0 1 16 56 Z" />
    </svg>
  );
}

/** Mark + live-text wordmark (DS-02 item 7: Inter Tight 600, −2 % tracking, colour ink). */
export function Wordmark({ markSize = 24 }: { markSize?: number }) {
  const t = useT();
  return (
    <span className="ws-wordmark">
      <WillowsumMark size={markSize} decorative />
      <span className="ws-wordmark-name">{t("brand.name")}</span>
    </span>
  );
}
