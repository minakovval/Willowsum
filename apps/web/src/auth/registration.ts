/**
 * The sign-up in progress, kept only in memory (never in storage): the «Перевірте пошту» screen acts on the
 * opaque token of this sign-up (ACC-01@PoC FR 13), and «Змінити email» returns to the form with the name and email
 * filled in. The password is never kept (ACC-01 «Стани інтерфейсу»: entered data except the password).
 */
export interface Registration {
  readonly name: string;
  readonly email: string;
  readonly token: string;
  /** When «Надіслати ще раз» may be used again (epoch ms), or `null`. */
  readonly resendAt: number | null;
}

export interface SignUpDraft {
  readonly name: string;
  readonly email: string;
}

let current: Registration | null = null;
let draft: SignUpDraft | null = null;

export const currentRegistration = (): Registration | null => current;
export function startRegistration(registration: Registration): void {
  current = registration;
  draft = null;
}
export function updateRegistration(patch: Partial<Registration>): void {
  if (current) current = { ...current, ...patch };
}
/** «Змінити email»: the sign-up ends and its fields go back to the form. */
export function leaveRegistration(): void {
  if (current) draft = { name: current.name, email: current.email };
  current = null;
}
/** The prefilled fields for the sign-up form after «Змінити email» (kept until the next sign-up starts). */
export const signUpDraft = (): SignUpDraft | null => draft;
export function resetRegistration(): void {
  current = null;
  draft = null;
}
