import { describe, expect, it } from "vitest";
import { journaledStore } from "./journal.ts";
import type { SignInEvent } from "../domain/index.ts";
import type { EndedSession, IdentityStore, IdentityTx, SignInJournal } from "./ports.ts";

/**
 * ACC-04@PoC business rules (PR 221 follow-up, #225): the sign-in journal gets one entry per session a transaction
 * ended, after the commit. One entry that cannot be written does not lose the others; the failure is still raised.
 */
const ended = (n: number): EndedSession => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  accountId: "00000000-0000-4000-8000-0000000000a1",
  reason: "signed-out",
});

function storeEnding(sessions: readonly EndedSession[], log: string[]): IdentityStore {
  const tx = { endSessions: async () => sessions } as unknown as IdentityTx;
  return {
    transaction: async (work) => {
      const result = await work(tx);
      log.push("commit");
      return result;
    },
  };
}

describe("journaledStore: the entries of the sessions a transaction ended", () => {
  it("writes one entry per ended session, after the commit, and returns the work's result", async () => {
    const log: string[] = [];
    const journal: SignInJournal = {
      record: async (event: SignInEvent) => {
        log.push(event.kind === "session-ended" ? `entry:${event.sessionId.slice(-1)}` : event.kind);
      },
    };
    const store = journaledStore(storeEnding([ended(1), ended(2)], log), journal);
    const result = await store.transaction(async (tx) => (await tx.endSessions("a", 0, "signed-out")).length);
    expect(result).toBe(2);
    expect(log).toEqual(["commit", "entry:1", "entry:2"]);
  });

  it("an entry that fails does not lose the others: every one is tried, then the first failure is raised", async () => {
    const log: string[] = [];
    const journal: SignInJournal = {
      record: async (event: SignInEvent) => {
        const n = event.kind === "session-ended" ? event.sessionId.slice(-1) : "?";
        log.push(`try:${n}`);
        if (n === "1") throw new Error("journal down");
      },
    };
    const store = journaledStore(storeEnding([ended(1), ended(2), ended(3)], log), journal);
    await expect(store.transaction((tx) => tx.endSessions("a", 0, "signed-out"))).rejects.toThrow(
      "journal down",
    );
    expect(log).toEqual(["commit", "try:1", "try:2", "try:3"]);
  });
});
