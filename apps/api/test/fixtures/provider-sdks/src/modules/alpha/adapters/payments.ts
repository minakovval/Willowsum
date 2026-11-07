// Allowed: a module's adapters folder.
// @ts-expect-error — the fixture's SDKs are not installed.
import Stripe from "stripe";
// @ts-expect-error — not installed.
import { OpenAI } from "openai/client";
export const payments = [Stripe, OpenAI];
