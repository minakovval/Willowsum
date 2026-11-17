import { Decimal } from "@willowsum/domain-kernel";
import { Rng } from "../random.ts";
import { addDays, addMinutes, isoDate, months, pad2, type Month } from "./calendar.ts";

/**
 * A family's money over 2–3 years (ARC-03 FR 6): 4 banks, a credit card and a loan, transfers between the
 * family's own accounts and three currencies. Everything is invented: names say «Synthetic», IBANs have the
 * check digits «00» (never valid), card numbers start with zeros. Amounts are Decimal, never floats (NFR-06).
 */
export type BankId = "monobank" | "revolut" | "bbva" | "raiffeisen-ua";
export type AccountKind = "current" | "credit_card" | "loan";
export type TransactionType = "card" | "income" | "bill" | "transfer" | "exchange" | "interest";

export interface FamilyAccount {
  readonly id: string;
  readonly bank: BankId;
  readonly kind: AccountKind;
  readonly currency: "UAH" | "EUR" | "USD";
  readonly name: string;
  readonly holder: string;
  /** Shape of the country's IBAN with check digits «00»: fails the ISO 13616 check on purpose. */
  readonly iban: string | null;
  readonly cardMask: string | null;
  readonly contract: string | null;
  readonly creditLimit: string | null;
  readonly openingBalance: string;
  readonly closingBalance: string;
}

export interface FamilyTransaction {
  readonly id: string;
  readonly account: string;
  /** Operation date and bank-local time. */
  readonly date: string;
  readonly time: string;
  /** Date the bank posted it (≥ date, same month). */
  readonly postedDate: string;
  /** Signed, in the account currency: negative leaves the account. */
  readonly amount: string;
  readonly currency: string;
  readonly balanceAfter: string;
  readonly type: TransactionType;
  readonly description: string;
  readonly mcc: string | null;
  /** A card payment in another currency: the amount and currency charged, and the rate applied. */
  readonly operationAmount: string | null;
  readonly operationCurrency: string | null;
  readonly rate: string | null;
  readonly transferId: string | null;
}

/** A card payment the bank reverted: listed in the statement (state «REVERTED»), never a transaction. */
export interface RevertedOperation {
  readonly account: string;
  readonly date: string;
  readonly time: string;
  readonly amount: string;
  readonly currency: string;
  readonly description: string;
}

export interface FamilyTransfer {
  readonly id: string;
  readonly kind: "own" | "card_repayment" | "loan_payment" | "exchange";
  readonly from: string;
  readonly to: string;
  readonly fromTransaction: string;
  readonly toTransaction: string;
  /** For an exchange: units of the target currency per unit of the source currency. */
  readonly rate: string | null;
}

export interface FamilyLedger {
  readonly household: { readonly name: string; readonly members: readonly string[] };
  readonly from: string;
  readonly to: string;
  readonly accounts: readonly FamilyAccount[];
  readonly transactions: readonly FamilyTransaction[];
  readonly reverted: readonly RevertedOperation[];
  readonly transfers: readonly FamilyTransfer[];
}

const PARENT_A = "Synthetic Parent A";
const PARENT_B = "Synthetic Parent B";

type AccountSpec = Omit<FamilyAccount, "closingBalance">;
const ACCOUNTS: readonly AccountSpec[] = [
  {
    id: "mono-black",
    bank: "monobank",
    kind: "current",
    currency: "UAH",
    name: "monobank Black (synthetic)",
    holder: PARENT_A,
    iban: "UA000000000000000000000000001",
    cardMask: "0000 00** **** 0001",
    contract: null,
    creditLimit: null,
    openingBalance: "8000.00",
  },
  {
    id: "mono-credit",
    bank: "monobank",
    kind: "credit_card",
    currency: "UAH",
    name: "monobank credit card (synthetic)",
    holder: PARENT_A,
    iban: "UA000000000000000000000000002",
    cardMask: "0000 00** **** 0002",
    contract: null,
    creditLimit: "40000.00",
    openingBalance: "0.00",
  },
  {
    id: "raif-uah",
    bank: "raiffeisen-ua",
    kind: "current",
    currency: "UAH",
    name: "Raiffeisen UA salary account (synthetic)",
    holder: PARENT_A,
    iban: "UA000000000000000000000000003",
    cardMask: "0000 00** **** 0003",
    contract: null,
    creditLimit: null,
    openingBalance: "15000.00",
  },
  {
    id: "bbva-eur",
    bank: "bbva",
    kind: "current",
    currency: "EUR",
    name: "BBVA current account (synthetic)",
    holder: PARENT_B,
    iban: "ES0000000000000000000004",
    cardMask: "0000 00** **** 0004",
    contract: null,
    creditLimit: null,
    openingBalance: "3200.00",
  },
  {
    id: "bbva-loan",
    bank: "bbva",
    kind: "loan",
    currency: "EUR",
    name: "BBVA car loan (synthetic)",
    holder: PARENT_B,
    iban: null,
    cardMask: null,
    contract: "SYNTH-LOAN-0005",
    creditLimit: null,
    openingBalance: "-18000.00",
  },
  {
    id: "revolut-eur",
    bank: "revolut",
    kind: "current",
    currency: "EUR",
    name: "Revolut EUR (synthetic)",
    holder: PARENT_B,
    iban: "LT000000000000000006",
    cardMask: "0000 00** **** 0006",
    contract: null,
    creditLimit: null,
    openingBalance: "250.00",
  },
  {
    id: "revolut-usd",
    bank: "revolut",
    kind: "current",
    currency: "USD",
    name: "Revolut USD (synthetic)",
    holder: PARENT_B,
    iban: "LT000000000000000007",
    cardMask: null,
    contract: null,
    creditLimit: null,
    openingBalance: "120.00",
  },
];

interface Merchant {
  readonly name: string;
  readonly mcc: string;
}
const UA_MERCHANTS: readonly Merchant[] = [
  { name: "Вигаданий супермаркет", mcc: "5411" },
  { name: "Синтетична аптека", mcc: "5912" },
  { name: "Тестова АЗС", mcc: "5541" },
  { name: "Вигадана кав'ярня, Київ", mcc: "5814" },
  { name: "Синтетичне таксі", mcc: "4121" },
  { name: "Тестовий магазин одягу", mcc: "5651" },
  { name: "Вигаданий ресторан «Зерно»", mcc: "5812" },
  { name: "Синтетичний мобільний оператор", mcc: "4814" },
  { name: "Їжа і ґрунт — тестова крамниця", mcc: "5499" },
];
const ABROAD_MERCHANTS: readonly Merchant[] = [
  { name: "SYNTHETIC CAFE BARCELONA", mcc: "5814" },
  { name: "FAKE MUSEUM SHOP VALENCIA", mcc: "5999" },
  { name: "EXAMPLE TRAIN TICKETS", mcc: "4112" },
];
const ES_MERCHANTS: readonly Merchant[] = [
  { name: "MERCADO SINTETICO", mcc: "5411" },
  { name: "FARMACIA FICTICIA", mcc: "5912" },
  { name: "GASOLINERA DE PRUEBA", mcc: "5541" },
  { name: "PANADERÍA INVENTADA", mcc: "5462" },
  { name: "LIBRERÍA FICTICIA, S.L.", mcc: "5942" },
];
const EN_MERCHANTS: readonly Merchant[] = [
  { name: "Synthetic Grocer", mcc: "5411" },
  { name: "Fake Coffee Co", mcc: "5814" },
  { name: "Test Transit", mcc: "4111" },
  { name: "Example Books", mcc: "5942" },
];
const USD_MERCHANTS: readonly Merchant[] = [
  { name: "Synthetic Streaming Co", mcc: "4899" },
  { name: "Example Cloud Storage", mcc: "5734" },
  { name: "Fake App Store", mcc: "5818" },
];

const ZERO = new Decimal("0");
const LOAN_ANNUAL_RATE = new Decimal("0.059");
const LOAN_INSTALMENT = new Decimal("350.00");
const RAIF_RESERVE = new Decimal("1000.00");

/** An amount between `min` and `max` minor units (cents, kopiykas), as a Decimal with 2 places. */
function minor(rng: Rng, min: number, max: number): Decimal {
  return new Decimal(String(rng.int(min, max))).dividedBy(100);
}

const fixed2 = (d: Decimal): string => d.toFixed(2);

interface Intent {
  readonly at: string;
  readonly seq: number;
  run(): void;
}

class Simulation {
  private readonly queue: Intent[] = [];
  private position = 0;
  private seq = 0;
  readonly balances = new Map<string, Decimal>();
  readonly transactions: FamilyTransaction[] = [];
  readonly reverted: RevertedOperation[] = [];
  readonly transfers: FamilyTransfer[] = [];

  private readonly accounts: ReadonlyMap<string, AccountSpec>;

  constructor(accounts: ReadonlyMap<string, AccountSpec>) {
    this.accounts = accounts;
    for (const a of accounts.values()) this.balances.set(a.id, new Decimal(a.openingBalance));
  }

  account(id: string): AccountSpec {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`No account ${id}`);
    return a;
  }

  balance(id: string): Decimal {
    return this.balances.get(id)!;
  }

  /** Queues an action at a wall-clock moment; actions run in time order (ties: in scheduling order). */
  at(at: string, run: () => void): void {
    const intent = { at, seq: this.seq++, run };
    let lo = this.position;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = this.queue[mid]!;
      if (q.at < at || (q.at === at && q.seq < intent.seq)) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, intent);
  }

  run(): void {
    for (; this.position < this.queue.length; this.position++) this.queue[this.position]!.run();
  }

  /** Can `amount` leave the account without overdrawing it (or exceeding a credit card's limit)? */
  canSpend(id: string, amount: Decimal): boolean {
    const a = this.account(id);
    const floor = a.creditLimit ? new Decimal(a.creditLimit).negated() : ZERO;
    return this.balance(id).minus(amount).gte(floor);
  }

  post(
    accountId: string,
    at: string,
    amount: Decimal,
    details: Partial<Pick<FamilyTransaction, "mcc" | "operationAmount" | "operationCurrency" | "rate" | "transferId" | "postedDate">> &
      Pick<FamilyTransaction, "type" | "description">,
  ): FamilyTransaction {
    const account = this.account(accountId);
    const balance = this.balance(accountId).plus(amount);
    this.balances.set(accountId, balance);
    const [date, time] = at.split(" ") as [string, string];
    const tx: FamilyTransaction = {
      id: `tx-${String(this.transactions.length + 1).padStart(6, "0")}`,
      account: accountId,
      date,
      time,
      postedDate: details.postedDate ?? date,
      amount: fixed2(amount),
      currency: account.currency,
      balanceAfter: fixed2(balance),
      type: details.type,
      description: details.description,
      mcc: details.mcc ?? null,
      operationAmount: details.operationAmount ?? null,
      operationCurrency: details.operationCurrency ?? null,
      rate: details.rate ?? null,
      transferId: details.transferId ?? null,
    };
    this.transactions.push(tx);
    return tx;
  }

  /**
   * Money moving between two of the family's accounts: the outgoing leg now, the incoming leg `delayMinutes`
   * later (another bank takes time). `received` defaults to `sent` (same currency).
   */
  transfer(options: {
    kind: FamilyTransfer["kind"];
    from: string;
    to: string;
    at: string;
    sent: Decimal;
    received?: Decimal;
    rate?: string;
    delayMinutes: number;
    out: Pick<FamilyTransaction, "type" | "description"> & { mcc?: string };
    in: Pick<FamilyTransaction, "type" | "description"> & { mcc?: string };
  }): void {
    const id = `tr-${String(++this.transferCount).padStart(5, "0")}`;
    const outTx = this.post(options.from, options.at, options.sent.negated(), { ...options.out, transferId: id });
    this.at(addMinutes(options.at, options.delayMinutes), () => {
      const inTx = this.post(options.to, addMinutes(options.at, options.delayMinutes), options.received ?? options.sent, {
        ...options.in,
        transferId: id,
      });
      this.transfers.push({
        id,
        kind: options.kind,
        from: options.from,
        to: options.to,
        fromTransaction: outTx.id,
        toTransaction: inTx.id,
        rate: options.rate ?? null,
      });
    });
  }
  private transferCount = 0;
}

function randomTime(rng: Rng, fromHour = 7, toHour = 22): string {
  return `${pad2(rng.int(fromHour, toHour))}:${pad2(rng.int(0, 59))}:${pad2(rng.int(0, 59))}`;
}

function at(m: Month, day: number, time: string): string {
  return `${isoDate(m.year, m.month, Math.min(day, m.days))} ${time}`;
}

function spend(
  sim: Simulation,
  rng: Rng,
  m: Month,
  account: string,
  count: number,
  merchants: readonly Merchant[],
  range: [number, number],
  options: { postingLag?: boolean; numbered?: boolean } = {},
): void {
  for (let i = 0; i < count; i++) {
    const day = rng.int(1, m.days);
    const when = at(m, day, randomTime(rng));
    const merchant = rng.pick(merchants);
    const amount = minor(rng, range[0], range[1]);
    const suffix = options.numbered ? ` ${String(rng.int(1, 40)).padStart(3, "0")}` : "";
    const lag = options.postingLag ? Math.min(rng.int(0, 2), m.days - day) : 0;
    sim.at(when, () => {
      if (!sim.canSpend(account, amount)) return;
      sim.post(account, when, amount.negated(), {
        type: "card",
        description: `${merchant.name}${suffix}`,
        mcc: merchant.mcc,
        postedDate: addDays(when.slice(0, 10), lag),
      });
    });
  }
}

/** One month of the family's life. Each stream has its own seed, so changing one never shifts another. */
function planMonth(sim: Simulation, seed: string, m: Month, index: number): void {
  const rng = (stream: string) => new Rng(`${seed}/family/${stream}/${m.key}`);

  // Raiffeisen UA: Parent A's salary, a transfer to monobank, a few card payments and bills.
  const raif = rng("raif-uah");
  const salaryA = minor(raif, 5_000_000, 5_800_000);
  sim.at(at(m, 5, "09:15:00"), () =>
    sim.post("raif-uah", at(m, 5, "09:15:00"), salaryA, {
      type: "income",
      description: "Заробітна плата від ТОВ «Синтетична компанія»",
    }),
  );
  const toMono = minor(raif, 4_000_000, 5_000_000);
  sim.at(at(m, 6, "10:05:00"), () => {
    const amount = Decimal.min(toMono, sim.balance("raif-uah").minus(RAIF_RESERVE));
    if (amount.lte(ZERO)) return;
    sim.transfer({
      kind: "own",
      from: "raif-uah",
      to: "mono-black",
      at: at(m, 6, "10:05:00"),
      sent: amount,
      delayMinutes: 2,
      out: { type: "transfer", description: "Переказ на власну картку monobank *0001" },
      in: { type: "transfer", description: "Поповнення з рахунку Райффайзен *0003", mcc: "4829" },
    });
  });
  sim.at(at(m, 18, "11:30:00"), () => {
    const bill = minor(raif, 150_000, 420_000);
    if (sim.canSpend("raif-uah", bill))
      sim.post("raif-uah", at(m, 18, "11:30:00"), bill.negated(), {
        type: "bill",
        description: "Оплата комунальних послуг (синтетичний рахунок №" + String(raif.int(100, 999)) + ")",
      });
  });
  spend(sim, raif, m, "raif-uah", raif.int(3, 8), UA_MERCHANTS, [5_000, 150_000], { postingLag: true, numbered: true });

  // monobank: everyday spending (some abroad, in EUR), the credit card, and its monthly repayment.
  const mono = rng("mono-black");
  spend(sim, mono, m, "mono-black", mono.int(25, 40), UA_MERCHANTS, [4_000, 180_000]);
  const abroad = mono.int(0, 4);
  for (let i = 0; i < abroad; i++) {
    const when = at(m, mono.int(1, m.days), randomTime(mono));
    const merchant = mono.pick(ABROAD_MERCHANTS);
    const eur = minor(mono, 300, 8_000);
    const rate = minor(mono, 3_950, 4_650); // synthetic UAH per EUR
    const uah = eur.times(rate).toDecimalPlaces(2);
    sim.at(when, () => {
      if (!sim.canSpend("mono-black", uah)) return;
      sim.post("mono-black", when, uah.negated(), {
        type: "card",
        description: merchant.name,
        mcc: merchant.mcc,
        operationAmount: fixed2(eur.negated()),
        operationCurrency: "EUR",
        rate: rate.toFixed(4),
      });
    });
  }
  const credit = rng("mono-credit");
  spend(sim, credit, m, "mono-credit", credit.int(8, 15), UA_MERCHANTS, [10_000, 250_000]);
  sim.at(at(m, 20, "12:00:00"), () => {
    const debt = sim.balance("mono-credit").negated();
    const amount = Decimal.min(debt, sim.balance("mono-black"));
    if (amount.lte(ZERO)) return;
    sim.transfer({
      kind: "card_repayment",
      from: "mono-black",
      to: "mono-credit",
      at: at(m, 20, "12:00:00"),
      sent: amount,
      delayMinutes: 0,
      out: { type: "transfer", description: "Погашення кредитної картки *0002", mcc: "4829" },
      in: { type: "transfer", description: "Погашення заборгованості з картки *0001", mcc: "4829" },
    });
  });

  // BBVA: Parent B's salary, rent and bills, card payments, the loan, and a top-up of Revolut.
  const bbva = rng("bbva-eur");
  const salaryB = minor(bbva, 260_000, 300_000);
  sim.at(at(m, 27, "08:00:00"), () =>
    sim.post("bbva-eur", at(m, 27, "08:00:00"), salaryB, { type: "income", description: "NÓMINA SYNTHETIC EMPRESA S.L." }),
  );
  const rent = minor(bbva, 85_000, 90_000);
  const power = minor(bbva, 4_000, 12_000);
  for (const [day, amount, description] of [
    [3, rent, "ALQUILER VIVIENDA SINTETICA"],
    [12, power, "RECIBO ELECTRICIDAD FICTICIA"],
    [15, new Decimal("35.90"), "RECIBO INTERNET DE PRUEBA"],
  ] as const) {
    sim.at(at(m, day, "06:30:00"), () => {
      if (sim.canSpend("bbva-eur", amount))
        sim.post("bbva-eur", at(m, day, "06:30:00"), amount.negated(), { type: "bill", description });
    });
  }
  spend(sim, bbva, m, "bbva-eur", bbva.int(12, 20), ES_MERCHANTS, [300, 9_000]);
  sim.at(at(m, 1, "06:00:00"), () => {
    const debt = sim.balance("bbva-loan").negated();
    if (debt.lte(ZERO)) return;
    const interest = debt.times(LOAN_ANNUAL_RATE).dividedBy(12).toDecimalPlaces(2);
    if (interest.gt(ZERO))
      sim.post("bbva-loan", at(m, 1, "06:00:00"), interest.negated(), {
        type: "interest",
        description: "INTERESES PRÉSTAMO",
      });
  });
  sim.at(at(m, 1, "07:00:00"), () => {
    const amount = Decimal.min(LOAN_INSTALMENT, sim.balance("bbva-loan").negated(), sim.balance("bbva-eur"));
    if (amount.lte(ZERO)) return;
    sim.transfer({
      kind: "loan_payment",
      from: "bbva-eur",
      to: "bbva-loan",
      at: at(m, 1, "07:00:00"),
      sent: amount,
      delayMinutes: 1,
      out: { type: "transfer", description: "CUOTA PRÉSTAMO SYNTH-LOAN-0005" },
      in: { type: "transfer", description: "CUOTA RECIBIDA" },
    });
  });
  const topUp = minor(bbva, 40_000, 70_000);
  sim.at(at(m, 10, "18:40:00"), () => {
    if (!sim.canSpend("bbva-eur", topUp)) return;
    sim.transfer({
      kind: "own",
      from: "bbva-eur",
      to: "revolut-eur",
      at: at(m, 10, "18:40:00"),
      sent: topUp,
      delayMinutes: 15 * 60,
      out: { type: "transfer", description: "TRANSFERENCIA A SYNTHETIC PARENT B (REVOLUT)" },
      in: { type: "transfer", description: "Top-up from BBVA *0004" },
    });
  });

  // Revolut: card payments in EUR (a few reverted), a quarterly exchange to USD, small USD subscriptions.
  const rev = rng("revolut-eur");
  const cards = rev.int(8, 15);
  for (let i = 0; i < cards; i++) {
    const when = at(m, rev.int(1, m.days), randomTime(rev));
    const merchant = rev.pick(EN_MERCHANTS);
    const amount = minor(rev, 200, 7_000);
    const reverted = rev.int(1, 20) === 1;
    sim.at(when, () => {
      if (reverted) {
        const [date, time] = when.split(" ") as [string, string];
        sim.reverted.push({ account: "revolut-eur", date, time, amount: fixed2(amount.negated()), currency: "EUR", description: merchant.name });
        return;
      }
      if (sim.canSpend("revolut-eur", amount))
        sim.post("revolut-eur", when, amount.negated(), { type: "card", description: merchant.name, mcc: merchant.mcc });
    });
  }
  if (index % 3 === 0) {
    const eur = minor(rev, 10_000, 30_000);
    const rate = minor(rev, 104, 112); // synthetic USD per EUR
    sim.at(at(m, 14, "13:13:13"), () => {
      if (!sim.canSpend("revolut-eur", eur)) return;
      sim.transfer({
        kind: "exchange",
        from: "revolut-eur",
        to: "revolut-usd",
        at: at(m, 14, "13:13:13"),
        sent: eur,
        received: eur.times(rate).toDecimalPlaces(2),
        rate: rate.toFixed(4),
        delayMinutes: 0,
        out: { type: "exchange", description: "Exchanged to USD" },
        in: { type: "exchange", description: "Exchanged from EUR" },
      });
    });
  }
  const usd = rng("revolut-usd");
  spend(sim, usd, m, "revolut-usd", usd.int(1, 4), USD_MERCHANTS, [499, 4_999]);
}

export interface FamilyOptions {
  readonly seed: string;
  /** First day of the first month, «YYYY-MM-01». */
  readonly start: string;
  /** 2 or 3 (ARC-03 FR 6: «2–3 роки»). */
  readonly years: 2 | 3;
}

export function familyLedger(options: FamilyOptions): FamilyLedger {
  if (!/^\d{4}-\d{2}-01$/.test(options.start)) throw new Error(`start must be the 1st of a month: ${options.start}`);
  if (options.years !== 2 && options.years !== 3) throw new Error("years must be 2 or 3");
  const period = months(options.start, options.years * 12);
  const last = period[period.length - 1]!;
  const to = isoDate(last.year, last.month, last.days);
  const sim = new Simulation(new Map(ACCOUNTS.map((a) => [a.id, a])));
  period.forEach((m, i) => planMonth(sim, options.seed, m, i));
  sim.run();
  for (const t of sim.transactions)
    if (t.date < options.start || t.postedDate > to) throw new Error(`${t.id} falls outside the period`);
  return {
    household: { name: "Synthetic family", members: [PARENT_A, PARENT_B] },
    from: options.start,
    to,
    accounts: ACCOUNTS.map((a) => ({ ...a, closingBalance: fixed2(sim.balance(a.id)) })),
    transactions: sim.transactions,
    reverted: sim.reverted,
    transfers: [...sim.transfers].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
