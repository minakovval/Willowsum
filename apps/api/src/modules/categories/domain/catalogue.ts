/**
 * The system tree of categories (BUD-01@PoC FR 1, FR 10, FR 11): 10 groups — 8 of expenses and 2 of income — and
 * the service group with «Переказ» and «Коригування». Two levels: group → category. Each category has its hint (what
 * it holds; shown as the tooltip of the category picker), its colour (a shade of its group's tone, the table of
 * FR 10), a Lucide icon and, for expenses, the default of «обов'язкова» (FR 11).
 *
 * The names here are the Ukrainian names of the product's dictionary; the client shows a system category that was
 * not renamed by its `key` in its own language (packages/i18n, BUD-01 c, wave 2 row 119). Keys are stable codes:
 * never renamed, never reused. A key added in a later release is added to every space the next time its tree is
 * read (application `ensureTree`), with no migration.
 */

export const CATEGORY_KINDS = ["expense", "income", "service"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export interface SystemCategory {
  readonly key: string;
  readonly name: string;
  /** What the category holds (FR 1, in brackets); absent where the list gives none. */
  readonly hint?: string;
  /** #RRGGBB, FR 10 table. */
  readonly color: string;
  /** A Lucide icon name (lead decision: FR 10 names the set, not the icons). */
  readonly icon: string;
  /** FR 11: on by default for six expense categories; income and service categories have no such attribute. */
  readonly essential?: true;
}

export interface SystemGroup {
  readonly key: string;
  readonly name: string;
  readonly kind: CategoryKind;
  /** The group's tone (FR 10): 8 tones of the chart palette for expenses, #BA4E84 and #BE590F for income. */
  readonly tone: string;
  readonly categories: readonly SystemCategory[];
}

export const SYSTEM_TREE: readonly SystemGroup[] = [
  {
    key: "housing",
    name: "Житло",
    kind: "expense",
    tone: "#5872D2",
    categories: [
      {
        key: "rent",
        name: "Оренда",
        hint: "оренда житла",
        color: "#144097",
        icon: "key-round",
        essential: true,
      },
      {
        key: "utilities",
        name: "Комунальні",
        hint: "електрика, газ, вода, опалення, утримання будинку",
        color: "#494BAB",
        icon: "zap",
        essential: true,
      },
      {
        key: "repairs",
        name: "Ремонт",
        hint: "ремонт і обслуговування житла, майстри",
        color: "#6D74D8",
        icon: "hammer",
      },
      { key: "home", name: "Дім", hint: "меблі, техніка, текстиль, декор", color: "#3968C2", icon: "sofa" },
      {
        key: "household-supplies",
        name: "Побутова хімія",
        hint: "засоби для прибирання, дрібні господарські товари",
        color: "#5F92EF",
        icon: "spray-can",
      },
      {
        key: "garden",
        name: "Сад",
        hint: "рослини, інструменти, догляд за ділянкою",
        color: "#959FFE",
        icon: "sprout",
      },
      { key: "home-insurance", name: "Страхування житла", color: "#9BBEFD", icon: "shield" },
    ],
  },
  {
    key: "food",
    name: "Харчування",
    kind: "expense",
    tone: "#0E9161",
    categories: [
      {
        key: "groceries",
        name: "Продукти",
        hint: "супермаркети, ринки",
        color: "#045D2F",
        icon: "shopping-cart",
        essential: true,
      },
      {
        key: "cafes",
        name: "Кафе і ресторани",
        hint: "кафе, ресторани, кава, бари",
        color: "#099673",
        icon: "coffee",
      },
      { key: "food-delivery", name: "Доставка їжі", color: "#73CF90", icon: "bike" },
    ],
  },
  {
    key: "transport",
    name: "Транспорт і авто",
    kind: "expense",
    tone: "#9C7305",
    categories: [
      {
        key: "transport",
        name: "Транспорт",
        hint: "громадський транспорт, таксі, каршеринг, оренда самокатів",
        color: "#796000",
        icon: "bus",
      },
      {
        key: "fuel",
        name: "Пальне",
        hint: "пальне і заряджання електромобіля",
        color: "#614004",
        icon: "fuel",
      },
      {
        key: "car-service",
        name: "Сервіс авто",
        hint: "техобслуговування, ремонт, шини, мийка",
        color: "#A9751A",
        icon: "wrench",
      },
      { key: "car-insurance", name: "Страхування авто", color: "#B99B3C", icon: "car-front" },
      {
        key: "parking-roads",
        name: "Паркування і дороги",
        hint: "паркування, платні дороги, віньєтки",
        color: "#EAB361",
        icon: "milestone",
      },
    ],
  },
  {
    key: "connectivity",
    name: "Зв'язок і підписки",
    kind: "expense",
    tone: "#097FCD",
    categories: [
      {
        key: "mobile",
        name: "Зв'язок",
        hint: "мобільний зв'язок",
        color: "#02537A",
        icon: "smartphone",
        essential: true,
      },
      { key: "internet", name: "Інтернет", hint: "домашній інтернет і ТБ", color: "#3A81D7", icon: "wifi" },
      {
        key: "subscriptions",
        name: "Підписки",
        hint: "стримінг, програми, хмарні сервіси, членства",
        color: "#62C2FF",
        icon: "repeat",
      },
    ],
  },
  {
    key: "health",
    name: "Здоров'я і догляд",
    kind: "expense",
    tone: "#C35047",
    categories: [
      {
        key: "healthcare",
        name: "Здоров'я",
        hint: "лікарі, аналізи, стоматологія",
        color: "#861025",
        icon: "stethoscope",
        essential: true,
      },
      { key: "pharmacy", name: "Аптека", hint: "ліки, медичні товари", color: "#A73A1E", icon: "pill" },
      { key: "health-insurance", name: "Страхування здоров'я", color: "#FE9FA0", icon: "shield-plus" },
      { key: "sport", name: "Спорт", hint: "абонементи, спорядження", color: "#CA545B", icon: "dumbbell" },
      {
        key: "beauty",
        name: "Краса і догляд",
        hint: "перукарня, косметика, засоби гігієни",
        color: "#EC785B",
        icon: "scissors",
      },
    ],
  },
  {
    key: "family-life",
    name: "Родина",
    kind: "expense",
    tone: "#9B5BB6",
    categories: [
      {
        key: "education",
        name: "Освіта",
        hint: "школа, курси, гуртки, підручники",
        color: "#843A8D",
        icon: "graduation-cap",
        essential: true,
      },
      {
        key: "children",
        name: "Діти",
        hint: "іграшки, кишенькові, догляд за дітьми",
        color: "#5D2985",
        icon: "baby",
      },
      { key: "clothing", name: "Одяг", hint: "одяг і взуття", color: "#8C59B8", icon: "shirt" },
      { key: "pets", name: "Домашні тварини", hint: "корм, ветеринар", color: "#BD89ED", icon: "paw-print" },
      { key: "gifts", name: "Подарунки", hint: "подарунки іншим", color: "#B76AC0", icon: "gift" },
      {
        key: "charity",
        name: "Благодійність",
        hint: "донати і пожертви",
        color: "#EB9BF5",
        icon: "hand-heart",
      },
    ],
  },
  {
    key: "leisure",
    name: "Відпочинок",
    kind: "expense",
    tone: "#0F899B",
    categories: [
      {
        key: "entertainment",
        name: "Розваги",
        hint: "кіно, концерти, події, ігри",
        color: "#268EA8",
        icon: "ticket",
      },
      {
        key: "travel",
        name: "Подорожі",
        hint: "квитки, житло в поїздках, екскурсії",
        color: "#05585E",
        icon: "plane",
      },
      {
        key: "hobbies",
        name: "Хобі",
        hint: "книги, матеріали і заняття для хобі",
        color: "#60CAD3",
        icon: "palette",
      },
    ],
  },
  {
    key: "finance",
    name: "Фінанси і податки",
    kind: "expense",
    tone: "#678800",
    categories: [
      {
        key: "taxes",
        name: "Податки",
        hint: "податки і збори, крім податку з зарплати, утриманого роботодавцем",
        color: "#3E6C03",
        icon: "receipt",
      },
      {
        key: "bank-fees",
        name: "Комісії банку",
        hint: "комісії і плата за обслуговування рахунків",
        color: "#707D0B",
        icon: "landmark",
      },
      {
        key: "loan-interest",
        name: "Відсотки за кредитами",
        hint: "відсотки за кредитами і кредитними картками; тіло кредиту — не категорія, а погашення зобов'язання",
        color: "#454D04",
        icon: "percent",
      },
      { key: "life-insurance", name: "Страхування життя", color: "#689E38", icon: "heart-handshake" },
      { key: "fines", name: "Штрафи", color: "#9FB034", icon: "gavel" },
      {
        key: "other-expenses",
        name: "Інші витрати",
        hint: "витрати, що не підходять до жодної категорії",
        color: "#98D16C",
        icon: "circle-ellipsis",
      },
    ],
  },
  {
    key: "work-income",
    name: "Дохід від роботи",
    kind: "income",
    tone: "#BA4E84",
    categories: [
      { key: "salary", name: "Зарплата", hint: "зарплата на руки", color: "#7A165C", icon: "wallet" },
      {
        key: "bonuses",
        name: "Премії",
        hint: "премії, бонуси, тринадцята зарплата",
        color: "#AE3E6A",
        icon: "award",
      },
      {
        key: "business",
        name: "Підприємництво",
        hint: "дохід ФОП або власного бізнесу",
        color: "#D26AAB",
        icon: "store",
      },
      {
        key: "freelance",
        name: "Фриланс",
        hint: "разові гонорари і підробітки",
        color: "#FE9BBB",
        icon: "laptop",
      },
    ],
  },
  {
    key: "other-income",
    name: "Інші доходи",
    kind: "income",
    tone: "#BE590F",
    categories: [
      {
        key: "rental-income",
        name: "Дохід від оренди",
        hint: "оренда власного майна",
        color: "#874706",
        icon: "building",
      },
      {
        key: "dividends-interest",
        name: "Дивіденди і відсотки",
        hint: "дивіденди, відсотки за депозитами, купони",
        color: "#7B2901",
        icon: "trending-up",
      },
      { key: "cashback", name: "Кешбек", color: "#B14718", icon: "badge-percent" },
      { key: "gifts-received", name: "Подарунки отримані", color: "#DF7045", icon: "package-open" },
      {
        key: "social-benefits",
        name: "Соціальні виплати",
        hint: "пенсії, допомоги, стипендії",
        color: "#BE660B",
        icon: "hand-coins",
      },
      {
        key: "asset-sales",
        name: "Продаж майна",
        hint: "продаж речей і майна",
        color: "#EE8D3C",
        icon: "tag",
      },
      {
        key: "other-income",
        name: "Інші надходження",
        hint: "доходи, що не підходять до жодної категорії",
        color: "#FEA382",
        icon: "circle-plus",
      },
    ],
  },
  {
    key: "service",
    name: "Службові",
    kind: "service",
    // No tone of the palette: the service categories are neither income nor expense (FR 1); the grey of «Коригування».
    tone: "#9AA3AF",
    categories: [
      {
        key: "transfer",
        name: "Переказ",
        hint: "перекази між власними рахунками, погашення кредитної картки, внески в цілі",
        color: "#9DB2C8",
        icon: "arrow-left-right",
      },
      {
        key: "adjustment",
        name: "Коригування",
        hint: "зміни залишку після звірки або ручного виправлення",
        color: "#9AA3AF",
        icon: "scale",
      },
    ],
  },
];

/** The keys of «Переказ» and «Коригування» (FR 1, FR 3): never hidden, never merged. */
export const SERVICE_CATEGORY_KEYS = ["transfer", "adjustment"] as const;
export type ServiceCategoryKey = (typeof SERVICE_CATEGORY_KEYS)[number];

/** Tones of new custom groups (lead decision): the expense tones in turn, the income tones in turn. */
export function customGroupTone(kind: "expense" | "income", customGroupsOfKind: number): string {
  const tones = SYSTEM_TREE.filter((g) => g.kind === kind).map((g) => g.tone);
  return tones[customGroupsOfKind % tones.length]!;
}
