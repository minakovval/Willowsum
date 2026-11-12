/**
 * Letters of identity (ACC-01 FR 4, 8): Ukrainian first (uk-UA), English complete. Plain text with the link in
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

/**
 * The web app's pages the letters link to (S-003 / confirmation, S-007 password reset). The web app routes in the URL
 * fragment (`#/…`), and so the token travels there: a browser never sends the fragment to a server or in a Referer,
 * so the token stays out of access logs and third-party requests (review of PR #90, follow-up 3).
 */
export function confirmationLink(webOrigin: string, token: string): string {
  return `${webOrigin}/#/verify?token=${encodeURIComponent(token)}`;
}

export function passwordResetLink(webOrigin: string): string {
  return `${webOrigin}/#/password/reset`;
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
      "Посилання дійсне 24 години і спрацьовує один раз.",
      "Якщо ви не реєструвалися, просто проігноруйте цей лист.",
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
      "The link is valid for 24 hours and works once.",
      "If you did not sign up, just ignore this email.",
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
