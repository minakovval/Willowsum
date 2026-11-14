/**
 * Letters of identity (ACC-01 FR 4, 8, 10): Ukrainian first (uk-UA), English complete. Plain text with the link in
 * full; no amounts or other data of a space. The letter about a sign-up with a taken address carries only the
 * link to password reset, never a confirmation link (ACC-01 FR 8).
 */
import type { DeviceBrowser, DeviceName, DeviceOs } from "./device.ts";

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

/**
 * The link of a password reset letter (S-007). The token is in the fragment (the web app routes there): a browser never sends a fragment
 * to a server, nor in `Referer`, so the token stays out of access logs and of other sites (ADR-0009, part b).
 */
export function passwordResetTokenLink(webOrigin: string, token: string): string {
  return `${passwordResetLink(webOrigin)}?token=${encodeURIComponent(token)}`;
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

const PASSWORD_CHANGED_IN_PROFILE: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Пароль у Willowsum змінено",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Пароль вашого акаунта у Willowsum щойно змінено в профілі. Усі інші сесії акаунта завершено.",
      "Якщо це були не ви, негайно відновіть пароль тут:",
      link,
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Your Willowsum password was changed",
    text: [
      `Hello, ${name}!`,
      "",
      "The password of your Willowsum account was just changed in your profile. Every other session of the account has ended.",
      "If it was not you, reset your password now:",
      link,
    ].join("\n"),
  }),
};

const STEP_UP_LOCKED: Record<MailLocale, (name: string, link: string) => Letter> = {
  uk: (name, link) => ({
    subject: "Вхід у Willowsum тимчасово заблоковано",
    text: [
      `Вітаємо, ${name}!`,
      "",
      "Під час підтвердження дії паролем у вашому акаунті Willowsum кілька разів поспіль введено неправильний пароль.",
      "Сесію завершено, а вхід заблоковано на 15 хвилин; після цього для входу знадобиться CAPTCHA.",
      "Якщо це були не ви, відновіть пароль тут:",
      link,
    ].join("\n"),
  }),
  en: (name, link) => ({
    subject: "Sign-in to Willowsum is temporarily locked",
    text: [
      `Hello, ${name}!`,
      "",
      "While an action in your Willowsum account was being confirmed with the password, a wrong password was entered several times.",
      "The session has ended and sign-in is locked for 15 minutes; after that, signing in needs a CAPTCHA.",
      "If it was not you, reset your password here:",
      link,
    ].join("\n"),
  }),
};

/** The security letter after a password change in the profile (ACC-05 FR 5, AC5): only the link to the reset page. */
export function passwordChangedInProfileLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return PASSWORD_CHANGED_IN_PROFILE[locale](name, link);
}

/**
 * The security letter when wrong step-up passwords reach the sign-in limit (NFR-01 FR 13, NFR-15 FR 4, AC2): the
 * session ended and sign-in is locked. Only the link to the reset page.
 */
export function stepUpLockedLetter(
  name: string,
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return STEP_UP_LOCKED[locale](name, link);
}

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

/** The «Це був не я» page (S-004b); the one-time token is in the fragment, as for the other links. */
export function notMeLink(webOrigin: string, token: string): string {
  return `${webOrigin}/#/not-me?token=${encodeURIComponent(token)}`;
}

const BROWSER_NAMES: Record<DeviceBrowser, Record<MailLocale, string>> = {
  chrome: { uk: "Chrome", en: "Chrome" },
  edge: { uk: "Edge", en: "Edge" },
  firefox: { uk: "Firefox", en: "Firefox" },
  safari: { uk: "Safari", en: "Safari" },
  opera: { uk: "Opera", en: "Opera" },
  other: { uk: "невідомий браузер", en: "an unknown browser" },
};

const OS_NAMES: Record<DeviceOs, Record<MailLocale, string>> = {
  windows: { uk: "Windows", en: "Windows" },
  macos: { uk: "macOS", en: "macOS" },
  ios: { uk: "iOS", en: "iOS" },
  android: { uk: "Android", en: "Android" },
  linux: { uk: "Linux", en: "Linux" },
  chromeos: { uk: "ChromeOS", en: "ChromeOS" },
  other: { uk: "невідомій системі", en: "an unknown system" },
};

/** «Chrome на Windows» / «Chrome on Windows». */
export function deviceText(device: DeviceName, locale: MailLocale = DEFAULT_MAIL_LOCALE): string {
  const on = locale === "uk" ? "на" : "on";
  return `${BROWSER_NAMES[device.browser][locale]} ${on} ${OS_NAMES[device.os][locale]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The time of a sign-in in a letter, in UTC (the account has no time zone in this release): `14.11.2026, 09:12 UTC`. */
export function letterTime(epochMs: number, locale: MailLocale = DEFAULT_MAIL_LOCALE): string {
  const d = new Date(epochMs);
  const date =
    locale === "uk"
      ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
      : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

const NEW_SIGN_IN: Record<
  MailLocale,
  (name: string, sign: { when: string; device: string }, link: string) => Letter
> = {
  uk: (name, sign, link) => ({
    subject: "Новий вхід у ваш акаунт Willowsum",
    text: [
      `Вітаємо, ${name}!`,
      "",
      `У ваш акаунт Willowsum щойно увійшли з нового пристрою чи браузера: ${sign.device}, ${sign.when}.`,
      "Якщо це були ви — нічого робити не треба.",
      "Якщо це були не ви, захистіть акаунт: ми завершимо всі сесії і надішлемо посилання для нового пароля.",
      `Це був не я: ${link}`,
      "",
      "Посилання одноразове і діє 7 днів.",
    ].join("\n"),
  }),
  en: (name, sign, link) => ({
    subject: "New sign-in to your Willowsum account",
    text: [
      `Hello, ${name}!`,
      "",
      `Someone just signed in to your Willowsum account from a new device or browser: ${sign.device}, ${sign.when}.`,
      "If it was you, there is nothing to do.",
      "If it was not you, protect the account: we will end every session and send a link for a new password.",
      `It was not me: ${link}`,
      "",
      "The link works once and is valid for 7 days.",
    ].join("\n"),
  }),
};

/** The security letter about a sign-in from a new device or browser (ACC-04 FR 4, AC6; NFR-15 FR 6). */
export function newSignInLetter(
  name: string,
  sign: { readonly at: number; readonly device: DeviceName },
  link: string,
  locale: MailLocale = DEFAULT_MAIL_LOCALE,
): Letter {
  return NEW_SIGN_IN[locale](
    name,
    { when: letterTime(sign.at, locale), device: deviceText(sign.device, locale) },
    link,
  );
}
