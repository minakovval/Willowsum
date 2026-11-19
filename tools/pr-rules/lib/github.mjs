// A minimal GitHub REST client for the workflows of ADR-0008 (Node's fetch, no dependencies). It sends only
// the job's GITHUB_TOKEN to api.github.com and never prints it.

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
/** Statuses GitHub returns for a transient server failure («this diff is temporarily unavailable», #503). */
const TRANSIENT = new Set([500, 502, 503, 504]);
const RETRY_AFTER_MAX_S = 60;

/**
 * Backoff before each retry: 2 s, 8 s, 30 s (40 s at most per call, inside the job's 15 minutes).
 * `PR_RULES_RETRY_MS` scales it (the unit tests set 1 ms); read per call.
 */
export function retryDelays() {
  const base = Number(process.env.PR_RULES_RETRY_MS ?? 2000);
  return Number.isFinite(base) && base >= 0 ? [base, base * 4, base * 15] : [2000, 8000, 30000];
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The wait before retrying a failed answer, or undefined when it is final (4xx, or no retries left). */
function retryWait(res, attempt, delays) {
  if (attempt >= delays.length) return undefined;
  if (TRANSIENT.has(res.status)) return delays[attempt];
  // A secondary rate limit names its wait; the primary limit (remaining 0, reset up to an hour away) is final.
  const after = Number(res.headers.get('retry-after'));
  if ((res.status === 403 || res.status === 429) && res.headers.has('retry-after') && after >= 0 && after <= RETRY_AFTER_MAX_S) {
    return Math.max(after * 1000, delays[attempt]);
  }
  return undefined;
}

export function client({ token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY } = {}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY must be owner/name');

  let rateRemaining;

  /** One HTTP call; `fetch` throws on a network error (TypeError «fetch failed»). */
  async function send(method, url, body) {
    return fetch(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'willowsum-pr-rules',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function request(method, path, body, { allow404 = false } = {}) {
    const url = path.startsWith('http') ? path : `${API}${path.replace('{repo}', `repos/${repo}`)}`;
    // #503: a transient answer (5xx, a dropped connection, a secondary rate limit with Retry-After) is retried
    // with backoff, for GET only: a repeated POST could open the alert issue twice. The last error is thrown.
    const delays = method === 'GET' ? retryDelays() : [];
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await send(method, url, body);
      } catch (e) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]);
          continue;
        }
        throw e;
      }
      const left = Number(res.headers.get('x-ratelimit-remaining'));
      if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(left)) rateRemaining = left;
      if (allow404 && res.status === 404) return { data: null, res };
      if (!res.ok) {
        const text = await res.text();
        const wait = retryWait(res, attempt, delays);
        if (wait !== undefined) {
          await sleep(wait);
          continue;
        }
        throw new Error(`${method} ${new URL(url).pathname}: HTTP ${res.status} ${text.slice(0, 300)}`);
      }
      return { data: res.status === 204 ? null : await res.json(), res };
    }
  }

  /**
   * GET every page (Link: rel="next"). `pick` extracts the array from a page; `stop(item)` ends paging after a
   * page whose last item matches (lists sorted newest first). More than `max` items is an error (a check must
   * not pass on a shortened list) unless `keepFirst` is set for informational lists.
   */
  async function paginate(path, { max = 1000, pick = (d) => d, stop, keepFirst = false } = {}) {
    const out = [];
    let next = path;
    while (next) {
      if (out.length >= max) {
        if (keepFirst) break;
        throw new Error(`GET ${path.split('?')[0]}: more than ${max} items; refusing to check a truncated list`);
      }
      const { data, res } = await request('GET', next);
      const page = pick(data);
      out.push(...page);
      if (stop && page.length && stop(page.at(-1))) break;
      // Next-page links may use the numeric form /repositories/<id>/…; keep the owner/name form.
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1]?.replace(/\/repositories\/\d+\//, `/repos/${repo}/`);
    }
    return out.slice(0, max);
  }

  return {
    repo,
    get: async (path, opts) => (await request('GET', path, undefined, opts)).data,
    post: async (path, body, opts) => (await request('POST', path, body, opts)).data,
    patch: async (path, body) => (await request('PATCH', path, body)).data,
    paginate,
    request,
    /** `x-ratelimit-remaining` of the last answer (undefined until one carried it). */
    rateRemaining: () => rateRemaining,
  };
}

/** Make sure a label exists (422 «already_exists» is fine). */
export async function ensureLabel(gh, name, color, description) {
  try {
    await gh.post('/{repo}/labels', { name, color, description });
  } catch (e) {
    if (!/HTTP 422/.test(String(e.message))) throw e;
  }
}
