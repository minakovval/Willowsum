import { useId } from "react";
import { Icon } from "../icons/Icon.tsx";
import { isAllowed, StateActionButton, type StateAction } from "./StateAction.tsx";

export interface NoAccessStateProps {
  /** `page`: a closed module, one h1 (S-029); `widget`: a closed widget inside an open page. */
  scope?: "page" | "widget";
  title: string;
  text: string;
  /** «На Головну» on a page; a widget has none. */
  action?: StateAction;
  /** The title level; a page has one h1 (the default), a widget uses h3. */
  headingLevel?: 1 | 2 | 3;
}

/**
 * DAT-05@PoC FR 6, П-7 «Немає доступу» (S-029): for a module or widget the user's rights close — never for a single
 * record, a count or a sum. It carries no name, count or sum of what is closed; a record outside the user's reach is
 * «не знайдено» instead (UX-09). The texts come from the caller.
 */
export function NoAccessState({ scope = "page", title, text, action, headingLevel }: NoAccessStateProps) {
  const id = useId();
  const Heading = `h${headingLevel ?? (scope === "page" ? 1 : 3)}` as "h1" | "h2" | "h3";
  return (
    <section className="ws-state" data-state="no-access" data-scope={scope} aria-labelledby={id}>
      <span className="ws-state-tile" aria-hidden="true">
        <Icon name="lock" size={32} tone="brand" />
      </span>
      <Heading id={id} className="ws-state-title">
        {title}
      </Heading>
      <p className="ws-state-text">{text}</p>
      {isAllowed(action) ? (
        <div className="ws-state-actions">
          <StateActionButton action={action} variant="primary" />
        </div>
      ) : null}
    </section>
  );
}
