import { describe, expect, it } from "vitest";
import { journalEntry, SIGN_IN_JOURNAL_ENTITY, type JournalClient } from "./journal.ts";

const ACCOUNT = "6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d";
const SESSION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENT: JournalClient = { address: "198.51.100.77", device: { browser: "firefox", os: "linux" } };

const changes = (entry: ReturnType<typeof journalEntry>) =>
  Object.fromEntries(entry.changes.map((c) => [c.field, c.after]));

describe("ACC-04@PoC: every sign-in, failed sign-in and session end goes to the space's audit log with the IP address and the device", () => {
  it("a sign-in: by the user, through the web, under the account's sign-in journal, with the session, address and device", () => {
    const entry = journalEntry({ kind: "signed-in", accountId: ACCOUNT, sessionId: SESSION }, CLIENT);
    expect(entry).toMatchObject({
      actor: { kind: "user", id: ACCOUNT },
      channel: "web",
      entity: { type: SIGN_IN_JOURNAL_ENTITY, id: ACCOUNT },
      action: "create",
    });
    expect(changes(entry)).toEqual({
      event: "signed-in",
      session: SESSION,
      ip: "198.51.100.77",
      device: "firefox/linux",
    });
    // Nothing is masked: the address and the device are the point of the record (NFR-15 FR 29).
    expect(entry.changes.every((c) => c.sensitive === false && c.before === null)).toBe(true);
  });

  it("a failed sign-in: by nobody known (the system), with its reason, address and device", () => {
    const entry = journalEntry(
      { kind: "sign-in-failed", accountId: ACCOUNT, reason: "invalid-password" },
      CLIENT,
    );
    expect(entry.actor).toEqual({ kind: "system" });
    expect(entry.channel).toBe("web");
    expect(changes(entry)).toEqual({
      event: "sign-in-failed",
      reason: "invalid-password",
      ip: "198.51.100.77",
      device: "firefox/linux",
    });
  });

  it("a session end found by a request has that request's address and device; one the daily task ends has none", () => {
    const seen = journalEntry(
      { kind: "session-ended", accountId: ACCOUNT, sessionId: SESSION, reason: "idle" },
      CLIENT,
    );
    expect(seen.actor).toEqual({ kind: "system" });
    expect(changes(seen)).toEqual({
      event: "session-ended",
      session: SESSION,
      reason: "idle",
      ip: "198.51.100.77",
      device: "firefox/linux",
    });
    const swept = journalEntry(
      { kind: "session-ended", accountId: ACCOUNT, sessionId: SESSION, reason: "expired" },
      null,
    );
    expect(swept.channel).toBe("system");
    expect(changes(swept)).toMatchObject({ ip: null, device: null, reason: "expired" });
  });

  it("the user's own sign-out and password change are the user's; an address the server cannot read is not stored", () => {
    for (const reason of ["signed-out", "password-change"] as const)
      expect(
        journalEntry({ kind: "session-ended", accountId: ACCOUNT, sessionId: SESSION, reason }, CLIENT).actor,
      ).toEqual({ kind: "user", id: ACCOUNT });
    for (const reason of ["password-reset", "not-me", "token-reuse", "step-up-locked", "expired"] as const)
      expect(
        journalEntry({ kind: "session-ended", accountId: ACCOUNT, sessionId: SESSION, reason }, CLIENT).actor,
      ).toEqual({ kind: "system" });
    const unknown = journalEntry(
      { kind: "signed-in", accountId: ACCOUNT, sessionId: SESSION },
      { ...CLIENT, address: "unknown" },
    );
    expect(changes(unknown).ip).toBeNull();
  });
});
