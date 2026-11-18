import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

export interface PopoverProps {
  /** The popover is shown while `open`; the consumer sets it to false from `onClose`. */
  open: boolean;
  /** Esc, a press outside the popover and «Скасувати» (the consumer's own button) end here. */
  onClose: () => void;
  /** The accessible name of the dialog («Внести у “Відпустка в Італії”»). */
  label: string;
  /** The button the popover opens from (or the element that wraps it): focus returns to it when the popover closes. */
  anchor: RefObject<HTMLElement | null>;
  /** Which edge of the button the popover lines up with. */
  align?: "start" | "end";
  children: ReactNode;
}

/**
 * CMP-61@PoC FR 8, AC8: a small form that opens from a button — `role="dialog"` with no backdrop, so the page behind
 * stays visible and reachable by a click (a click outside closes it). It sits in the closest `ws-popover-host` (the
 * consumer wraps the button in it), under the button. Focus goes to the first field on open and back to the button on
 * Esc or close. A form that must stop the page (account balance, «Витратити») is a modal Dialog, not a Popover.
 */
export function Popover({ open, onClose, label, anchor, align = "end", children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const el = anchor.current;
      (el?.matches("button, a") ? el : el?.querySelector<HTMLElement>("button, a"))?.focus();
    }
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !ref.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onClose, anchor]);

  if (!open) return null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`ws-popover ws-popover--${align}`}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
