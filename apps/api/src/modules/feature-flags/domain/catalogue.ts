import { z } from "zod";

/**
 * The flag catalogue (CICD-06 FR 1–2, ARC-01 FR 7): every function has a key in the feature catalogue
 * (plan-catalog) and a flag here, under the same key, that can switch it off in production without a
 * release. Each flag names its owner and a review date.
 *
 * - `release` — a temporary flag of a new function. It ships «off»; the owner rolls it out (test spaces →
 *   a share of spaces → all). It is removed from the code no later than 30 days after full rollout: the day
 *   the rollout reached «all» is written into `fullyEnabledOn` in the PR that records it, and `check:flags`
 *   (CI) fails after 30 days.
 * - `operational` — a permanent switch of a core function (the owner may switch it off in an incident). It
 *   is never removed, but it still has an owner and a review date.
 *
 * `check:flags` fails for a flag past its review date too (the owner re-decides and moves the date).
 */
export const FLAG_KINDS = ["release", "operational"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** Days a release flag may stay fully enabled before it must be removed from the code (CICD-06 FR 2). */
export const FULL_ROLLOUT_MAX_DAYS = 30;

/**
 * The shape of a stored flag key: the CHECK on `feature_flags.flags.key` (migration 0002_flag_key_underscore.sql).
 * Keys are the plan-catalog feature keys from the requirements, dot-separated parts that may contain «-» and «_»
 * (`data.bulk_actions`). `check:flags` fails for a flag whose key the table would reject.
 */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/;
export const FLAG_KEY_MAX_LENGTH = 100;

const isoDate = z.iso.date();

export const flagDefinition = z
  .object({
    kind: z.enum(FLAG_KINDS),
    /** Who decides about the flag: a role or team name, never a person's name or email. */
    owner: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
    /** The owner reviews the flag by this day (YYYY-MM-DD, UTC). */
    reviewBy: isoDate,
    /** Release flags: the day the rollout reached «all» (YYYY-MM-DD, UTC); set in the PR that records it. */
    fullyEnabledOn: isoDate.optional(),
    /** A sub-function's flag: the flag of its function, which must be on too (as for a route's flags). */
    requires: z.string().min(1).optional(),
    description: z.string().min(1).max(300),
  })
  .strict()
  .refine((f) => f.kind === "release" || f.fullyEnabledOn === undefined, {
    message: "only release flags record fullyEnabledOn",
  });

export type FlagDefinition = z.infer<typeof flagDefinition>;

export const FLAGS = {
  "accounts.manual": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-14",
    description:
      "Ручні рахунки (FIN-01@PoC): створення рахунку з початковим залишком, картка рахунку, перевірка дубля; маршрути /v1/accounts",
  },
  "household.core": {
    kind: "operational",
    owner: "product-owner",
    reviewBy: "2027-02-04",
    description:
      "Робота з власним простором через API; вимикає всі маршрути простору з ключем household.core",
  },
  "household.space-settings": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-13",
    requires: "household.core",
    description:
      "Налаштування простору (ACC-08@PoC): назва простору для профілю і перейменування Owner; маршрути /v1/space",
  },
  "identity.sign-in": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-12",
    description:
      "Реєстрація, підтвердження email, вхід і вихід (ACC-01); до входу простору немає, тож діє лише етап «all»",
  },
  "identity.profile": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-14",
    requires: "identity.sign-in",
    description:
      "Профіль і зміна пароля зі step-up (ACC-05@PoC): /v1/profile, /v1/session/step-up; маршрути без простору, тож діє лише етап «all»",
  },
  "transactions.manual": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-14",
    requires: "accounts.manual",
    description:
      "Ручні транзакції (FIN-03@PoC a): створення, зміна і видалення через журнал, список з підсумками; маршрути /v1/transactions",
  },
  "transactions.states": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Стан «Очікує» і приховані транзакції (FIN-03@PoC b): «Статус» форми, /v1/transactions/{id}/hide і /show",
  },
  "transactions.transfers": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Перекази між власними рахунками (FIN-03@PoC b): /v1/transactions/{id}/transfer, пропозиції /v1/transfer-proposals",
  },
  "transactions.duplicates": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Дублі транзакцій (FIN-03@PoC b): «Можливий дубль» /v1/duplicate-proposals, /v1/transactions/{id}/merge і /not-duplicate",
  },
  "transactions.attributes": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Розділення транзакції (BUD-13@PoC, FIN-03@PoC b): за категоріями і на кілька місяців; /v1/transactions/{id}/split",
  },
  "transactions.review": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-16",
    requires: "transactions.manual",
    description:
      "Розбір транзакцій (BUD-12@PoC a): черга «До розбору», «Підтвердити» і «Відмінити», лічильник; /v1/transaction-review, /v1/transactions/{id}/review/confirm, /reopen, масова дія «Підтвердити категорії»",
  },
  "categories.tree": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    description:
      "Дерево категорій простору (BUD-01@PoC a): системне дерево, власні групи й категорії, перейменування, приховування, об'єднання; маршрути /v1/categories, /v1/category-groups",
  },
  "data.bulk_actions": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    description:
      "Масові дії (DAT-03@PoC a): підсумок, до 500 записів, фонове виконання, «Відмінити» 24 год; маршрути /v1/bulk-actions",
  },
  "transactions.merchants": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Мерчанти (BUD-14@PoC a): мерчант транзакції з опису банку, «Оригінальний опис», «Канал», перейменування, «Об'єднати з…», «Роз'єднати»; маршрути /v1/merchants, /v1/transactions/{id}/merchant",
  },
  "categorization.rules": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.merchants",
    description:
      "Правила категорій (BUD-14@PoC b): умови, пріоритет, «Увімкнено», «Потребує уваги», «Показати»; нові транзакції проходять правила; маршрути /v1/category-rules",
  },
  "recurring.payments": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    requires: "transactions.manual",
    description:
      "Регулярні платежі (BUD-07@PoC a): пропозиції регулярних платежів із транзакцій за 430 днів — частота, очікувана сума, наступна дата; підтвердження з правками, «Не регулярний», ручне додавання; маршрути /v1/recurring/proposals, /v1/recurring/payments",
  },
  "goals.savings": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    description:
      "Цілі накопичення (BUD-05@PoC a): ціль з однією частиною, «Внести», потрібний щомісячний внесок, прогрес, темп; маршрути /v1/goals",
  },
  "budget.period": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    description:
      "Бюджет періоду (BUD-02@PoC a): один бюджет простору, ліміти, «Поза планом», рахунки бюджету, знімок завершеного періоду; маршрути /v1/budget",
  },
  "debts.payoff": {
    kind: "release",
    owner: "product-owner",
    reviewBy: "2027-02-15",
    description:
      "Погашення боргів (BUD-19@PoC a): борги з розрахунком, сценарій з додатковим і разовим платежем, Avalanche / Snowball, збережені плани, прогрес; маршрути /v1/debts",
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;
export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.hasOwn(FLAGS, key);
}
