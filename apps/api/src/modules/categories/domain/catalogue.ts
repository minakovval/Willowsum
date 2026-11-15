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

/**
 * The tree as the requirement lists it (FR 1 order; colours of the FR 10 table). A group line: key | type | tone |
 * name. A category line, indented: key | name | colour | icon | essential or - | hint (optional). The service group
 * has no tone of the palette: the grey of «Коригування».
 */
const TREE = `
housing | expense | #5872D2 | Житло
  rent | Оренда | #144097 | key-round | essential | оренда житла
  utilities | Комунальні | #494BAB | zap | essential | електрика, газ, вода, опалення, утримання будинку
  repairs | Ремонт | #6D74D8 | hammer | - | ремонт і обслуговування житла, майстри
  home | Дім | #3968C2 | sofa | - | меблі, техніка, текстиль, декор
  household-supplies | Побутова хімія | #5F92EF | spray-can | - | засоби для прибирання, дрібні господарські товари
  garden | Сад | #959FFE | sprout | - | рослини, інструменти, догляд за ділянкою
  home-insurance | Страхування житла | #9BBEFD | shield | -
food | expense | #0E9161 | Харчування
  groceries | Продукти | #045D2F | shopping-cart | essential | супермаркети, ринки
  cafes | Кафе і ресторани | #099673 | coffee | - | кафе, ресторани, кава, бари
  food-delivery | Доставка їжі | #73CF90 | bike | -
transport | expense | #9C7305 | Транспорт і авто
  transport | Транспорт | #796000 | bus | - | громадський транспорт, таксі, каршеринг, оренда самокатів
  fuel | Пальне | #614004 | fuel | - | пальне і заряджання електромобіля
  car-service | Сервіс авто | #A9751A | wrench | - | техобслуговування, ремонт, шини, мийка
  car-insurance | Страхування авто | #B99B3C | car-front | -
  parking-roads | Паркування і дороги | #EAB361 | milestone | - | паркування, платні дороги, віньєтки
connectivity | expense | #097FCD | Зв'язок і підписки
  mobile | Зв'язок | #02537A | smartphone | essential | мобільний зв'язок
  internet | Інтернет | #3A81D7 | wifi | - | домашній інтернет і ТБ
  subscriptions | Підписки | #62C2FF | repeat | - | стримінг, програми, хмарні сервіси, членства
health | expense | #C35047 | Здоров'я і догляд
  healthcare | Здоров'я | #861025 | stethoscope | essential | лікарі, аналізи, стоматологія
  pharmacy | Аптека | #A73A1E | pill | - | ліки, медичні товари
  health-insurance | Страхування здоров'я | #FE9FA0 | shield-plus | -
  sport | Спорт | #CA545B | dumbbell | - | абонементи, спорядження
  beauty | Краса і догляд | #EC785B | scissors | - | перукарня, косметика, засоби гігієни
family-life | expense | #9B5BB6 | Родина
  education | Освіта | #843A8D | graduation-cap | essential | школа, курси, гуртки, підручники
  children | Діти | #5D2985 | baby | - | іграшки, кишенькові, догляд за дітьми
  clothing | Одяг | #8C59B8 | shirt | - | одяг і взуття
  pets | Домашні тварини | #BD89ED | paw-print | - | корм, ветеринар
  gifts | Подарунки | #B76AC0 | gift | - | подарунки іншим
  charity | Благодійність | #EB9BF5 | hand-heart | - | донати і пожертви
leisure | expense | #0F899B | Відпочинок
  entertainment | Розваги | #268EA8 | ticket | - | кіно, концерти, події, ігри
  travel | Подорожі | #05585E | plane | - | квитки, житло в поїздках, екскурсії
  hobbies | Хобі | #60CAD3 | palette | - | книги, матеріали і заняття для хобі
finance | expense | #678800 | Фінанси і податки
  taxes | Податки | #3E6C03 | receipt | - | податки і збори, крім податку з зарплати, утриманого роботодавцем
  bank-fees | Комісії банку | #707D0B | landmark | - | комісії і плата за обслуговування рахунків
  loan-interest | Відсотки за кредитами | #454D04 | percent | - | відсотки за кредитами і кредитними картками; тіло кредиту — не категорія, а погашення зобов'язання
  life-insurance | Страхування життя | #689E38 | heart-handshake | -
  fines | Штрафи | #9FB034 | gavel | -
  other-expenses | Інші витрати | #98D16C | circle-ellipsis | - | витрати, що не підходять до жодної категорії
work-income | income | #BA4E84 | Дохід від роботи
  salary | Зарплата | #7A165C | wallet | - | зарплата на руки
  bonuses | Премії | #AE3E6A | award | - | премії, бонуси, тринадцята зарплата
  business | Підприємництво | #D26AAB | store | - | дохід ФОП або власного бізнесу
  freelance | Фриланс | #FE9BBB | laptop | - | разові гонорари і підробітки
other-income | income | #BE590F | Інші доходи
  rental-income | Дохід від оренди | #874706 | building | - | оренда власного майна
  dividends-interest | Дивіденди і відсотки | #7B2901 | trending-up | - | дивіденди, відсотки за депозитами, купони
  cashback | Кешбек | #B14718 | badge-percent | -
  gifts-received | Подарунки отримані | #DF7045 | package-open | -
  social-benefits | Соціальні виплати | #BE660B | hand-coins | - | пенсії, допомоги, стипендії
  asset-sales | Продаж майна | #EE8D3C | tag | - | продаж речей і майна
  other-income | Інші надходження | #FEA382 | circle-plus | - | доходи, що не підходять до жодної категорії
service | service | #9AA3AF | Службові
  transfer | Переказ | #9DB2C8 | arrow-left-right | - | перекази між власними рахунками, погашення кредитної картки, внески в цілі
  adjustment | Коригування | #9AA3AF | scale | - | зміни залишку після звірки або ручного виправлення
`;

function parse(table: string): SystemGroup[] {
  const groups: { -readonly [K in keyof SystemGroup]: SystemGroup[K] }[] = [];
  for (const line of table.split("\n").filter((l) => l.trim() !== "")) {
    const cells = line.split(" | ").map((c) => c.trim());
    if (!line.startsWith(" ")) {
      const [key, kind, tone, name] = cells as [string, CategoryKind, string, string];
      groups.push({ key, kind, tone, name, categories: [] });
      continue;
    }
    const [key, name, color, icon, essential, hint] = cells as [
      string,
      string,
      string,
      string,
      string,
      string?,
    ];
    (groups.at(-1)!.categories as SystemCategory[]).push({
      key,
      name,
      color,
      icon,
      ...(essential === "essential" ? { essential: true as const } : {}),
      ...(hint !== undefined ? { hint } : {}),
    });
  }
  return groups;
}

export const SYSTEM_TREE: readonly SystemGroup[] = parse(TREE);

/** The keys of «Переказ» and «Коригування» (FR 1, FR 3): never hidden, never merged. */
export const SERVICE_CATEGORY_KEYS = ["transfer", "adjustment"] as const;
export type ServiceCategoryKey = (typeof SERVICE_CATEGORY_KEYS)[number];

/** Tones of new custom groups (lead decision): the expense tones in turn, the income tones in turn. */
export function customGroupTone(kind: "expense" | "income", customGroupsOfKind: number): string {
  const tones = SYSTEM_TREE.filter((g) => g.kind === kind).map((g) => g.tone);
  return tones[customGroupsOfKind % tones.length]!;
}
