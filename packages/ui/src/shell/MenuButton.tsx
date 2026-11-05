import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  /** A link (the app routes on the URL hash). */
  href: string;
  /** A key that picks this item while the menu is open, shown on the right (UX-09 item 14). */
  shortcut?: { code: string; label: string };
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
  className,
  ariaLabel,
  title,
  children,
}: {
  menuLabel: string;
  items: readonly MenuItem[];
  placement: "down" | "up";
  className: string;
  /** For an icon-only button. */
  ariaLabel?: string | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
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
    const links = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
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
        setOpen(false);
        window.location.href = item.href;
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
          className={`ws-menu ws-menu-${placement}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <a
                role="menuitem"
                className="ws-menu-item"
                href={item.href}
                aria-keyshortcuts={item.shortcut?.label}
                onClick={() => setOpen(false)}
              >
                <Icon name={item.icon} size={20} />
                <span className="ws-menu-label">{item.label}</span>
                {item.shortcut ? (
                  <kbd className="ws-menu-shortcut" aria-hidden="true">
                    {item.shortcut.label}
                  </kbd>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
