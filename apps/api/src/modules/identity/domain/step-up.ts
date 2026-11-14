/**
 * Step-up (NFR-01@PoC FR 13; NFR-15@PoC FR 4): the current password typed right before a sensitive action. In this
 * release it is the only kind (no code by email, no passkey) and the password change is the only action. A
 * confirmation works once, for the session and the action it was given for, for 5 minutes.
 */
export const STEP_UP_TTL_MS = 5 * 60_000;

/** The actions that need step-up (ACC-05 FR 5). A confirmation names exactly one of them. */
export const STEP_UP_ACTIONS = ["password-change"] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export interface StepUpConfirmation {
  readonly sessionId: string;
  readonly action: StepUpAction;
  readonly expiresAt: number;
  readonly usedAt: number | null;
}

/** May the confirmation authorise `use.action` in `use.sessionId` at `use.now`? Used, another session or action, or 5 min old → no. */
export function stepUpUsable(
  confirmation: StepUpConfirmation,
  use: { readonly sessionId: string; readonly action: StepUpAction; readonly now: number },
): boolean {
  return (
    confirmation.usedAt === null &&
    confirmation.sessionId === use.sessionId &&
    confirmation.action === use.action &&
    use.now < confirmation.expiresAt
  );
}
