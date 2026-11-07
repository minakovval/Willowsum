import type { FetchFn } from "./http.ts";

/**
 * Test helpers of the adapter kit (ADR-0005). A working adapter is tested without the internet: it gets a
 * recording `fetch` that answers from the test, and the test checks the recorded requests against the
 * operation's declared fields with `outgoingFieldViolations` (ARC-05 FR 5).
 */
export interface RecordingFetch {
  readonly fetch: FetchFn;
  readonly requests: Request[];
}

export function recordingFetch(answer: (request: Request) => Response | Promise<Response>): RecordingFetch {
  const requests: Request[] = [];
  return {
    requests,
    fetch: async (request) => {
      requests.push(request.clone());
      return answer(request);
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
