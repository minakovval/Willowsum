// A minimal GitHub REST client for the workflows of ADR-0008 (Node's fetch, no dependencies). It sends only
// the job's GITHUB_TOKEN to api.github.com and never prints it.

const API = process.env.GITHUB_API_URL || 'https://api.github.com';

export function client({ token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY } = {}) {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY must be owner/name');

  async function request(method, path, body, { allow404 = false } = {}) {
    const url = path.startsWith('http') ? path : `${API}${path.replace('{repo}', `repos/${repo}`)}`;
    const res = await fetch(url, {
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
    if (allow404 && res.status === 404) return { data: null, res };
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${new URL(url).pathname}: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    return { data: res.status === 204 ? null : await res.json(), res };
  }

  /** GET every page (Link: rel="next"), up to `max` items. `pick` extracts the array from a page. */
  async function paginate(path, { max = 1000, pick = (d) => d } = {}) {
    const out = [];
    let next = path;
    while (next && out.length < max) {
      const { data, res } = await request('GET', next);
      out.push(...pick(data));
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
