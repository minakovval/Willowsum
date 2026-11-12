import {
  emailError,
  formatCountdown,
  nameError,
  newPasswordError,
  passwordLength,
  passwordStrength,
} from "./rules.ts";
import { outcome } from "./api.ts";

/** ACC-01@PoC FR 3, AC2, AC3: the client-side checks mirror the server's; nothing else is required. */
describe("sign-up rules", () => {
  it("AC3: a password is 12–256 code points after NFKC, with no composition rules", () => {
    expect(newPasswordError("abcdefghijkl")).toBeNull();
    expect(newPasswordError("abcdefghijk")?.key).toBe("auth.error.passwordShort");
    expect(newPasswordError("")?.key).toBe("auth.error.passwordRequired");
    expect(newPasswordError("a".repeat(257))?.key).toBe("auth.error.passwordLong");
    expect(passwordLength("😀😀")).toBe(2);
    expect(passwordLength("ﬁ")).toBe(2); // NFKC: the ligature is two letters, as on the server
  });

  it("FR 3: strength by length only", () => {
    expect(passwordStrength("abc")).toBe("short");
    expect(passwordStrength("abcdefghijkl")).toBe("fair");
    expect(passwordStrength("abcdefghijklmnop")).toBe("strong");
    expect(passwordStrength("Abc1!Abc1!Ab")).toBe("fair"); // classes of characters change nothing
  });

  it("AC2: name and email", () => {
    expect(nameError("  ")?.key).toBe("auth.error.nameRequired");
    expect(nameError("x".repeat(101))?.key).toBe("auth.error.nameTooLong");
    expect(nameError("Олена")).toBeNull();
    expect(emailError("")?.key).toBe("auth.error.emailRequired");
    for (const bad of ["olena", "olena@", "@example.com", "olena@example", "o lena@example.com"])
      expect(emailError(bad)?.key).toBe("auth.error.emailInvalid");
    expect(emailError(" olena@example.com ")).toBeNull();
  });

  it("countdowns read m:ss", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(872)).toBe("14:32");
    expect(formatCountdown(0.2)).toBe("0:01");
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("answers of the API", () => {
  const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it("a failed connection is `network`, never an exception", async () => {
    expect(await outcome(Promise.reject(new TypeError("Failed to fetch")))).toEqual({
      ok: false,
      kind: "network",
    });
  });

  it("a problem keeps its code, Retry-After and supportId", async () => {
    const problem = { type: "t", title: "x", status: 429, code: "RATE_LIMITED", supportId: "f".repeat(32) };
    const o = await outcome(
      Promise.resolve({ error: problem, response: response(429, problem, { "retry-after": "60" }) }),
    );
    expect(o).toEqual({ ok: false, kind: "problem", problem, retryAfterS: 60, supportId: "f".repeat(32) });
  });

  it("a 404 that is not problem details (a proxy) reads as the hidden function", async () => {
    const o = await outcome(Promise.resolve({ error: "Not Found", response: response(404, "Not Found") }));
    expect(o.ok === false && o.kind === "problem" && o.problem.code).toBe("NOT_FOUND");
  });
});
