import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { space } from "../tokens/spacing.ts";

/** Gap between the element and the tooltip; the `::before` bridge in components.css covers it. */
const GAP = space["space-1"];
/** The tooltip never comes closer than this to the window edges. */
const EDGE = space["space-2"];

/** One tooltip at a time: opening one closes the one that is open (e.g. hover on one element, Tab to another). */
let closeCurrent: (() => void) | null = null;

type Placement = "top" | "bottom";
interface Position {
  top: number;
  left: number;
  placement: Placement;
}

export interface TooltipTriggerProps {
  ref: (el: HTMLElement | null) => void;
  "aria-describedby": string;
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave: (e: MouseEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
  onMouseDown: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * Where the tooltip goes: above the element, centred; below it when there is no room above; never past the
 * window edges (CMP-25 «Стани»).
 */
export function placeTooltip(
  trigger: Pick<DOMRect, "left" | "top" | "width" | "bottom">,
  tip: { width: number; height: number },
  view: { width: number; height: number },
): Position {
  let placement: Placement = "top";
  let top = trigger.top - GAP - tip.height;
  if (top < EDGE) {
    placement = "bottom";
    top = trigger.bottom + GAP;
    if (top + tip.height > view.height - EDGE) top = Math.max(EDGE, view.height - EDGE - tip.height);
  }
  const centred = trigger.left + trigger.width / 2 - tip.width / 2;
  const left = Math.max(EDGE, Math.min(centred, view.width - EDGE - tip.width));
  return { top, left, placement };
}

/**
 * CMP-25@PoC: the tooltip behaviour for one element. Shown at once on hover and on keyboard focus; closed by
 * Esc, by the pointer leaving, by the focus leaving and by scrolling. WCAG 2.2 1.4.13: the pointer can move onto
 * the tooltip (hoverable), Esc closes it without moving the pointer or the focus (dismissible), and it stays
 * while hovered or focused, with no time-out (persistent). `enabled: false` leaves the element untouched: no
 * tooltip, no description.
 */
export function useTooltip(
  text: string,
  enabled = true,
): { triggerProps: TooltipTriggerProps | null; tooltip: ReactNode } {
  const id = useId();
  const trigger = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  // Focus that follows a click is not keyboard focus: the pointer alone decides then.
  const pressed = useRef(false);
  // Focus by Tab scrolls the element into view; that scroll event arrives in the next frame and is not the
  // user scrolling the page, so it must not close the tooltip the focus has just opened.
  const revealing = useRef(false);
  const open = enabled && (hover || focus) && !dismissed;

  // When the element stops needing a tooltip (e.g. its text now fits), forget the hover and focus it had, so
  // the tooltip does not open by itself if it is needed again later (state adjusted during render).
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) {
      setHover(false);
      setFocus(false);
      setDismissed(false);
    }
  }

  const leave = useCallback(() => {
    setHover(false);
  }, []);
  // A new hover or keyboard focus, after the pointer and the focus both left, shows a dismissed tooltip again.
  const start = (set: (v: boolean) => void) => {
    if (!hover && !focus) setDismissed(false);
    set(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setDismissed(true);
    if (closeCurrent !== close) closeCurrent?.();
    closeCurrent = close;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDismissed(true);
    };
    const onScroll = () => {
      if (!revealing.current) setDismissed(true);
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      if (closeCurrent === close) closeCurrent = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = trigger.current;
    const tip = tipRef.current;
    if (!el || !tip) return;
    const measure = () => {
      const size = tip.getBoundingClientRect();
      setPos(
        placeTooltip(
          el.getBoundingClientRect(),
          { width: size.width, height: size.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, text]);

  const setTrigger = useCallback((el: HTMLElement | null) => {
    trigger.current = el;
  }, []);

  if (!enabled) return { triggerProps: null, tooltip: null };

  const triggerProps: TooltipTriggerProps = {
    ref: setTrigger,
    "aria-describedby": id,
    onMouseEnter: () => start(setHover),
    onMouseLeave: (e) => {
      if (e.relatedTarget instanceof Node && tipRef.current?.contains(e.relatedTarget)) return;
      leave();
    },
    onMouseDown: () => {
      // Cleared on the release of the button, so a press that did not move the focus cannot leave it set.
      pressed.current = true;
      window.addEventListener(
        "mouseup",
        () => {
          pressed.current = false;
        },
        { once: true, capture: true },
      );
    },
    onFocus: () => {
      if (pressed.current) return;
      revealing.current = true;
      requestAnimationFrame(() => requestAnimationFrame(() => (revealing.current = false)));
      start(setFocus);
    },
    onBlur: () => {
      pressed.current = false;
      setFocus(false);
    },
  };

  const tooltip =
    typeof document === "undefined"
      ? null
      : createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="ws-tooltip"
            hidden={!open}
            data-placement={pos?.placement ?? "top"}
            data-positioned={pos ? "true" : undefined}
            style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : undefined}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={(e) => {
              if (e.relatedTarget instanceof Node && trigger.current?.contains(e.relatedTarget)) return;
              leave();
            }}
          >
            {text}
          </div>,
          document.body,
        );

  return { triggerProps, tooltip };
}

function assignRef(ref: Ref<HTMLElement> | undefined, el: HTMLElement | null) {
  if (typeof ref === "function") ref(el);
  else if (ref) ref.current = el;
}

type Handler<E> = ((e: E) => void) | undefined;
const both =
  <E,>(a: Handler<E>, b: Handler<E>) =>
  (e: E) => {
    a?.(e);
    b?.(e);
  };

interface TriggerChildProps {
  ref?: Ref<HTMLElement>;
  "aria-describedby"?: string | undefined;
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLElement>) => void;
}

/**
 * CMP-25@PoC: a tooltip on one focusable element that shows its content only as an icon or a short form, e.g.
 * an icon-only button. The element keeps the full text in its accessible name (`aria-label`); the tooltip
 * describes it. Text only, never actions.
 */
export function Tooltip({ text, children }: { text: string; children: ReactElement<TriggerChildProps> }) {
  const { triggerProps, tooltip } = useTooltip(text);
  const own = children.props;
  const ref = (el: HTMLElement | null) => {
    triggerProps?.ref(el);
    assignRef(own.ref, el);
  };
  const described = [own["aria-describedby"], triggerProps?.["aria-describedby"]].filter(Boolean).join(" ");
  return (
    <>
      {cloneElement(children, {
        ref,
        "aria-describedby": described || undefined,
        onMouseEnter: both(own.onMouseEnter, triggerProps?.onMouseEnter),
        onMouseLeave: both(own.onMouseLeave, triggerProps?.onMouseLeave),
        onFocus: both(own.onFocus, triggerProps?.onFocus),
        onBlur: both(own.onBlur, triggerProps?.onBlur),
        onMouseDown: both(own.onMouseDown, triggerProps?.onMouseDown),
      })}
      {tooltip}
    </>
  );
}

/**
 * CMP-25@PoC: text cut off on one line with an ellipsis (a card or goal name, a table cell, a long field value).
 * Only when it is actually cut off does it take the focus and get a tooltip with the full text; text that fits
 * has neither. The full text always stays in the DOM, so screen readers read all of it.
 */
export function TruncatedText({ text, className }: { text: string; className?: string | undefined }) {
  const el = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth + 0.5);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [text]);

  const { triggerProps, tooltip } = useTooltip(text, truncated);
  const ref = (node: HTMLSpanElement | null) => {
    el.current = node;
    triggerProps?.ref(node);
  };
  return (
    <>
      <span
        {...triggerProps}
        ref={ref}
        className={className ? `ws-truncate ${className}` : "ws-truncate"}
        tabIndex={truncated ? 0 : undefined}
      >
        {text}
      </span>
      {tooltip}
    </>
  );
}
