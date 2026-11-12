import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { startRegistration } from "./registration.ts";
import { fakeApi, plain, problem, renderAt, resetAuthState, SUPPORT_ID, TOKEN } from "./testing.tsx";

/** ACC-01@PoC S-002 «Перевірте пошту» (canvas PocCheckEmail): AC4, AC23, FR 13, FR 15. */
const resendButton = () => screen.getByRole("button", { name: /^Надіслати ще раз/ });
const liveRegion = () =>
  document.querySelector<HTMLElement>('[role="status"][aria-live="polite"].ws-visually-hidden')!;
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function signedUp(resendAfterS = 60) {
  startRegistration({
    name: "Олена Коваль",
    email: "olena@example.com",
    token: TOKEN,
    resendAt: Date.now() + resendAfterS * 1000,
  });
}

beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});
afterEach(() => vi.useRealTimers());

describe("ACC-01@PoC S-002 check your email", () => {
  it("shows the address; «Змінити email» and «Увійти» are there", () => {
    signedUp();
    renderAt("#/signup/check-email", fakeApi({}).client);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Перевірте пошту");
    expect(plain(screen.getByText(/Ми надіслали посилання/).textContent)).toBe(
      "Ми надіслали посилання для підтвердження на olena@example.com. Відкрийте його протягом 24 годин — після підтвердження можна буде увійти.",
    );
    expect(screen.getByRole("button", { name: "Змінити email" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Увійти" }).getAttribute("href")).toBe("#/login");
  });

  it("AC4: within 60 s of the letter «Надіслати ще раз» is inactive with a countdown, then active", () => {
    signedUp(60);
    const { client, calls } = fakeApi({});
    renderAt("#/signup/check-email", client);
    expect(resendButton().getAttribute("aria-disabled")).toBe("true");
    expect(resendButton().textContent).toBe("Надіслати ще раз · 1:00");
    // The wait is announced once, politely — not every second.
    expect(plain(liveRegion().textContent)).toBe("Надіслати ще раз можна буде через 1:00");
    tick(18_000);
    expect(resendButton().textContent).toBe("Надіслати ще раз · 0:42");
    expect(plain(liveRegion().textContent)).toBe("Надіслати ще раз можна буде через 1:00");
    fireEvent.click(resendButton());
    expect(calls).toEqual([]);
    tick(42_000);
    expect(resendButton().getAttribute("aria-disabled")).toBeNull();
    expect(resendButton().textContent).toBe("Надіслати ще раз");
    expect(liveRegion().textContent).toBe("Можна надіслати лист ще раз");
  });

  it("FR 15: «Надіслати ще раз» sends this sign-up's letter again and restarts the countdown", async () => {
    signedUp(0);
    const { client, calls } = fakeApi({
      "POST /v1/registrations/resend": { status: 200, body: { status: "sent", resendAfterS: 60 } },
    });
    renderAt("#/signup/check-email", client);
    expect(resendButton().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(resendButton());
    await waitFor(() => expect(screen.getByText("Лист надіслано ще раз")).toBeTruthy());
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/registrations/resend",
        origin: window.location.origin,
        body: { registrationToken: TOKEN },
      },
    ]);
    expect(resendButton().textContent).toBe("Надіслати ще раз · 1:00");
    expect(resendButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("AC4: after 5 letters in an hour the button stays inactive until the hour ends (Retry-After)", async () => {
    signedUp(0);
    const { client } = fakeApi({
      "POST /v1/registrations/resend": problem(429, "RATE_LIMITED", { "retry-after": "3000" }),
    });
    renderAt("#/signup/check-email", client);
    fireEvent.click(resendButton());
    await waitFor(() => expect(resendButton().textContent).toBe("Надіслати ще раз · 50:00"));
    expect(resendButton().getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    tick(3_000_000);
    expect(resendButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("Network error on «Надіслати ще раз»: the message, the button usable again", async () => {
    signedUp(0);
    const { client } = fakeApi({ "POST /v1/registrations/resend": "network" });
    renderAt("#/signup/check-email", client);
    fireEvent.click(resendButton());
    expect(plain((await screen.findByRole("alert")).textContent)).toContain(
      "Не вдалося з’єднатися. Спробуйте ще раз",
    );
    expect(resendButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("AC23, FR 13: «Змінити email» closes this sign-up and returns to the form with the fields filled in", async () => {
    signedUp();
    const { client, calls } = fakeApi({
      "POST /v1/registrations/change-email": { status: 200, body: { status: "closed" } },
    });
    renderAt("#/signup/check-email", client);
    fireEvent.click(screen.getByRole("button", { name: "Змінити email" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Створити акаунт"),
    );
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v1/registrations/change-email",
        origin: window.location.origin,
        body: { registrationToken: TOKEN },
      },
    ]);
    expect((screen.getByRole("textbox", { name: /^Ім’я/ }) as HTMLInputElement).value).toBe("Олена Коваль");
    expect((screen.getByRole("textbox", { name: /^Email/ }) as HTMLInputElement).value).toBe(
      "olena@example.com",
    );
    expect((screen.getByLabelText(/^Пароль/, { selector: "input" }) as HTMLInputElement).value).toBe("");
  });

  it("«Змінити email» with a sign-up the server no longer knows still returns to the form", async () => {
    signedUp();
    const { client } = fakeApi({ "POST /v1/registrations/change-email": problem(404, "NOT_FOUND") });
    renderAt("#/signup/check-email", client);
    fireEvent.click(screen.getByRole("button", { name: "Змінити email" }));
    await waitFor(() => expect(window.location.hash).toBe("#/signup"));
  });

  it("A failed «Змінити email» (server error) stays on the screen with the message and the code", async () => {
    signedUp();
    const { client } = fakeApi({ "POST /v1/registrations/change-email": problem(500, "INTERNAL") });
    renderAt("#/signup/check-email", client);
    fireEvent.click(screen.getByRole("button", { name: "Змінити email" }));
    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain(`Код: ${SUPPORT_ID}`);
    expect(window.location.hash).toBe("#/signup/check-email");
  });

  it("without a sign-up in progress (reload, direct link) it opens the sign-up form", async () => {
    renderAt("#/signup/check-email", fakeApi({}).client);
    await waitFor(() => expect(window.location.hash).toBe("#/signup"));
  });
});
