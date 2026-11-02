import type { uk } from "./messages/uk.ts";

/** Every message key; Ukrainian is the source catalogue. */
export type MessageKey = keyof typeof uk;

/** A complete catalogue: exactly the source keys. */
export type Messages = Record<MessageKey, string>;

/** Values substituted into `{name}` placeholders. */
export type MessageParams = Readonly<Record<string, string | number>>;
