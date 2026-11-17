import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { motion } from "../tokens/motion.ts";

/** «✓» success, «✕» error, «i» information (CMP-20 «Будова»). */
export type ToastTone = "success" | "error" | "info";

export interface ToastProps {
  /** One short line in the past tense («Категорію підтверджено»). */
  text: string;
  tone?: ToastTone | undefined;
  /** The one action, «Відмінити» (never «Скасувати»): returns the action just done. */
  action?: { label: string; onAction: () => void } | undefined;
  /** The accessible name of «×» («Закрити»). */
  closeLabel: string;
  /** «×», Esc inside the message, or the timer ran out; the consumer stops rendering it. */
  onDismiss: () => void;
}

const MARKER: Readonly<Record<ToastTone, IconName>> = { success: "check", error: "close", info: "info" };

/**
 * The toast of CMP-20 as the review queue needs it (BUD-12@PoC FR 6, wave 2 row 121): the result of the user's own
 * action, bottom left over the content, at most one action «Відмінити» and «×». A success or info message closes
 * itself after `duration-toast` (8 s), with the action after `duration-toast-undo` (10 s); an error stays until
 * closed. The timer stops while the pointer is over the message or the focus is inside it. `role="status"`: read
 * without moving the focus; it never takes the focus. One at a time: the consumer renders a single Toast and gives a
 * new message a new `key`, which replaces the previous one and starts its own timer. No countdown is shown.
 */
export function Toast({ text, tone = "success", action, closeLabel, onDismiss }: ToastProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const left = useRef<number>(action ? motion["duration-toast-undo"] : motion["duration-toast"]);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  const paused = hovered || focused;

  useEffect(() => {
    if (tone === "error" || paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss.current(), left.current);
    return () => {
      window.clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [tone, paused]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    dismiss.current();
  }, []);

  return (
    <div
      className="ws-toast"
      data-tone={tone}
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
    >
      <span className="ws-toast-marker" aria-hidden="true">
        <Icon name={MARKER[tone]} size={16} />
      </span>
      <span className="ws-toast-text">{text}</span>
      {action ? (
        <button type="button" className="ws-toast-action" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
      <button type="button" className="ws-toast-close" aria-label={closeLabel} onClick={() => onDismiss()}>
        <Icon name="close" size={16} inButton />
      </button>
    </div>
  );
}
