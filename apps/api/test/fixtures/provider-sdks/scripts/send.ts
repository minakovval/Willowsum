// Forbidden: scripts are not adapters either.
// @ts-expect-error — the fixture's SDKs are not installed.
import twilio from "twilio";
export const send = twilio;
