// Forbidden: outside any adapter; the subpath of a scoped SDK counts too.
// @ts-expect-error — the fixture's SDKs are not installed.
import { Storage } from "@google-cloud/storage/build/src";
// Not a provider SDK: a package whose name only starts like one.
// @ts-expect-error — not installed.
import stripeLike from "stripe-like-helper";
export const upload = [Storage, stripeLike];
