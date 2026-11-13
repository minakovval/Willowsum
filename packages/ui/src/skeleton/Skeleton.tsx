import { useEffect, useState, type CSSProperties } from "react";
import { useT } from "@willowsum/i18n";
import { motion } from "../tokens/motion.ts";

export type SkeletonVariant = "text" | "row" | "block";

export interface SkeletonProps {
  /**
   * `text` — 12 px bars 100 / 80 / 60 % wide, 12 px apart; `row` — a list row: a circle or a logo tile and two
   * bars, with the amount bar at the end; `block` — a 64 px rectangle (or the height of the chart it stands for).
   */
  variant: SkeletonVariant;
  /** How many bars or rows, the same as the content that replaces it. Lists: 8 rows; text: 3 bars; block: 1. */
  lines?: number;
  /** `row` only: a circle (avatar or icon) or a 32 px tile with an 8 px radius (logo, the default). */
  leading?: "circle" | "tile";
  /** `block` only: the height in px of the content it stands for (a chart), instead of 64 px. */
  height?: number;
  /** `block` only: the shape of a 40 px field with an 8 px radius. */
  field?: boolean;
  /** Show «Ще завантажується…» now; otherwise it appears after 3 s (`duration-skeleton-slow`). */
  slow?: boolean;
  className?: string;
}

const DEFAULT_LINES: Record<SkeletonVariant, number> = { text: 3, row: 8, block: 1 };
const TEXT_WIDTHS = ["100", "80", "60"] as const;

/**
 * CMP-22@PoC: the loading state of every list, widget and page. Built on the DS-13 `.ws-skeleton` style
 * (shimmer, one pass in 1.6 s; static with reduced motion). The container is `aria-busy` and announces
 * «Завантаження» once; the shapes are hidden from screen readers and never take focus. «Ще завантажується…» lies
 * out of flow just under the skeleton (AC5): leave about 24 px below it (a card's bottom padding does) so the line
 * does not cover the next block.
 */
export function Skeleton({
  variant,
  lines = DEFAULT_LINES[variant],
  leading = "tile",
  height,
  field = false,
  slow,
  className,
}: SkeletonProps) {
  const t = useT();
  const late = useLate(motion["duration-skeleton-slow"]);
  // A live region is announced when its text changes, not when it is inserted with its text: render it empty
  // first, fill it in the next frame, and keep it outside the aria-busy container, which lets a reader hold changes.
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnnounce(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const count = Math.max(1, Math.floor(lines));
  const keys = Array.from({ length: count }, (_, i) => i);

  return (
    <>
      {/* One polite status, filled once after mount: announced once; the slow line below is not live. */}
      <span role="status" className="ws-visually-hidden">
        {announce ? t("skeleton.loading") : ""}
      </span>
      <div
        className={["ws-skeleton-region", className].filter(Boolean).join(" ")}
        aria-busy="true"
        data-variant={variant}
      >
        <div className={`ws-skeleton-shapes ws-skeleton-shapes--${variant}`} aria-hidden="true">
          {variant === "text" &&
            keys.map((i) => <span key={i} className="ws-skeleton" data-width={TEXT_WIDTHS[i % 3]} />)}
          {variant === "row" &&
            keys.map((i) => (
              <span key={i} className="ws-skeleton-row">
                <span className={`ws-skeleton ws-skeleton--${leading}`} />
                <span className="ws-skeleton-lines">
                  <span className="ws-skeleton" data-width="60" />
                  <span className="ws-skeleton" data-width="40" />
                </span>
                <span className="ws-skeleton ws-skeleton--amount" />
              </span>
            ))}
          {variant === "block" &&
            keys.map((i) => (
              <span
                key={i}
                className={`ws-skeleton ws-skeleton--block${field ? " ws-skeleton--field" : ""}`}
                style={
                  height === undefined || field ? undefined : ({ blockSize: `${height}px` } as CSSProperties)
                }
              />
            ))}
        </div>
        {/* Out of flow (components.css): showing it, or replacing the skeleton later, moves nothing (AC5). */}
        {(slow ?? late) && <p className="ws-skeleton-slow ws-text-body-sm ws-muted">{t("skeleton.slow")}</p>}
      </div>
    </>
  );
}

/** True once `ms` have passed since the component mounted. */
function useLate(ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return late;
}
