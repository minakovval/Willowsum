import type { ReactNode } from "react";
import "./planning.css";

/** The columns a region of the 12-column grid takes (GRID-04@PoC: 4, 8 or 12). */
export type PlanSpan = 4 | 8 | 12;

/**
 * GRID-04@PoC: the page grid of the «Планування» pages. Regions sit on the 12 columns of Expanded and Large
 * (GRID-00 FR 2); the content of a region belongs to the screen that fills it (waves 2, rows 123 and onward).
 */
export function PlanGrid({ page, children }: { page: string; children: ReactNode }) {
  return (
    <div className="plan-grid" data-plan-page={page}>
      {children}
    </div>
  );
}

/**
 * One region of the grid. Without `children` it is an empty slot: a card of the region's width that the later
 * screen row fills. Regions of one row stretch to one height and a card fills its region (GRID-04 FR 1).
 */
export function PlanRegion({
  name,
  span,
  card = false,
  children,
}: {
  name: string;
  span: PlanSpan;
  /** Draws the region as a card (`ws-card`): the slot of a screen block, not a bare column. */
  card?: boolean;
  children?: ReactNode;
}) {
  const empty = children === undefined || children === null;
  return (
    <div
      className={["plan-region", `plan-span-${span}`, card || empty ? "ws-card plan-slot" : ""]
        .filter(Boolean)
        .join(" ")}
      data-plan-region={name}
      data-empty={empty ? "true" : undefined}
    >
      {children}
    </div>
  );
}
