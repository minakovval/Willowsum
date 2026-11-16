import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface PageTab {
  id: string;
  label: string;
  href: string;
}

/**
 * The «Вкладки сторінки» variant of CMP-11@PoC (pills under the page heading, no divider line) for sub-pages that
 * have their own address: each tab is a link, so the address and the history follow the tab. `role="tablist"` and
 * `role="tab"` with `aria-selected`; ← → move to the neighbouring tab and open it, Home and End the first and the
 * last; only the selected tab is in the Tab order, and the panel follows it.
 */
export function PageTabs({
  label,
  tabs,
  selected,
  panelId,
  children,
}: {
  /** The accessible name of the tab list («Борги»). */
  label: string;
  tabs: readonly PageTab[];
  selected: string;
  /** The id of the panel (`role="tabpanel"`), named by the selected tab. */
  panelId: string;
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement | null>(null);
  const tabId = (id: string) => `${panelId}-tab-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : e.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (next === null) return;
    e.preventDefault();
    const target = list.current?.querySelectorAll<HTMLAnchorElement>('[role="tab"]')[next];
    target?.focus();
    target?.click();
  };

  return (
    <>
      <div ref={list} className="ws-page-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected;
          return (
            <a
              key={tab.id}
              id={tabId(tab.id)}
              role="tab"
              className="ws-page-tab"
              href={tab.href}
              aria-selected={isSelected}
              aria-controls={isSelected ? panelId : undefined}
              tabIndex={isSelected ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {tab.label}
            </a>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)} className="ws-page-tabpanel">
        {children}
      </div>
    </>
  );
}
