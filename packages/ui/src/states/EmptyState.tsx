import { useId } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";
import { isAllowed, StateActionButton, type StateAction } from "./StateAction.tsx";

export type StatePlacement = "block" | "area";

export interface EmptyStateProps {
  /** `area`: the whole list or page under its heading, centred; `block`: a widget or card, aligned to the start. */
  placement?: StatePlacement;
  /** What is missing («Транзакцій ще немає»). */
  title: string;
  /** Why or what to do, one or two sentences. */
  text: string;
  icon?: IconName;
  /** The one main action; `primaryVariant="secondary"` when another main action is on the screen (CMP-01 AC1). */
  primary?: StateAction;
  primaryVariant?: "primary" | "secondary";
  /** At most one more action, always secondary. There is no third. */
  secondary?: StateAction;
  /** The level of the title: 2 on a page area, 3 in a widget (the default follows `placement`). */
  headingLevel?: 1 | 2 | 3;
}

/**
 * DAT-05@PoC FR 1–2 «Порожній стан»: an explanation and the main action, the action only when the user's rights
 * allow it. The shared layout of the empty list, widget and card; the texts come from the place that shows it.
 */
export function EmptyState({
  placement = "area",
  title,
  text,
  icon,
  primary,
  primaryVariant = "primary",
  secondary,
  headingLevel,
}: EmptyStateProps) {
  const id = useId();
  const Heading = `h${headingLevel ?? (placement === "area" ? 2 : 3)}` as "h1" | "h2" | "h3";
  const actions = [
    isAllowed(primary) ? <StateActionButton key="p" action={primary} variant={primaryVariant} /> : null,
    isAllowed(secondary) ? <StateActionButton key="s" action={secondary} variant="secondary" /> : null,
  ].filter(Boolean);
  return (
    <section className="ws-state" data-state="empty" data-placement={placement} aria-labelledby={id}>
      {icon ? (
        <span className="ws-state-tile" aria-hidden="true">
          <Icon
            name={icon}
            size={placement === "area" ? 32 : 24}
            tone={placement === "area" ? "brand" : "muted"}
          />
        </span>
      ) : null}
      <Heading id={id} className="ws-state-title">
        {title}
      </Heading>
      <p className="ws-state-text">{text}</p>
      {actions.length > 0 ? <div className="ws-state-actions">{actions}</div> : null}
    </section>
  );
}
