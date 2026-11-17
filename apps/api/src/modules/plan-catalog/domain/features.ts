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
  "transactions.duplicates":
    "Дублі транзакцій: «Можливий дубль», «Об'єднати», «Роз'єднати» і «Не дубль» (FIN-03@PoC)",
  "transactions.attributes":
    "Атрибути транзакцій: розділення за категоріями і на кілька місяців (BUD-13@PoC, FIN-03@PoC)",
  "transactions.review":
    "Розбір транзакцій: черга «До розбору», «Підтвердити» категорію, лічильник черги (BUD-12@PoC)",
  "transactions.history":
    "«Історія змін» транзакції: записи журналу аудиту транзакції і її категорії (FIN-03@PoC)",
  "categories.tree":
    "Дерево категорій: системні групи й категорії, власні групи й категорії, перейменування, приховування, об'єднання, «обов'язкова» (BUD-01@PoC)",
  "data.bulk_actions":
    "Масові дії зі списків: підсумок до виконання, до 500 записів, фонове виконання, «Відмінити» протягом 24 год (DAT-03@PoC)",
  "merchants.review-groups":
    "Режим «Мерчанти» черги «До розбору»: групи транзакцій за мерчантом з кількістю, сумою і запропонованою категорією (BUD-12@PoC)",
  "categorization.rules":
    "Правила категорій: умови, пріоритет, застосування до нових транзакцій і перелік наявних, що підходять (BUD-14@PoC)",
  "categorization.suggestions":
    "Підказки категорії у формі «Нова транзакція»: категорія за правилом або як раніше, «Часто для…», «Нещодавні» (FIN-03@PoC)",
  "transactions.merchants":
    "Мерчанти: нормалізація назви з опису банку, мерчант транзакції, перейменування й об'єднання мерчантів (BUD-14@PoC)",
  "recurring.payments":
    "Регулярні платежі: пропозиції з транзакцій, ручне додавання, календар, статуси списань і підписки (BUD-07@PoC)",
  "goals.savings":
    "Цілі накопичення: ціль з однією частиною, «Внести», потрібний щомісячний внесок, прогрес і темп (BUD-05@PoC)",
  "budget.period":
    "Бюджет періоду: план доходу, ліміти категорій, «Поза планом», рахунки бюджету, знімок завершеного періоду (BUD-02@PoC)",
  "debts.payoff":
    "Погашення боргів: калькулятор погашення, сценарії з додатковим і разовим платежем, стратегії Avalanche і Snowball, збережені плани, прогрес (BUD-19@PoC)",
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
