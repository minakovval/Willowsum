import { useId, type MouseEvent, type ReactNode } from "react";
import { useT } from "@willowsum/i18n";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { Tooltip } from "../tooltip/Tooltip.tsx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

interface ButtonBase {
  /** The action: a verb in sentence case, up to about 24 characters («Додати рахунок», «Видалити рахунок»). */
  label: string;
  /** `primary`: one per screen or area; `secondary`: an alternative; `quiet`: a light action; `danger`: deletes data. */
  variant?: ButtonVariant | undefined;
  /** `md` (40 px, the default, also in dialog action bars) or `sm` (32 px, table rows and banners). */
  size?: ButtonSize | undefined;
  /** An optional 16 px icon before the label (required with `iconOnly`). */
  icon?: IconName | undefined;
  /** Shows only the icon: the label becomes the accessible name and the tooltip (CMP-01 AC7). */
  iconOnly?: boolean | undefined;
  /**
   * The action is running: a spinner beside the label, the width unchanged, presses ignored, `aria-busy`, and
   * «Виконується» announced once. Pass `false` (not nothing) on a button that can be busy, so its live region
   * exists before the first announcement.
   */
  loading?: boolean | undefined;
  /** A link that looks like a button (CMP-01 «Клавіатура і екранний читач»: a link when it leads to a page). */
  href?: string | undefined;
  type?: "button" | "submit" | undefined;
  onClick?: ((e: MouseEvent<HTMLElement>) => void) | undefined;
  className?: string | undefined;
}

/** A disabled button always says why, beside it (CMP-01 «Вимкнено», DS-06 AC7). */
type Availability =
  { disabled?: false | undefined; disabledReason?: undefined } | { disabled: true; disabledReason: string };

export type ButtonProps = ButtonBase & Availability;

/**
 * CMP-01@PoC Button: starts an action. Four variants and two sizes on the `.ws-button` styles; the visible
 * height is 40 (or 32) px, the hit area at least 44 × 44 px. A disabled button keeps its place in the focus order
 * (`aria-disabled`, not `disabled`) and is described by its reason, shown beside it. Text comes from the caller.
 */
export function Button({
  label,
  variant = "secondary",
  size = "md",
  icon,
  iconOnly = false,
  loading,
  href,
  type = "button",
  onClick,
  className,
  disabled = false,
  disabledReason,
}: ButtonProps) {
  const t = useT();
  const reasonId = useId();
  const inert = disabled || loading === true;
  const classes = [
    "ws-button",
    variant !== "secondary" && `ws-button-${variant}`,
    size === "sm" && "ws-button-sm",
    icon && "ws-button-with-icon",
    iconOnly && "ws-button-icon-only",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (inert) {
      // AC4 and AC5: neither a second press while busy nor a press on a disabled button starts the action
      // (and a submit button does not submit).
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };

  const content = (
    <>
      {(icon || loading) && (
        <span className="ws-button-slot" aria-hidden="true">
          {loading ? (
            <span className="ws-spinner ws-button-spinner" />
          ) : (
            icon && <Icon name={icon} size={16} inButton />
          )}
        </span>
      )}
      {iconOnly ? null : <span className="ws-button-label">{label}</span>}
    </>
  );

  const shared = {
    className: classes,
    "aria-label": iconOnly ? label : undefined,
    "aria-disabled": disabled || undefined,
    "aria-busy": loading || undefined,
    "aria-describedby": disabled ? reasonId : undefined,
    onClick: handleClick,
  };

  const element = href ? (
    <a {...shared} href={href}>
      {content}
    </a>
  ) : (
    <button {...shared} type={type}>
      {content}
    </button>
  );
  return (
    <>
      {iconOnly ? <Tooltip text={label}>{element}</Tooltip> : element}
      {loading !== undefined && (
        // One polite status: «Виконується» when the action starts, emptied when it ends (announced once).
        <span role="status" className="ws-visually-hidden">
          {loading ? t("button.busy") : ""}
        </span>
      )}
      {disabled && (
        <span id={reasonId} className="ws-disabled-reason">
          {disabledReason}
        </span>
      )}
    </>
  );
}

/**
 * CMP-01 «Адаптивність»: buttons in a row wrap to the next line 16 px apart and never shrink; the main action
 * stands last (on the right).
 */
export function ButtonRow({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <div className={className ? `ws-button-row ${className}` : "ws-button-row"}>{children}</div>;
}

const AREA = 'main, section, form, dialog, [role="dialog"], [role="region"], header, aside';

/**
 * CMP-01 AC1: the `primary` buttons that share an area (the nearest section, form, dialog or landmark) with
 * another one. Empty when every area has at most one.
 */
export function primaryButtonViolations(root: ParentNode): Element[] {
  const byArea = new Map<Element | ParentNode, Element[]>();
  for (const el of root.querySelectorAll(".ws-button-primary")) {
    const area = el.parentElement?.closest(AREA) ?? root;
    byArea.set(area, [...(byArea.get(area) ?? []), el]);
  }
  return [...byArea.values()].filter((list) => list.length > 1).flat();
}
