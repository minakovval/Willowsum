import { keepNumbersTogether } from "@willowsum/i18n";
import { useLayoutEffect, useRef, useState } from "react";
import { Amount, useHideAmounts } from "../privacy/HideAmounts.tsx";
import { useTooltip } from "../tooltip/Tooltip.tsx";
import { chooseFit, type FitChoice } from "./fit.ts";

type FitSize = "amount-xl" | "amount-l" | "amount-m" | "amount-s";

/**
 * CMP-07 «Великі значення», DS-08 item 11. An amount that never breaks across lines. After a label in
 * the same line it moves to a new line as a whole (it is one inline-block); when it does not fit even
 * its own line, it shrinks to 80 %, then switches to the abbreviated form, then shrinks down to 55 %.
 * The full value is always in the accessible name and, once abbreviated, in the tooltip (CMP-25@PoC): the
 * abbreviated amount then takes the focus so the keyboard reaches the tooltip too.
 */
export function FitAmount({
  value,
  compact,
  size = "amount-s",
}: {
  value: string;
  compact: string | null;
  size?: FitSize;
}) {
  const { hidden } = useHideAmounts();
  const outer = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const full = keepNumbersTogether(value);
  const short = compact ? keepNumbersTogether(compact) : null;
  const key = `${full}|${short ?? ""}`;
  const [fitted, setFitted] = useState<FitChoice & { key: string }>({
    key,
    text: full,
    scale: 1,
    abbreviated: false,
  });
  // A new value is shown at once at full size; the stored fit applies only to the value it measured.
  const choice: FitChoice = fitted.key === key ? fitted : { text: full, scale: 1, abbreviated: false };

  useLayoutEffect(() => {
    const el = outer.current;
    const box = el?.parentElement;
    const p = probe.current;
    if (!el || !box || !p || hidden) return;
    const measure = () => {
      const width = box.clientWidth;
      if (width === 0) return;
      const fits = (text: string, scale: number) => {
        p.textContent = text;
        p.style.fontSize = `${scale}em`;
        return p.getBoundingClientRect().width <= width + 0.5;
      };
      const next = chooseFit(full, short, fits);
      setFitted((prev) =>
        prev.key === key && prev.text === next.text && prev.scale === next.scale ? prev : { key, ...next },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [full, short, key, hidden]);

  const { triggerProps, tooltip } = useTooltip(full, choice.abbreviated && !hidden);
  const setOuter = (el: HTMLSpanElement | null) => {
    outer.current = el;
    triggerProps?.ref(el);
  };

  if (hidden) return <Amount value={value} size={size} />;
  return (
    <>
      <span
        {...triggerProps}
        ref={setOuter}
        className={`ws-amount-fit ws-text-${size}`}
        tabIndex={choice.abbreviated ? 0 : undefined}
      >
        <span
          className="ws-amount ws-tabular"
          style={{ fontSize: `${choice.scale}em` }}
          aria-hidden={choice.abbreviated ? true : undefined}
        >
          {choice.text}
        </span>
        {choice.abbreviated ? <span className="ws-visually-hidden">{full}</span> : null}
        <span ref={probe} className="ws-amount-fit__probe ws-amount ws-tabular" aria-hidden="true" />
      </span>
      {tooltip}
    </>
  );
}
