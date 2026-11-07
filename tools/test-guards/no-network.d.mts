// Types of no-network.mjs (ARC-05, ADR-0005).
export declare class NetworkBlockedError extends Error {
  readonly code: "WS_NETWORK_BLOCKED";
  constructor(host: string | undefined, port: unknown);
}
export declare function isAllowedHost(host: string | undefined, extra?: ReadonlySet<string>): boolean;
export declare function installNetworkGuard(): void;
