// Forbidden: a provider SDK in the application layer (also as a type-only import, and a scoped package).
// @ts-expect-error — the fixture's SDKs are not installed.
import Stripe from "stripe";
// @ts-expect-error — not installed.
import type { S3Client } from "@aws-sdk/client-s3";
export const charge = (s: S3Client): unknown => [Stripe, s];
