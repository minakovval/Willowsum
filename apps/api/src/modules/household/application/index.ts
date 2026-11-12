// Application layer of household: use cases, transactions, permission checks (ARC-01 FR 5).
// Uses ports; adapters are wired in ../index.ts.
export { ensureFirstSpace } from "./spaces.ts";
export type { SpaceAudit, SpaceMembership, SpacesDeps, SpacesStore, SpacesTx } from "./spaces.ts";
