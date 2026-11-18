import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { IconButton } from "../icons/IconButton.tsx";
import { useTooltip } from "../tooltip/Tooltip.tsx";
import { PortalRootContext } from "./portal.ts";

/** The tone of the icon tile (CMP-21@PoC «Розміри і стиль»): `tint-info`, `tint-warning`, `tint-negative`. */
export type DialogTone = "info" | "warning" | "danger";
/** 560 px for every dialog; 640 px only for «Розділити транзакцію»; 900 px only for the receipt next to its original. */
export type DialogSize = "default" | "split" | "wide";
/** Primary — `brand` fill; danger — `loss` text and 1.5 px border on white; secondary — 1 px `border-control`. */
export type DialogActionVariant = "primary" | "secondary" | "danger";

export interface DialogAction {
  label: string;
  onClick: () => void;
  variant?: DialogActionVariant | undefined;
  /** Inactive: keeps its place in the focus order (`aria-disabled`); the reason goes in `note`. */
  disabled?: boolean | undefined;
  /** The main action's label while `busy` («Видаляємо…»); the label stays when left out. */
  busyLabel?: string | undefined;
}

export interface DialogProps {
  open: boolean;
  /** Esc, the backdrop (with `closeLabel`) and «✕» call it; the consumer sets `open` to false. */
  onClose: () => void;
  /** A question or a direct phrase («Видалити рахунок "Monobank"?»): the dialog's name. */
  title: string;
  /** The short explanation: the dialog's description. */
  text?: ReactNode;
  icon?: IconName | undefined;
  tone?: DialogTone | undefined;
  /** `role="alertdialog"` (dangerous actions); by default for the `danger` tone. */
  alert?: boolean | undefined;
  /** Centred only for short messages; left-aligned (32 px edge) once there are fields, options or lists. */
  align?: "center" | "start" | undefined;
  size?: DialogSize | undefined;
  /** The accessible name of «✕» («Закрити»). Left out for a dialog that requires a decision: no «✕», no backdrop close. */
  closeLabel?: string | undefined;
  /** Left to right in a row; the primary goes on top when they stack. */
  actions: readonly DialogAction[];
  /** The action is running: the main action (primary, else danger) shows its busy label, the others are inactive. */
  busy?: boolean | undefined;
  /** A failed action, starting with «Помилка»: shown inside, the dialog stays open. */
  error?: ReactNode;
  /** A line above the buttons (why an action is inactive); inactive actions are described by it. */
  note?: string | undefined;
  /** Where focus goes on opening; by default the first field, else the first safe action — never a danger one. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /**
   * `equal` (default): equal buttons of one width in a row, a column when they do not fit. `form`: the bar of a form
   * (CMP-21 «Форма створення…», п. 6–7) — the first action («Скасувати») at the start, the rest («Назад», «Далі»,
   * the main action) at the end, each as wide as its label.
   */
  bar?: "equal" | "form" | undefined;
  children?: ReactNode;
}

/* «Діалоги не накладаються» (CMP-21@PoC AC5): one dialog holds the screen; a later one waits until it closes. */
let holder: symbol | null = null;
const waiting: symbol[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const claim = (id: symbol) => {
  if (holder === null) holder = id;
  else if (holder !== id && !waiting.includes(id)) waiting.push(id);
  emit();
};
const release = (id: symbol) => {
  if (holder === id) holder = waiting.shift() ?? null;
  else waiting.splice(waiting.indexOf(id) >>> 0, 1);
  emit();
};

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Controls Tab reaches: not disabled, not taken out of the order (`tabindex="-1"`, an unavailable step), outside a
 * hidden or inert part (a form step that is not shown) and outside a tooltip.
 */
const reachable = (el: HTMLElement) =>
  !(el as HTMLButtonElement).disabled &&
  el.getAttribute("tabindex") !== "-1" &&
  !el.closest("[hidden]") &&
  !el.closest("[inert]") &&
  !el.closest('[role="tooltip"]');

const focusables = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);

/** A computed CSS length in px («12px» → 12; «normal» → 0). Layout sizes, not amounts. */
const px = (value: string): number => Number(value.replace(/px$/, "")) || 0;

/** Equal-width buttons in one row need the widest label's width times their count (plus the gaps). */
function needsColumn(row: HTMLElement): boolean {
  const buttons = [...row.querySelectorAll<HTMLElement>(".ws-dialog-action")];
  if (buttons.length < 2) return false;
  const style = getComputedStyle(row);
  const gap = px(style.columnGap);
  const widest = Math.max(
    ...buttons.map((b) => {
      const s = getComputedStyle(b);
      const label = b.querySelector<HTMLElement>(".ws-dialog-action-label");
      return (
        (label?.getBoundingClientRect().width ?? 0) +
        px(s.paddingLeft) +
        px(s.paddingRight) +
        px(s.borderLeftWidth) +
        px(s.borderRightWidth)
      );
    }),
  );
  return widest * buttons.length + gap * (buttons.length - 1) > row.clientWidth + 0.5;
}

/** Role (explicit, else the tag) and accessible name (aria-label, else the text) of the element that opened a dialog. */
function openerIdentity(node: HTMLElement) {
  return {
    tag: node.tagName,
    role: node.getAttribute("role"),
    name: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim(),
  };
}

/** The connected element with the same role and name as a redrawn opener; none if there is no such element. */
function findSuccessor(key: ReturnType<typeof openerIdentity>): HTMLElement | null {
  if (!key.name) return null;
  const all = document.querySelectorAll<HTMLElement>(key.tag.toLowerCase());
  return (
    [...all].find(
      (n) =>
        !n.closest("dialog") && openerIdentity(n).role === key.role && openerIdentity(n).name === key.name,
    ) ?? null
  );
}

/**
 * CMP-21@PoC Dialog — the base: one template for every dialog (scrim with a 2 px blur, the 16 px container with
 * `shadow-dialog`, the icon tile, title and explanation, optional content, the light action bar), opened as a modal
 * `<dialog>` in the browser's top layer. Focus moves in and stays in, Esc closes, focus returns to the opener; a danger
 * action never gets focus by default. Only the body scrolls when content is taller than the window allows: the action
 * bar stays in place. Forms with steps and the typed-word confirmation are built on it (CMP-21 b).
 */
export function Dialog({
  open,
  onClose,
  title,
  text,
  icon,
  tone = "info",
  alert,
  align,
  size = "default",
  closeLabel,
  actions,
  busy = false,
  error,
  note,
  initialFocus,
  bar = "equal",
  children,
}: DialogProps) {
  const [slot] = useState(() => Symbol("dialog"));
  const current = useSyncExternalStore(
    subscribe,
    () => holder,
    () => null,
  );
  const shown = open && current === slot;
  const ref = useRef<HTMLDialogElement | null>(null);
  const [root, setRoot] = useState<HTMLDialogElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [column, setColumn] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  const pressedOnBackdrop = useRef(false);
  const setDialog = useCallback((el: HTMLDialogElement | null) => {
    ref.current = el;
    setRoot(el);
  }, []);
  const base = useId();
  const titleId = `${base}-title`;
  const textId = `${base}-text`;
  const noteId = `${base}-note`;

  useEffect(() => {
    if (!open) return;
    claim(slot);
    return () => release(slot);
  }, [open, slot]);

  // Open as a modal, move focus in; on close, give focus back to the element that opened it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!shown || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openerKey = opener ? openerIdentity(opener) : null;
    if (typeof el.showModal === "function") {
      if (!el.open) el.showModal();
    } else el.setAttribute("open", "");
    const field = [...el.querySelectorAll<HTMLElement>(`.ws-dialog-content :is(${FIELD})`)].find(reachable);
    const safe =
      el.querySelector<HTMLElement>('.ws-dialog-action[data-variant="secondary"]') ??
      el.querySelector<HTMLElement>('.ws-dialog-action:not([data-variant="danger"])');
    const target = initialFocus?.current ?? field ?? safe ?? el.querySelector<HTMLElement>(".ws-dialog-box");
    target?.focus();
    // Focus that lands outside (a programmatic focus elsewhere) is brought back in.
    const keepIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !el.contains(e.target)) (focusables(el)[0] ?? el).focus();
    };
    document.addEventListener("focusin", keepIn);
    return () => {
      document.removeEventListener("focusin", keepIn);
      if (typeof el.close === "function" && el.open) el.close();
      // DS-14@PoC EC1: an opener redrawn while the dialog was open is replaced by the element with the same role and name.
      if (opener?.isConnected) opener.focus();
      else if (openerKey) findSuccessor(openerKey)?.focus();
    };
    // `initialFocus` is read once on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Equal-width buttons in one row, or a full-width column (primary on top) when the widest label does not fit.
  useLayoutEffect(() => {
    const row = actionsRef.current;
    if (!shown || !row || bar === "form") return;
    const measure = () => setColumn(needsColumn(row));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [shown, actions, bar]);

  // A body taller than the dialog allows is a keyboard stop of its own (WebKit never makes a scroller focusable, and
  // Chromium's implicit stop is outside the trap's list): Tab reaches it, arrows scroll it, then Tab goes on.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!shown || !body) return;
    const measure = () => setScrolls(body.scrollHeight > body.clientHeight + 0.5);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    [...body.children].forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, [shown, children, error]);

  if (!shown || typeof document === "undefined") return null;

  const close = () => {
    if (!busy) onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      // An open tooltip inside took this Esc (it calls preventDefault): the dialog stays.
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const list = focusables(ref.current);
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    const inside =
      active instanceof Node && ref.current.contains(active) && list.includes(active as HTMLElement);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  // A press that starts and ends on the backdrop closes a dismissible dialog (the box fills the dialog element).
  const onMouseDown = (e: MouseEvent<HTMLDialogElement>) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  };
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (closeLabel && pressedOnBackdrop.current && e.target === e.currentTarget) close();
    pressedOnBackdrop.current = false;
  };

  const primaryFirst = column
    ? [...actions].sort((a, b) => Number(b.variant === "primary") - Number(a.variant === "primary"))
    : actions;
  // The main action: the primary, or the danger action of a confirmation («Видалити рахунок»).
  const main = actions.find((a) => a.variant === "primary") ?? actions.find((a) => a.variant === "danger");
  const isAlert = alert ?? tone === "danger";
  const alignment = align ?? (children ? "start" : "center");

  return createPortal(
    <dialog
      ref={setDialog}
      className="ws-dialog"
      role={isAlert ? "alertdialog" : undefined}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={text ? textId : undefined}
      aria-busy={busy || undefined}
      data-size={size}
      data-align={alignment}
      onKeyDown={onKeyDown}
      onCancel={(e) => e.preventDefault()}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <PortalRootContext.Provider value={root}>
        <div className="ws-dialog-box" tabIndex={-1}>
          {closeLabel ? (
            <IconButton
              icon="close"
              label={closeLabel}
              className="ws-dialog-close"
              aria-disabled={busy || undefined}
              onClick={close}
            />
          ) : null}
          <div
            ref={bodyRef}
            className="ws-dialog-body"
            tabIndex={scrolls ? 0 : undefined}
            role={scrolls ? "region" : undefined}
            aria-labelledby={scrolls ? titleId : undefined}
          >
            <div className="ws-dialog-head">
              {icon ? (
                <span className="ws-dialog-icon" data-tone={tone}>
                  <Icon name={icon} size={24} />
                </span>
              ) : null}
              <h2 id={titleId} className="ws-dialog-title">
                {title}
              </h2>
              {text ? (
                <p id={textId} className="ws-dialog-text">
                  {text}
                </p>
              ) : null}
            </div>
            {children ? <div className="ws-dialog-content">{children}</div> : null}
            {error ? (
              <div className="ws-dialog-error" role="alert">
                {error}
              </div>
            ) : null}
          </div>
          <div className="ws-dialog-foot">
            {note ? (
              <p id={noteId} className="ws-disabled-reason ws-dialog-note">
                {bar === "form" ? <Icon name="info" size={16} /> : null}
                <span>{note}</span>
              </p>
            ) : bar === "form" ? (
              // A form keeps the line's room while every button is active, so the bar never moves (AC21).
              <p className="ws-dialog-note" data-empty="true" aria-hidden="true" />
            ) : null}
            <div
              ref={actionsRef}
              className="ws-dialog-actions"
              data-bar={bar}
              data-layout={column ? "column" : "row"}
            >
              {primaryFirst.map((a) => {
                const loading = busy && a === main;
                const inactive = !loading && (busy || Boolean(a.disabled));
                return (
                  <ActionButton
                    key={a.label}
                    action={a}
                    loading={loading}
                    inactive={inactive}
                    reason={inactive ? note : undefined}
                    reasonId={noteId}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </PortalRootContext.Provider>
    </dialog>,
    document.body,
  );
}

/**
 * One button of the action bar. Inactive: it keeps its focus place (`aria-disabled`), presses, Enter and Space do
 * nothing, it is described by the reason line above the buttons, and hover or focus shows the same reason in a
 * tooltip (CMP-21 «Перевірка полів…», AC18).
 */
function ActionButton({
  action,
  loading,
  inactive,
  reason,
  reasonId,
}: {
  action: DialogAction;
  loading: boolean;
  inactive: boolean;
  reason: string | undefined;
  reasonId: string;
}) {
  const variant = action.variant ?? "secondary";
  const { triggerProps, tooltip } = useTooltip(reason ?? "", Boolean(reason));
  return (
    <>
      <button
        ref={triggerProps?.ref}
        type="button"
        className={`ws-button ws-dialog-action${variant === "primary" ? " ws-button-primary" : ""}`}
        data-variant={variant}
        aria-disabled={inactive || undefined}
        aria-busy={loading || undefined}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => {
          if (!inactive && !loading) action.onClick();
        }}
        onMouseEnter={triggerProps?.onMouseEnter}
        onMouseLeave={triggerProps?.onMouseLeave}
        onFocus={triggerProps?.onFocus}
        onBlur={triggerProps?.onBlur}
        onMouseDown={triggerProps?.onMouseDown}
      >
        <span className="ws-dialog-action-label">
          {loading && action.busyLabel ? action.busyLabel : action.label}
        </span>
      </button>
      {tooltip}
    </>
  );
}
