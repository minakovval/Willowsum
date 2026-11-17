import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const ITEMS =
  "input:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [data-toolbar-item]";

/** A menu or a panel open from the toolbar (CMP-32 «Фільтри»): its controls are its own, not the toolbar's. */
const POPUP = '[role="menu"], [role="dialog"]';

/** The controls of the toolbar, in order: those inside an open menu or panel are not the toolbar's. */
function itemsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEMS)).filter((el) => !el.closest(POPUP));
}

/** In a text field ← and → move the caret; they leave the field only from its start or its end. */
function leavesField(el: HTMLElement, key: string): boolean {
  if (!(el instanceof HTMLInputElement)) return true;
  const { selectionStart: start, selectionEnd: end, value } = el;
  if (start === null || end === null) return true;
  return key === "ArrowLeft" ? start === 0 && end === 0 : start === value.length && end === value.length;
}

/**
 * CMP-60@PoC Toolbar — the quiet row of controls above a list: on the left the search and the filters (`children`),
 * on the right the quiet controls such as «Параметри» (`end`). No background and no border; one row at 1280 px.
 * `role="toolbar"` with its name («Керування списком»): Tab enters on one control (the first, or the last used),
 * ← and → move between the controls (in a text field only from its start or end), Tab leaves to the list. `status`
 * — a polite live region for the change of the number of results («Знайдено 42 транзакції»).
 */
export function ListToolbar({
  label,
  children,
  end,
  status,
  className,
}: {
  label: string;
  children: ReactNode;
  end?: ReactNode;
  status?: string | undefined;
  className?: string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(0);

  // Roving tab stop: one control of the toolbar is in the Tab order. Run after every render: controls come and go.
  useLayoutEffect(() => {
    const items = root.current ? itemsOf(root.current) : [];
    if (items.length === 0) return;
    const focused = items.indexOf(document.activeElement as HTMLElement);
    if (focused >= 0) current.current = focused;
    const at = Math.min(current.current, items.length - 1);
    items.forEach((el, i) => {
      el.tabIndex = i === at ? 0 : -1;
    });
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const target = e.target as HTMLElement;
    if (!root.current || target.closest(POPUP) || !leavesField(target, e.key)) return;
    const items = itemsOf(root.current);
    const at = items.indexOf(target);
    if (at < 0) return;
    const next = e.key === "ArrowRight" ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
    if (next === at) return;
    e.preventDefault();
    items[at]!.tabIndex = -1;
    items[next]!.tabIndex = 0;
    current.current = next;
    items[next]!.focus();
  };

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label={label}
      className={className ? `ws-toolbar ${className}` : "ws-toolbar"}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (!root.current) return;
        const at = itemsOf(root.current).indexOf(e.target as HTMLElement);
        if (at >= 0) current.current = at;
      }}
    >
      <div className="ws-toolbar-start">{children}</div>
      {end ? <div className="ws-toolbar-end">{end}</div> : null}
      <span role="status" className="ws-visually-hidden">
        {status ?? ""}
      </span>
    </div>
  );
}
