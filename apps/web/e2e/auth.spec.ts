import { expect, h1, signIn, signUp, test } from "./fixtures.ts";

/**
 * NFR-07@PoC FR 1, criterion «Веб»: the sign-up and sign-in screens that exist today (ACC-01@PoC S-001…S-004), end to
 * end in Chromium and WebKit at 1280 px — the real API process and database behind the web app's own origin.
 */
test.describe("NFR-07@PoC: sign-up and sign-in end to end", () => {
  test("ACC-01@PoC AC1, AC5, AC24: sign up, confirm by the letter's link, sign in — «Планування → Бюджет» opens", async ({
    page,
    stack,
  }) => {
    const who = stack.person();
    await signUp(page, who);
    await expect(page.getByText(who.email)).toBeVisible();
    // AC1: no session before the email is confirmed.
    expect((await page.request.get("/v1/session")).status()).toBe(401);

    const link = await stack.confirmationLink(who.email);
    await page.goto(link);
    await expect(h1(page)).toHaveText("Email підтверджено");
    // The single-use token leaves the address bar once read.
    expect(page.url()).not.toContain("token=");
    expect((await page.request.get("/v1/session")).status()).toBe(401);

    await page.getByRole("link", { name: "Увійти" }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await signIn(page, who.email, who.password);
    await expect(page).toHaveURL(/#\/planning\/budget$/);
    await expect(h1(page)).toHaveText("Бюджет");
    const session = await page.request.get("/v1/session");
    expect(session.status()).toBe(200);
    expect(await session.json()).toMatchObject({ email: who.email, name: who.name });

    // AC24: the used link again — nothing confirmed twice; with the session it opens «Бюджет».
    await page.goto(link);
    await expect(page).toHaveURL(/#\/planning\/budget$/);
  });

  test("ACC-01@PoC AC7: an unconfirmed account — «Спершу підтвердіть email», no session", async ({
    page,
    stack,
  }) => {
    const who = stack.person();
    await signUp(page, who);
    await signIn(page, who.email, who.password);
    await expect(page.getByText("Спершу підтвердіть email.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Надіслати лист ще раз/ })).toBeVisible();
    await expect(page).toHaveURL(/#\/login$/);
    expect((await page.request.get("/v1/session")).status()).toBe(401);
  });

  test("ACC-01@PoC AC13: a wrong password — the one message «Невірний email або пароль»", async ({
    page,
    stack,
  }) => {
    const who = stack.person();
    await signUp(page, who);
    await page.goto(await stack.confirmationLink(who.email));
    await expect(h1(page)).toHaveText("Email підтверджено");
    await signIn(page, who.email, `${who.password} wrong`);
    await expect(page.getByText("Невірний email або пароль")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Email/ })).toHaveValue(who.email);
    expect((await page.request.get("/v1/session")).status()).toBe(401);
  });

  test("S-003: an unknown confirmation link reads «Посилання недійсне» with the ways back", async ({
    page,
  }) => {
    await page.goto(`/#/verify?token=${"A".repeat(43)}`);
    await expect(h1(page)).toHaveText("Посилання недійсне");
    await expect(page.getByRole("link", { name: "Повернутися до входу" })).toBeVisible();
  });
});
