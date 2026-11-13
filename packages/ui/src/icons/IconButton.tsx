import type { MouseEvent } from "react";
import { Tooltip } from "../tooltip/Tooltip.tsx";
import { Icon, type IconName } from "./Icon.tsx";

/**
 * CMP-33@PoC «Доступність», DS-12@PoC item 6: a button that shows only an icon. Its name is required: it is the
 * accessible name (`aria-label`) and the same text is shown as the tooltip on hover and keyboard focus (CMP-25@PoC).
 * The icon is decorative and 20 px; the button keeps the 44 × 44 px target. Sizes and the remaining states of
 * the design-system IconButton (36 / 28 px, menu, loading) belong to CMP-59.
 */
export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  className,
}: {
  icon: IconName;
  /** The action as a verb or noun («Фільтр», «Закрити»): the accessible name and the tooltip. */
  label: string;
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** A toggle's state (`aria-pressed`); leave out for a plain action. */
  pressed?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className={className ? `ws-icon-button ${className}` : "ws-icon-button"}
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <Icon name={icon} size={20} inButton />
      </button>
    </Tooltip>
  );
}
