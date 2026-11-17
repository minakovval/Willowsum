import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { createAuthClient } from "../auth/api.ts";
import { plain, renderAt, resetAuthState, SUPPORT_ID, type Reply } from "../auth/testing.tsx";
import { numberProblem, parseRate } from "./newAccount.ts";

/**
 * FIN-01@PoC c2) — S-052 «Новий рахунок» on the CMP-21 b) form dialog over S-050 (canvas PocMoneyNewAcc,
 * PocMoneyNewAccStep3, PocMoneyNewAccLoan and PocMoneyNewAccTexts), on `POST /v1/accounts`, the NBU directory
 * `GET /v1/accounts/banks` and `POST /v1/accounts/duplicate-check`. Synthetic accounts and banks only.
 */
const FORM = "#/money/accounts/new";
const NEW_ID = "00000000-0000-4000-8000-000000000101";
const EXISTING_ID = "00000000-0000-4000-8000-000000000202";
const BANKS = [
  { code: "305299", name: "ПриватБанк", country: "UA" },
  { code: "300465", name: "Ощадбанк", country: "UA" },
  { code: "322001", name: "Універсал Банк", country: "UA" },
];

interface Sent {
  method: string;
  path: string;
  body: unknown;
  key: string | null;
}

type Handler = Reply | ((call: Sent) => Reply | Promise<Reply>);

function api(over: Record<string, Handler> = {}) {
  const sent: Sent[] = [];
  const handlers: Record<string, Handler> = {
    "GET /v1/accounts": { status: 200, body: { items: [], nextCursor: null } },
    "GET /v1/accounts/banks": {
      status: 200,
      body: {
        items: BANKS,
        nextCursor: null,
        source: {
          attribution: "Джерело: Національний банк України (bank.gov.ua)",
          url: "https://bank.gov.ua",
          asOf: "2026-11-16",
        },
      },
    },
    "POST /v1/accounts/duplicate-check": { status: 200, body: { duplicate: null } },
    "POST /v1/accounts": { status: 201, body: { id: NEW_ID } },
    ...over,
  };
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call: Sent = {
      method: request.method,
      path: url.pathname,
      body: text ? (JSON.parse(text) as unknown) : undefined,
      key: request.headers.get("Idempotency-Key"),
    };
    sent.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    const reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply === undefined) return new Response(null, { status: 599 });
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return {
    client: createAuthClient(fetchImpl as typeof fetch),
    sent,
    creates: () => sent.filter((c) => c.method === "POST" && c.path === "/v1/accounts"),
  };
}

/** «Назва*», not «Назва установи*». */
const NAME = /^Назва(?! установи)/;
/** The reason line above the bar of an inactive «Додати рахунок». */
const reason = () => plain(dialog().querySelector(".ws-dialog-note")?.textContent);
const dialog = () => screen.getByRole("dialog", { name: "Новий рахунок" });
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const disabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled;
/** The step shown now: the others are inert. */
const shown = () => dialog().querySelector<HTMLElement>(".ws-form-step:not([inert])")!;
const field = (name: RegExp) => within(shown()).getByRole("textbox", { name });

async function open(client: ReturnType<typeof api>["client"], hash = FORM) {
  renderAt(hash, client);
  await screen.findByRole("dialog", { name: "Новий рахунок" });
}

async function chooseBank(search: string, bank: string) {
  fireEvent.click(within(shown()).getByRole("button", { name: /Банк або установа/ }));
  fireEvent.change(within(shown()).getByRole("combobox", { name: "Знайдіть банк за назвою" }), {
    target: { value: search },
  });
  fireEvent.click(await within(shown()).findByRole("option", { name: bank }));
}

/** «Валюта*» is the list «з пошуком» (more than 8 currencies, CMP-03): open, search the code, choose it. */
function chooseCurrency(code: string, at: HTMLElement = shown()) {
  fireEvent.click(within(at).getAllByRole("button", { name: /^Валюта/ })[0]!);
  fireEvent.change(within(at).getByRole("combobox", { name: "Пошук" }), { target: { value: code } });
  fireEvent.click(within(within(at).getByRole("listbox")).getByRole("option", { name: code }));
}

/** Steps 1 and 2 of «Поточний»: the name, the balance and the currency («На дату» is today by default). */
async function fillBasics(name = "Поточний monobank", amount = "1200", currency = "EUR") {
  fireEvent.change(field(NAME), { target: { value: name } });
  fireEvent.click(button("Далі"));
  await waitFor(() => expect(shown().dataset["step"]).toBe("1"));
  fireEvent.change(field(/^Залишок/), { target: { value: amount } });
  chooseCurrency(currency);
}

beforeEach(() => {
  resetAuthState();
  installMatchMedia();
});

describe("FIN-01@PoC S-052 «Новий рахунок»", () => {
  it("FIN-01@PoC FR 3: three steps «1 Основне · 2 Залишок · 3 Додатково», one hint «Поля з * обов’язкові.», «Далі» only once the step is valid, «Назад» keeps the values", async () => {
    await open(api().client);
    const steps = within(dialog()).getByRole("list", { name: "Кроки форми" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => plain(li.textContent)),
    ).toEqual([
      "1ОсновнеКрок 1: Основне — поточний",
      "2ЗалишокКрок 2: Залишок — ще недоступний",
      "3ДодатковоКрок 3: Додатково — ще недоступний",
    ]);
    expect(plain(shown().querySelector(".ws-form-hint")?.textContent)).toBe("Поля з * обов’язкові.");
    expect(within(shown()).getByRole("combobox", { name: /^Тип рахунку/ })).toBeTruthy();
    expect(field(NAME).getAttribute("placeholder")).toBe("Наприклад: Поточний monobank");
    expect(within(shown()).getByRole("button", { name: /Банк або установа/ })).toBeTruthy();
    // The bar of step 1: «Скасувати», «Далі», «Додати рахунок»; no «Назад».
    expect(within(dialog()).queryByRole("button", { name: "Назад" })).toBeNull();
    expect(disabled(button("Далі"))).toBe(true);
    fireEvent.change(field(NAME), { target: { value: "Щоденний" } });
    expect(disabled(button("Далі"))).toBe(false);
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("1"));
    expect(within(shown()).getByRole("button", { name: /^На дату/ })).toBeTruthy();
    fireEvent.click(button("Назад"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("0"));
    expect((field(NAME) as HTMLInputElement).value).toBe("Щоденний");
  });

  it("FIN-01@PoC FR 1: the types in order with «Поточний» by default, each with its one-line description under the field", async () => {
    await open(api().client);
    const type = within(shown()).getByRole("combobox", { name: /^Тип рахунку/ }) as HTMLSelectElement;
    expect([...type.options].filter((o) => o.value).map((o) => o.textContent)).toEqual([
      "Поточний",
      "Ощадний",
      "Депозит",
      "Готівка",
      "Кредитна картка",
      "Кредит",
    ]);
    expect(type.value).toBe("current");
    const hint = () =>
      plain(document.getElementById(type.getAttribute("aria-describedby")!.split(" ")[0]!)?.textContent);
    expect(hint()).toBe("картка або рахунок для щоденних витрат · від типу залежать поля кроку «Додатково»");
    fireEvent.change(type, { target: { value: "loan" } });
    expect(hint()).toBe(
      "іпотека, споживчий кредит, автокредит, кредитна лінія або позика · від типу залежать поля кроку «Додатково»",
    );
  });

  it("FIN-01@PoC AC2, FR 5: without a name or a currency «Додати рахунок» is inactive, says what to fill and creates nothing", async () => {
    const fake = api();
    await open(fake.client);
    const submit = button("Додати рахунок");
    expect(disabled(submit)).toBe(true);
    expect(reason()).toBe("Щоб додати рахунок, заповніть: Назва, Залишок (крок 2), Валюта (крок 2)");
    await fillBasics();
    expect(disabled(button("Додати рахунок"))).toBe(false);
    // The currency is required: back to «Оберіть…» is not possible in the list, so a new form without it.
    fireEvent.click(button("Назад"));
    fireEvent.change(field(NAME), { target: { value: " " } });
    expect(disabled(button("Додати рахунок"))).toBe(true);
    fireEvent.click(button("Додати рахунок"));
    expect(fake.creates()).toHaveLength(0);
  });

  it("FIN-01@PoC FR 5: empty and invalid fields together — the S-052 text «Щоб додати рахунок, заповніть: …; виправте: …»", async () => {
    await open(api().client);
    fireEvent.change(field(NAME), { target: { value: "x".repeat(81) } });
    expect(reason()).toBe(
      "Щоб додати рахунок, заповніть: Залишок (крок 2), Валюта (крок 2); виправте: Назва",
    );
    fireEvent.blur(field(NAME));
    expect(plain(within(shown()).getByText(/Назва довша за 80 символів\./).textContent)).toBe(
      "Помилка. Назва довша за 80 символів.",
    );
  });

  it("FIN-01@PoC AC1, AC22, FR 4: «Приват» finds «ПриватБанк» in the NBU directory; the account is created with that bank, «Україна», the balance on the date — one request", async () => {
    const fake = api();
    await open(fake.client);
    expect(within(shown()).getByText("Джерело: Національний банк України (bank.gov.ua)")).toBeTruthy();
    await chooseBank("Приват", "ПриватБанк");
    await fillBasics("Зарплатна", "1500,50", "UAH");
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(1));
    const body = fake.creates()[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "current",
      name: "Зарплатна",
      institution: { name: "ПриватБанк", country: "UA" },
      balance: { amount: "1500.50", currency: "UAH" },
    });
    expect(body["balanceDate"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // FR 6, AC17: no owners in the request; the server records the Owner with 100 %.
    expect(Object.keys(body)).not.toContain("owners");
    await waitFor(() => expect(window.location.hash).toBe("#/money/accounts"));
  });

  it("FIN-01@PoC AC22, FR 4: «Інша установа» takes a typed name and a country (Revolut, Литва); the directory is not changed", async () => {
    const fake = api();
    await open(fake.client);
    fireEvent.click(within(shown()).getByRole("button", { name: /Банк або установа/ }));
    fireEvent.click(within(shown()).getByRole("option", { name: "Інша установа" }));
    fireEvent.change(field(/^Назва установи/), { target: { value: "Revolut" } });
    fireEvent.click(within(shown()).getByRole("button", { name: /^Країна/ }));
    fireEvent.change(within(shown()).getByRole("combobox", { name: "Пошук" }), { target: { value: "Литв" } });
    fireEvent.click(within(shown()).getByRole("option", { name: "Литва" }));
    await fillBasics("Revolut EUR");
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(1));
    expect((fake.creates()[0]!.body as Record<string, unknown>)["institution"]).toEqual({
      name: "Revolut",
      country: "LT",
    });
    expect(fake.sent.filter((c) => c.path === "/v1/accounts/banks").every((c) => c.method === "GET")).toBe(
      true,
    );
  });

  it("FIN-01@PoC FR 4: «Обрати банк з довідника» («✕» beside «Інша установа») brings the directory back and clears the typed name", async () => {
    await open(api().client);
    fireEvent.click(within(shown()).getByRole("button", { name: /Банк або установа/ }));
    fireEvent.click(within(shown()).getByRole("option", { name: "Інша установа" }));
    fireEvent.change(field(/^Назва установи/), { target: { value: "Revolut" } });
    expect(within(shown()).queryByRole("button", { name: /Банк або установа/ })).toBeNull();
    fireEvent.click(within(shown()).getByRole("button", { name: "Обрати банк з довідника" }));
    expect(within(shown()).getByRole("button", { name: /Банк або установа/ })).toBeTruthy();
    expect(within(shown()).queryByRole("textbox", { name: /^Назва установи/ })).toBeNull();
  });

  it("FIN-01@PoC FR 4: a search without a match says «Банк не знайдено. Оберіть «Інша установа».»", async () => {
    await open(api().client);
    fireEvent.click(within(shown()).getByRole("button", { name: /Банк або установа/ }));
    fireEvent.change(within(shown()).getByRole("combobox", { name: "Знайдіть банк за назвою" }), {
      target: { value: "Zzz" },
    });
    expect(plain(within(shown()).getByRole("status").textContent)).toBe(
      "Банк не знайдено. Оберіть «Інша установа».",
    );
    expect(
      within(shown())
        .getAllByRole("option")
        .filter((o) => o.closest("[role=listbox]"))
        .map((o) => plain(o.textContent)),
    ).toEqual(["Інша установа"]);
  });

  it("FIN-01@PoC AC15, FR 25: the same bank, IBAN and currency — «Такий рахунок уже є: ПриватБанк ••1234» under the number with «Відкрити наявний»; «Додати рахунок» inactive", async () => {
    const checks: unknown[] = [];
    const fake = api({
      "POST /v1/accounts/duplicate-check": (call) => {
        checks.push(call.body);
        return {
          status: 200,
          body: { duplicate: { accountId: EXISTING_ID, institution: "ПриватБанк", maskedNumber: "••1234" } },
        };
      },
    });
    await open(fake.client);
    await chooseBank("Приват", "ПриватБанк");
    await fillBasics("Гривневий", "100", "UAH");
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("2"));
    fireEvent.change(field(/^Номер/), { target: { value: "UA21 3223 1300 0002 6007 2335 6600 1" } });
    fireEvent.change(field(/^Номер/), { target: { value: "UA213223130000026007233566001" } });
    const error = await within(shown()).findByText(/Такий рахунок уже є: ПриватБанк ••1234/);
    expect(error).toBeTruthy();
    expect(checks.at(-1)).toEqual({
      institution: { name: "ПриватБанк", country: "UA" },
      number: "UA213223130000026007233566001",
      currencies: ["UAH"],
    });
    expect(within(shown()).getByRole("link", { name: "Відкрити наявний" }).getAttribute("href")).toBe(
      `#/money/accounts/${EXISTING_ID}`,
    );
    expect(disabled(button("Додати рахунок"))).toBe(true);
    expect(reason()).toBe("Щоб продовжити, виправте: Номер · останні 4 цифри картки або IBAN");
  });

  it("FIN-01@PoC AC17, FR 6: the form has no «Власники» and no «Порівну» on any step", async () => {
    await open(api().client);
    await fillBasics();
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("2"));
    expect(within(dialog()).queryByText(/Власники/)).toBeNull();
    expect(within(dialog()).queryByText(/Порівну/)).toBeNull();
  });

  it("FIN-01@PoC FR 3, AC18: «Кредит» — «Залишок боргу*», step 3 with the required «Ставка, % річних*» and «Щомісячний платіж*»; the loan is created with them", async () => {
    const fake = api();
    await open(fake.client, `${FORM}?type=loan`);
    expect((within(shown()).getByRole("combobox", { name: /^Тип рахунку/ }) as HTMLSelectElement).value).toBe(
      "loan",
    );
    fireEvent.change(field(NAME), { target: { value: "Іпотека" } });
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("1"));
    expect(within(shown()).getByText("Сума боргу, без мінуса")).toBeTruthy();
    fireEvent.change(field(/^Залишок боргу/), { target: { value: "120000" } });
    chooseCurrency("EUR");
    expect(disabled(button("Додати рахунок"))).toBe(true);
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("2"));
    expect(plain(within(shown()).getByText(/^Поля для типу «Кредит»/).textContent)).toBe(
      "Поля для типу «Кредит» · «Іпотека», залишок боргу 120 000,00 €.",
    );
    fireEvent.change(field(/^Ставка, % річних/), { target: { value: "4,2" } });
    expect(disabled(button("Додати рахунок"))).toBe(true);
    fireEvent.change(field(/^Щомісячний платіж/), { target: { value: "650" } });
    expect(disabled(button("Додати рахунок"))).toBe(false);
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(1));
    expect(fake.creates()[0]!.body).toMatchObject({
      kind: "loan",
      name: "Іпотека",
      balance: { amount: "120000.00", currency: "EUR" },
      annualRate: "4.2",
      monthlyPayment: "650.00",
    });
  });

  it("FIN-01@PoC FR 8: «Депозит» shows «Ставка, % річних», «Дата відкриття» and «Дата закінчення» on step 3", async () => {
    await open(api().client, `${FORM}?type=deposit`);
    await fillBasics("Депозит EUR", "10000");
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("2"));
    expect(plain(within(shown()).getByText(/^Необов’язково/).textContent)).toBe(
      "Необов’язково · поля для типу «Депозит».",
    );
    expect(field(/^Ставка, % річних/)).toBeTruthy();
    expect(within(shown()).getByRole("button", { name: /^Дата відкриття/ })).toBeTruthy();
    expect(within(shown()).getByRole("button", { name: /^Дата закінчення/ })).toBeTruthy();
  });

  it("FIN-01@PoC FR 12: «+ додати ще валюту» on «Поточний» adds a currency row; the account is created with both currencies", async () => {
    const fake = api();
    await open(fake.client);
    await fillBasics("Мультивалютний", "1000", "EUR");
    fireEvent.click(button("Далі"));
    await waitFor(() => expect(shown().dataset["step"]).toBe("2"));
    fireEvent.click(within(shown()).getByRole("button", { name: "+ додати ще валюту" }));
    const row = shown().querySelector<HTMLElement>(".newacc-extra")!;
    // One more currency in the form (step 3 fits 1280 × 720); further ones on the account (FR 12).
    expect(within(shown()).queryByRole("button", { name: "+ додати ще валюту" })).toBeNull();
    chooseCurrency("EUR", row);
    expect(within(row).getByText(/Ця валюта вже є в рахунку\./)).toBeTruthy();
    chooseCurrency("UAH", row);
    fireEvent.change(within(row).getByRole("textbox", { name: /^Залишок/ }), { target: { value: "4300" } });
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(1));
    const body = fake.creates()[0]!.body as Record<string, unknown>;
    expect(body["extraCurrencies"]).toEqual([
      { amount: "4300.00", currency: "UAH", date: body["balanceDate"] },
    ]);
  });

  it("FIN-01@PoC FR 3: a full card number in «Номер» is refused before it is sent; a malformed number says what to enter", () => {
    expect(numberProblem("4417")).toBeNull();
    expect(numberProblem("4111 1111 1111 1111")).toBe("newAccount.error.number.card");
    expect(numberProblem("UA213223130000026007233566001")).toBeNull();
    expect(numberProblem("UA213223130000026007233566002")).toBe("newAccount.error.number");
    expect(numberProblem("12")).toBe("newAccount.error.number");
    expect(parseRate("4,2")).toBe("4.2");
    expect(parseRate("100")).toBe("100");
    expect(parseRate("100.01")).toBeNull();
    expect(parseRate("3.555")).toBeNull();
  });

  it("FIN-01@PoC FR 3: a retried «Додати рахунок» keeps its Idempotency-Key; a changed request takes a new one", async () => {
    let fail = true;
    const fake = api({
      "POST /v1/accounts": () =>
        fail
          ? {
              status: 500,
              body: {
                type: "about:blank",
                title: "INTERNAL",
                status: 500,
                code: "INTERNAL",
                supportId: SUPPORT_ID,
              },
              headers: { "content-type": "application/problem+json" },
            }
          : { status: 201, body: { id: NEW_ID } },
    });
    await open(fake.client);
    await fillBasics("Щоденний", "10");
    fireEvent.click(button("Додати рахунок"));
    const alert = await within(dialog()).findByText(
      "Не вдалося зберегти. Дані у формі збережено — спробуйте ще раз.",
    );
    expect(alert).toBeTruthy();
    expect(within(dialog()).getByText(`Код: ${SUPPORT_ID}`)).toBeTruthy();
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(2));
    fireEvent.change(field(/^Залишок/), { target: { value: "11" } });
    fail = false;
    fireEvent.click(button("Додати рахунок"));
    await waitFor(() => expect(fake.creates()).toHaveLength(3));
    const [a, b, c] = fake.creates().map((x) => x.key);
    expect(a).toMatch(/^[\x21-\x7e]{1,128}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("FIN-01@PoC FR 3: no connection keeps the form and says «Не вдалося з’єднатися. Спробуйте ще раз»", async () => {
    await open(api({ "POST /v1/accounts": "network" }).client);
    await fillBasics();
    fireEvent.click(button("Додати рахунок"));
    expect(await within(dialog()).findByText("Не вдалося з’єднатися. Спробуйте ще раз")).toBeTruthy();
    expect(window.location.hash).toBe(FORM);
  });

  it("FIN-01@PoC FR 3: «Скасувати» closes the form back to «Рахунки» and creates nothing", async () => {
    const fake = api();
    await open(fake.client);
    fireEvent.click(button("Скасувати"));
    await waitFor(() => expect(window.location.hash).toBe("#/money/accounts"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Новий рахунок" })).toBeNull());
    expect(fake.creates()).toHaveLength(0);
  });
});
