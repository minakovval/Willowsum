import { Button } from "../button/Button.tsx";

/** One action of a state: a link when it leads to a page (`href`), a button otherwise. */
export interface StateAction {
  label: string;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  /**
   * DAT-05@PoC FR 2: the action is shown only when the user's rights allow it. `false` hides it; the text of the state
   * then explains why (the caller words it).
   */
  allowed?: boolean | undefined;
}

export const isAllowed = (action: StateAction | undefined): action is StateAction =>
  action !== undefined && action.allowed !== false;

export function StateActionButton({
  action,
  variant,
}: {
  action: StateAction;
  variant: "primary" | "secondary";
}) {
  return (
    <Button
      label={action.label}
      variant={variant}
      {...(action.href !== undefined ? { href: action.href } : {})}
      {...(action.onClick !== undefined ? { onClick: action.onClick } : {})}
    />
  );
}
