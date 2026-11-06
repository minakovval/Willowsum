/** Opaque identifier of an entity of kind `K`, e.g. `Id<"household">`. Random UUID v4 (Web Crypto). */
export type Id<K extends string> = string & { readonly __kind: K };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId<K extends string>(): Id<K> {
  return globalThis.crypto.randomUUID() as Id<K>;
}

export function isId(value: string): boolean {
  return UUID_RE.test(value);
}

export function parseId<K extends string>(value: string): Id<K> | null {
  return isId(value) ? (value as Id<K>) : null;
}
