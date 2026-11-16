import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { installMatchMedia } from "@willowsum/ui/test-utils";
import { fakeApi, problem, renderAt, resetAuthState } from "../auth/testing.tsx";

const SPACE = { name: "Родина Коваль", dataRegion: "eu", reportingCurrency: "EUR" };
const nav = () => screen.getByRole("navigation", { name: "Основна навігація" });
beforeEach(() => {
  installMatchMedia({ width: 1280 });
  resetAuthState();
});

describe("sec probes PR359", () => {
  it("sign-in: the only POST carries credentials; space reads are body-less GETs after it", async () => {
    const { client, calls } = fakeApi({
      "POST /v1/sessions": { status: 200, body: { status: "signed-in" } },
      "GET /v1/space": { status: 200, body: SPACE },
    });
    renderAt("#/login", client);
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "pw pw pw pw" },
    });
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    expect(calls[0]!.method).toBe("POST");
    // After it: the space reads and the session keeper's read (ACC-04@PoC), all body-less GETs.
    for (const c of calls.slice(1)) {
      expect(c).toMatchObject({ method: "GET", body: undefined });
      expect(["/v1/space", "/v1/session"]).toContain(c.path);
    }
    expect(calls.filter((c) => JSON.stringify(c.body ?? "").includes("pw pw"))).toHaveLength(1);
  });

  it("markup in a name renders as text in the profile and the field", async () => {
    const evil = { ...SPACE, name: '<img src=x onerror="window.__x=1">' };
    const { client } = fakeApi({ "GET /v1/space": { status: 200, body: evil } });
    renderAt("#/settings/household", client);
    await waitFor(() => expect(within(nav()).getByText(evil.name)).toBeTruthy());
    expect(document.querySelector("img[src=x]")).toBeNull();
    expect(document.title).not.toContain("<img");
  });

  it("401 on GET: placeholder kept, page shows error, no PATCH", async () => {
    const { client, calls } = fakeApi({ "GET /v1/space": problem(401, "UNAUTHENTICATED") });
    renderAt("#/settings/household", client);
    await screen.findByRole("alert");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(screen.queryByRole("textbox", { name: /Назва простору/ })).toBeNull();
  });

  it("flag off (404): no name field, no PATCH possible", async () => {
    const { client, calls } = fakeApi({ "GET /v1/space": problem(404, "NOT_FOUND") });
    renderAt("#/settings/household", client);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /Назва простору/ })).toBeNull());
    expect(screen.queryByRole("button", { name: "Зберегти" })).toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("user switch in one tab: B's sign-in should not keep A's space name in the profile", async () => {
    let who = "A";
    const { client } = fakeApi({
      "POST /v1/sessions": () => {
        who = "B";
        return { status: 200, body: { status: "signed-in" } };
      },
      "GET /v1/space": () => ({ status: 200, body: { ...SPACE, name: `Space ${who}` } }),
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(within(nav()).getByText("Space A")).toBeTruthy());
    window.location.hash = "#/login";
    await screen.findByRole("button", { name: /^Увійти/ });
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: "b@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "pw pw pw pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/planning/budget"));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(nav()).queryByText("Space A")).toBeNull();
  });

  it("a late GET of user A's session cannot fill the store after B signed in", async () => {
    let releaseA: () => void = () => {};
    const heldA = new Promise<void>((r) => (releaseA = r));
    let gets = 0;
    const { client } = fakeApi({
      "POST /v1/sessions": { status: 200, body: { status: "signed-in" } },
      "GET /v1/space": async () => {
        gets += 1;
        if (gets === 1) {
          await heldA; // A's request, sent with A's cookie, answered after B signed in
          return { status: 200, body: { ...SPACE, name: "Space A" } };
        }
        return { status: 200, body: { ...SPACE, name: "Space B" } };
      },
    });
    renderAt("#/planning/budget", client);
    await waitFor(() => expect(gets).toBe(1));
    window.location.hash = "#/login";
    await screen.findByRole("button", { name: /^Увійти/ });
    fireEvent.change(screen.getByRole("textbox", { name: /^Email/ }), { target: { value: "b@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/, { selector: "input" }), {
      target: { value: "pw pw pw pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Увійти/ }));
    await waitFor(() => expect(within(nav()).getByText("Space B")).toBeTruthy());
    releaseA();
    await new Promise((r) => setTimeout(r, 50));
    expect(within(nav()).queryByText("Space A")).toBeNull();
    expect(within(nav()).getByText("Space B")).toBeTruthy();
  });
});
