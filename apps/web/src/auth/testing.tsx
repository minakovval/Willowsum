import { configure, render } from "@testing-library/react";
import { StrictMode } from "react";
import { App } from "../App.tsx";
import { AuthApiProvider, createAuthClient } from "./api.ts";
import { resetRegistration } from "./registration.ts";

/** Test helpers of the ACC-01 screens: a fake API on the app's origin (no network, ARC-05) and the app at a route. */
// Answers come through promises: under a loaded CI runner the default 1 s of waitFor/findBy is too tight.
configure({ asyncUtilTimeout: 5000 });

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly origin: string;
  readonly body: unknown;
}

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | "network";
type Handler = (call: Call) => Reply | Promise<Reply>;

export const SUPPORT_ID = "0123456789abcdef0123456789abcdef";
export const TOKEN = "A".repeat(43);

export function problem(status: number, code: string, headers?: Record<string, string>): Reply {
  return {
    status,
    body: {
      type: `urn:willowsum:problem:${code.toLowerCase()}`,
      title: code,
      status,
      code,
      supportId: SUPPORT_ID,
    },
    headers: { "content-type": "application/problem+json", ...headers },
  };
}

export function fakeApi(handlers: Record<string, Handler | Reply>) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const call: Call = {
      method: request.method,
      path: url.pathname,
      origin: url.origin,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    const reply = typeof handler === "function" ? await handler(call) : handler;
    if (reply === undefined) return new Response(null, { status: 599 });
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { client: createAuthClient(fetchImpl as typeof fetch), calls };
}

export function renderAt(
  hash: string,
  client: ReturnType<typeof fakeApi>["client"],
  { strict = false } = {},
) {
  window.location.hash = hash;
  const tree = (
    <AuthApiProvider value={client}>
      <App />
    </AuthApiProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Text with the no-break spaces of `keepNumbersTogether` turned back into plain spaces. */
export const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");

export function resetAuthState() {
  resetRegistration();
  localStorage.clear();
  sessionStorage.clear();
}
