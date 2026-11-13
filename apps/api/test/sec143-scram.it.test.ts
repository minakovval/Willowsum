import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scramVerifier } from "../src/platform/db/migrate.ts";
import { setupRealModules, type RealModulesDatabase } from "./real-modules.ts";

/**
 * Security review of PR #143, round 2: the client-side SCRAM-SHA-256 verifier (RFC 5802, RFC 7677) must be exactly the
 * one PostgreSQL itself stores for the same password and salt. Synthetic passwords built at runtime.
 */
let db: RealModulesDatabase;
const role = `ws_test_scram_${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  db = await setupRealModules(1);
  await db.owner.query(`CREATE ROLE ${role} NOLOGIN`);
});
afterAll(async () => {
  await db?.owner.query(`DROP ROLE IF EXISTS ${role}`);
  await db?.close();
});

/** PostgreSQL's own verifier for `password` (hashed by the server), split into its parts. */
async function serverVerifier(password: string): Promise<{ verifier: string; salt: Buffer }> {
  await db.owner.query(`SET password_encryption = 'scram-sha-256'`);
  await db.owner.query(`ALTER ROLE ${role} PASSWORD '${password.replaceAll("'", "''")}'`);
  const { rows } = await db.owner.query<{ v: string }>(
    `SELECT rolpassword AS v FROM pg_authid WHERE rolname = $1`,
    [role],
  );
  const verifier = rows[0]!.v;
  const salt = Buffer.from(/^SCRAM-SHA-256\$\d+:([^$]+)\$/.exec(verifier)![1]!, "base64");
  return { verifier, salt };
}

describe("sec143 round 2: scramVerifier matches PostgreSQL and RFC 7677", () => {
  it("equals the verifier PostgreSQL stores for the same password and salt (the script's password shape)", async () => {
    for (let i = 0; i < 5; i++) {
      const password = randomBytes(24).toString("base64url");
      const { verifier, salt } = await serverVerifier(password);
      expect(scramVerifier(password, salt)).toBe(verifier);
    }
  });

  it("reproduces RFC 7677's example exchange (user/pencil): the proof and server signature check out", () => {
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const v = scramVerifier(["pen", "cil"].join(""), salt);
    const [, storedB64, serverB64] = /^SCRAM-SHA-256\$4096:[^$]+\$([^:]+):(.+)$/.exec(v)!;
    const auth =
      "n=user,r=rOprNGfwEbeRWgbNEkqO," +
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096," +
      "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    const serverSignature = createHmac("sha256", Buffer.from(serverB64!, "base64"))
      .update(auth)
      .digest("base64");
    expect(serverSignature).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    // ClientKey = ClientProof XOR HMAC(StoredKey, AuthMessage); H(ClientKey) must be the StoredKey.
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const clientSignature = createHmac("sha256", Buffer.from(storedB64!, "base64")).update(auth).digest();
    const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]!));
    expect(createHash("sha256").update(clientKey).digest("base64")).toBe(storedB64);
  });

  // PostgreSQL prepares a password with SASLprep (RFC 4013), which also maps some characters to nothing (e.g. U+00AD);
  // scramVerifier accepts printable ASCII only (where both preparations are the identity) and refuses the rest.
  it("a password PostgreSQL would SASLprep differently is refused, never given a wrong verifier", async () => {
    const password = `synthetic${String.fromCharCode(0xad)}pass`;
    const { verifier, salt } = await serverVerifier(password);
    let mine: string | undefined;
    try {
      mine = scramVerifier(password, salt);
    } catch {
      mine = undefined;
    }
    if (mine !== undefined) expect(mine).toBe(verifier);
    expect(mine).toBeUndefined();
  });
});
