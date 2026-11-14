import type { SessionEndReason } from "../domain/index.ts";
import type { EndedSession, IdentityStore, IdentityTx, SignInJournal } from "./ports.ts";

/**
 * Every session end goes to the sign-in journal (ACC-04@PoC business rules; NFR-15@PoC FR 29), whichever use case
 * ends it: the store of a request records each session its transaction ends and, once the transaction has committed,
 * writes one entry per session (with the request's address and device). A transaction that rolls back, or is run
 * again, writes nothing for its earlier attempt. A session already ended is not ended again, so it is written once.
 */
export function journaledStore(store: IdentityStore, journal: SignInJournal): IdentityStore {
  return {
    async transaction(work) {
      let ended: EndedSession[] = [];
      const result = await store.transaction((tx) => {
        ended = [];
        return work(recording(tx, ended));
      });
      for (const session of ended)
        await journal.record({
          kind: "session-ended",
          accountId: session.accountId,
          sessionId: session.id,
          reason: session.reason,
        });
      return result;
    },
  };
}

function recording(tx: IdentityTx, ended: EndedSession[]): IdentityTx {
  const keep = (sessions: readonly EndedSession[]) => {
    ended.push(...sessions);
    return sessions;
  };
  return {
    ...tx,
    endSession: async (id: string, now: number, reason: SessionEndReason) => {
      const session = await tx.endSession(id, now, reason);
      if (session) ended.push(session);
      return session;
    },
    endSessions: async (accountId, now, reason) => [...keep(await tx.endSessions(accountId, now, reason))],
    endOtherSessions: async (accountId, kept, now, reason) => [
      ...keep(await tx.endOtherSessions(accountId, kept, now, reason)),
    ],
    endLapsedSessions: async (now) => [...keep(await tx.endLapsedSessions(now))],
  };
}
