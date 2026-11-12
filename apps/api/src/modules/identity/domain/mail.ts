/**
 * Letters of identity (ACC-01 FR 4, 8, 10): Ukrainian first (uk-UA), English complete. Plain text with the link in
 * full; no amounts or other data of a space. The letter about a sign-up with a taken address carries only the
 * link to password reset, never a confirmation link (ACC-01 FR 8).
 */
export const MAIL_LOCALES = ["uk", "en"] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];
export const DEFAULT_MAIL_LOCALE: MailLocale = "uk";

export interface Letter {
  readonly subject: string;
  readonly text: string;
}

/** The web app's pages the letters link to (S-003 / confirmation, S-007 password reset). */
export function confirmationLink(webOrigin: string, token: string): string {
  return `${webOrigin}/verify?token=${encodeURIComponent(token)}`;
}

export function passwordResetLink(webOrigin: string): string {
  return `${webOrigin}/password/reset`;
}

/**
 * The link of a password reset letter (S-007). The token is in the fragment: a browser never sends a fragment to
 * a server, nor in `Referer`, so the token stays out of access logs and of other sites (ADR-0009, part b).
 */
export function passwordResetTokenLink(webOrigin: string, token: string): string {
  return `${passwordResetLink(webOrigin)}#token=${encodeURIComponent(token)}`;
}

const CONFIRMATION: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Підтвердьте email для Willowsum",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Щоб завершити реєстрацію у Willowsum, підтвердьте свою адресу за посиланням:",
      link,
      "",
      "Посилання дійсне 24 години і спрацьовує один раз. Діє лише посилання з останнього листа.",
      "Якщо ви не реєструвалися — нічого не робіть: без цього посилання акаунт не буде активовано.",
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Confirm your email for Willowsum",
    text: [
      `Hello, ${name}!`,
      "",
      "To finish signing up for Willowsum, confirm your address with this link:",
      link,
      "",
      "The link is valid for 24 hours and works once. Only the link in the latest email works.",
      "If you did not sign up, do nothing: without this link the account will not be activated.",
    ].join("\n"),
  }),
};

const SIGN_UP_ATTEMPT: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Спроба реєстрації з вашою адресою у Willowsum",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Хтось спробував зареєструватися у Willowsum з цією адресою, але акаунт із нею вже є.",
      "Якщо це були ви і ви не пам'ятаєте пароль, скиньте його тут:",
      link,
      "",
      "Якщо це були не ви, нічого робити не треба: ваш акаунт не змінено.",
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Sign-up attempt with your address at Willowsum",
    text: [
      `Hello, ${name}!`,
      "",
      "Someone tried to sign up for Willowsum with this address, but an account with it already exists.",
      "If it was you and you do not remember the password, reset it here:",
      link,
      "",
      "If it was not you, there is nothing to do: your account has not changed.",
    ].join("\n"),
  }),
};

const PASSWORD_RESET: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Відновлення пароля у Willowsum",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Щоб задати новий пароль у Willowsum, перейдіть за посиланням:",
      link,
      "",
      "Посилання дійсне 60 хвилин і спрацьовує один раз; попередні посилання відновлення вже не діють.",
      "Після зміни пароля всі сесії акаунта буде завершено.",
      "Якщо ви не просили відновити пароль — нічого не робіть: пароль не зміниться.",
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Reset your Willowsum password",
    text: [
      `Hello, ${name}!`,
      "",
      "To set a new password for Willowsum, follow this link:",
      link,
      "",
      "The link is valid for 60 minutes and works once; earlier reset links no longer work.",
      "When the password changes, every session of the account ends.",
      "If you did not ask to reset your password, do nothing: it will not change.",
    ].join("\n"),
  }),
};

const PASSWORD_CHANGED: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Пароль у Willowsum змінено",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Пароль вашого акаунта у Willowsum щойно змінено через відновлення пароля. Усі сесії акаунта завершено.",
      "Якщо це були не ви, негайно відновіть пароль тут:",
      link,
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Your Willowsum password was changed",
    text: [
      `Hello, ${name}!`,
      "",
      "The password of your Willowsum account was just changed through a password reset. Every session of the account has ended.",
      "If it was not you, reset your password now:",
      link,
    ].join("\n"),
  }),
};

export function passwordResetLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return PASSWORD_RESET[locale](name, link);
}

/** The security notice after a reset (ACC-01 AC17): it carries only the link to the reset page, no token. */
export function passwordChangedLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return PASSWORD_CHANGED[locale](name, link);
}

export function confirmationLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return CONFIRMATION[locale](name, link);
}

export function signUpAttemptLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return SIGN_UP_ATTEMPT[locale](name, link);
}
