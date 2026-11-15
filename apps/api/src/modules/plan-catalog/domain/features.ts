/**
 * The feature catalogue (П-21): every function has a key here, and the plan matrix gives each key a value
 * for every plan. Keys are added by the requirement that introduces the function; plan names and limits
 * never appear in code (AGENTS.md «Plans»).
 */
export const FEATURES = {
  "accounts.manual":
    "Ручні рахунки: створення рахунку з початковим залишком, кредитні картки й кредити, перевірка дубля (FIN-01@PoC)",
  "household.core": "Робота з власним простором: перегляд і зміна його даних через API",
  "household.space-settings":
    "Налаштування простору: назва простору в профілі і перейменування простору Owner (ACC-08@PoC)",
  "identity.sign-in": "Реєстрація за email і паролем, підтвердження email, вхід і вихід (ACC-01)",
  "identity.profile":
    "Профіль (ім'я, email лише для читання) і зміна пароля зі step-up поточним паролем (ACC-05@PoC)",
  "transactions.manual":
    "Ручні транзакції: створення, зміна і видалення через журнал, список транзакцій з підсумками (FIN-03@PoC)",
  "transactions.states": "Стан транзакції «Очікує» і приховані транзакції (FIN-03@PoC)",
  "transactions.transfers":
    "Перекази між власними рахунками: пропозиції пар, позначка переказу, комісія і валютна різниця (FIN-03@PoC)",
  "transactions.attributes":
    "Атрибути транзакцій: розділення за категоріями і на кілька місяців (BUD-13@PoC, FIN-03@PoC)",
  "categories.tree":
    "Дерево категорій: системні групи й категорії, власні групи й категорії, перейменування, приховування, об'єднання, «обов'язкова» (BUD-01@PoC)",
} as const satisfies Record<string, string>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(key: string): key is FeatureKey {
  return Object.hasOwn(FEATURES, key);
}

/**
 * Where the plan matrix comes from. PoC has no plans or payment (00-general §0.2, П-24): every feature is
 * enabled for every space by configuration (`WS_PLAN_ENTITLEMENTS=all-enabled`). The versioned matrix
 * from SUB/ADM requirements replaces this source without changing the interface.
 */
export const ENTITLEMENT_SOURCES = ["all-enabled"] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];
