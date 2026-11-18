import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  /** A link (the app routes on the URL hash). */
  href?: string;
  /** An action instead of a link: the menu closes and focus returns to the button. */
  onSelect?: () => void;
  /** An on/off option (`menuitemcheckbox`): «Параметри» → «Показати закриті» (FIN-01@PoC FR 22). */
  checked?: boolean;
  /** A key that picks this item while the menu is open, shown on the right (UX-09 item 14). */
  shortcut?: { code: string; label: string };
  /**
   * A dangerous action («Закрити рахунок», «Видалити»; CMP-61@PoC «Стани пункту»): `loss` text, after a separator.
   * The consumer puts it last.
   */
  danger?: boolean;
  /** A 1 px `line` separator before this item, between groups of actions (CMP-61@PoC «Будова»). */
  separator?: boolean;
}

/**
 * A button that opens a menu of links (UX-09 items 14, 17–18: «+ Додати», the profile menu).
 * The first item gets the focus on open; arrows move, Esc and Tab close, a click outside closes,
 * an item's shortcut key picks it.
 */
export function MenuButton({
  menuLabel,
  items,
  placement,
  align = "start",
  className,
  ariaLabel,
  title,
  note,
  children,
}: {
  menuLabel: string;
  items: readonly MenuItem[];
  /** Where the menu opens by default; it turns over when it would not be fully visible there (CMP-61@PoC AC5). */
  placement: "down" | "up";
  /** Which edge of the button the menu lines up with; `end` for a button at the right of a toolbar. */
  align?: "start" | "end";
  className: string;
  /** For an icon-only button. */
  ariaLabel?: string | undefined;
  title?: string | undefined;
  /**
   * A line of text under the items, after a separator: why an action is not there (BUD-01@PoC FR 12: «Категорію з
   * транзакціями… не можна видалити…»). It describes the menu (`aria-describedby`); it is not an item.
   */
  note?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // CMP-61@PoC AC5: the opened menu is measured before paint; it goes to the side with room, and when neither side
  // holds it, it takes the larger side and scrolls. Set on the element (no state in an effect).
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || !menu || !button) return;
    const rect = button.getBoundingClientRect();
    const height = menu.getBoundingClientRect().height;
    const gap = 4;
    const margin = 8;
    const below = window.innerHeight - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    let side = placement;
    if (placement === "down" ? height > below && above > below : height > above && below > above)
      side = placement === "down" ? "up" : "down";
    menu.classList.remove("ws-menu-up", "ws-menu-down");
    menu.classList.add(`ws-menu-${side}`);
    const room = side === "down" ? below : above;
    menu.style.maxBlockSize = height > room && room > 0 ? `${room}px` : "";
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent | MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const links = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const at = links.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      links[(at + step + links.length) % links.length]?.focus();
    } else if (!e.altKey && !e.ctrlKey && !e.metaKey) {
      const item = items.find((i) => i.shortcut?.code === e.code);
      if (item) {
        e.preventDefault();
        e.stopPropagation();
        if (item.href !== undefined) {
          setOpen(false);
          window.location.assign(item.href);
        } else close(true);
        item.onSelect?.();
      }
    }
  };

  return (
    <div className="ws-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open ? (
        <ul
          id={id}
          ref={menuRef}
          role="menu"
          aria-label={menuLabel}
          aria-describedby={note ? `${id}-note` : undefined}
          className={`ws-menu ws-menu-${placement}${align === "end" ? " ws-menu-end" : ""}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => {
            const content = (
              <>
                <Icon name={item.icon} size={16} />
                <span className="ws-menu-label">{item.label}</span>
                {item.checked ? <Icon name="check" size={16} /> : null}
                {item.shortcut ? (
                  <kbd className="ws-menu-shortcut" aria-hidden="true">
                    {item.shortcut.label}
                  </kbd>
                ) : null}
              </>
            );
            const role = item.checked === undefined ? "menuitem" : "menuitemcheckbox";
            const separator =
              item.danger || item.separator ? (
                <li role="separator" className="ws-menu-separator" key={`${item.id}-separator`} />
              ) : null;
            return [
              separator,
              <li key={item.id} role="none">
                {item.href !== undefined ? (
                  <a
                    role={role}
                    aria-checked={item.checked}
                    className="ws-menu-item"
                    data-tone={item.danger ? "danger" : undefined}
                    href={item.href}
                    aria-keyshortcuts={item.shortcut?.label}
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    type="button"
                    role={role}
                    aria-checked={item.checked}
                    className="ws-menu-item"
                    data-tone={item.danger ? "danger" : undefined}
                    aria-keyshortcuts={item.shortcut?.label}
                    onClick={() => {
                      close(true);
                      item.onSelect?.();
                    }}
                  >
                    {content}
                  </button>
                )}
              </li>,
            ];
          })}
          {note ? (
            <>
              <li role="separator" className="ws-menu-separator" />
              <li role="none" id={`${id}-note`} className="ws-menu-note">
                {note}
              </li>
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
