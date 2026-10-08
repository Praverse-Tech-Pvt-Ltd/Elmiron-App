/**
 * W2-H A — what the two content loaders share: reading the file's header block, signing in as the
 * operator's OWN admin account, and talking to the server through PostgREST under that account.
 *
 * **Why through PostgREST as an admin, and never as the service role or a database superuser.** The
 * console writes courses and knowledge as a signed-in admin, so row-level security, the column grants
 * and the insert triggers decide what is accepted. A loader that wrote any other way would accept
 * things the console refuses — it would be an insert script, which is what this replaces. So both
 * loaders sign in with an admin's email and a password read from the environment (never an argument,
 * never printed), and make exactly the requests a console would.
 *
 * **Every problem first, nothing written.** Each loader's pure `check…` returns every refusal in the
 * file, by line, with a code; the catalogue checks (does this market exist, is this account an admin)
 * run next; only when both are empty is anything written.
 */

/**
 * A file is a header block between `---` lines, `key: value` per line, then the body.
 * @param {string} text
 * @returns {{ header: Record<string, { value: string; line: number }>; body: string; bodyStartLine: number; problems: { code: string; line: number; detail: string }[] }}
 */
export const splitHeader = (text) => {
  const lines = text.replace(/^\u{FEFF}/u, '').split(/\r?\n/);
  const problems = [];
  const header = {};
  if (lines[0]?.trim() !== '---') {
    return {
      header,
      body: lines.join('\n'),
      bodyStartLine: 1,
      problems: [
        { code: 'missing_header', line: 1, detail: 'the file must start with a --- header block' },
      ],
    };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      end = i;
      break;
    }
    const raw = lines[i] ?? '';
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const m = /^([a-z_]+)\s*:\s*(.*)$/u.exec(raw.trim());
    if (m === null) {
      problems.push({
        code: 'bad_header_line',
        line: i + 1,
        detail: `"${raw.trim()}" is not "key: value"`,
      });
      continue;
    }
    // A trailing "# comment" in the header is the operator's note, not the value.
    header[m[1]] = { value: (m[2] ?? '').replace(/\s+#.*$/u, '').trim(), line: i + 1 };
  }
  if (end === -1) {
    // Unclosed, every later line was read as header; reporting each as a bad header line would bury
    // the one real problem.
    return {
      header,
      body: '',
      bodyStartLine: lines.length + 1,
      problems: [
        { code: 'missing_header', line: 1, detail: 'the header block is never closed with ---' },
      ],
    };
  }
  return { header, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2, problems };
};

/** Titles the samples use. A sample left as it is must be refused by name, never loaded. */
export const isExample = (title) => /^EXAMPLE\b/u.test(title.trim());

/** The server, as one signed-in admin. */
export const signIn = async ({ url, apiKey, email, password, fetchImpl = fetch }) => {
  const res = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== 'string') {
    // The server's sentence, never the password.
    throw new Error(
      `sign-in refused (${String(res.status)}): ${String(body.error_description ?? body.msg ?? 'no reason given')}`,
    );
  }
  return { token: body.access_token, userId: String(body.user?.id ?? '') };
};

/** PostgREST under that admin's token. A refusal throws with the server's code and message. */
export const restClient = ({ url, apiKey, token, fetchImpl = fetch }) => {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(method === 'POST' || method === 'PATCH' ? { prefer: 'return=representation' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const parsed = text === '' ? null : JSON.parse(text);
    if (!res.ok) {
      const error = new Error(
        `${method} ${path.split('?')[0]} refused: ${String(parsed?.message ?? res.status)}`,
      );
      error.code = parsed?.code ?? null;
      throw error;
    }
    return parsed;
  };
  return {
    get: (path) => call('GET', path),
    insert: async (table, row) => (await call('POST', table, row))[0],
    remove: (path) => call('DELETE', path),
    rpc: (fn, args) => call('POST', `rpc/${fn}`, args),
  };
};

/** Who the signed-in account is, from its own profile row (RLS lets anyone read themselves). */
export const whoAmI = async (rest, userId) => {
  const [me] = await rest.get(`user_profiles?select=id,role,organisation_id&id=eq.${userId}`);
  return me ?? null;
};

/**
 * A company's market (by `name`) or product (by `brand_name`, or `generic_name`) by NAME,
 * case-insensitive. Null when it has none by that name; 'ambiguous' when it has more than one.
 * RLS returns only the signed-in admin's own company's rows.
 */
export const byName = async (rest, table, name) => {
  const columns = table === 'products' ? 'id,brand_name,generic_name' : 'id,name';
  const rows = await rest.get(`${table}?select=${columns}&is_active=eq.true`);
  const want = name.trim().toLowerCase();
  const names = (r) =>
    table === 'products' ? [r.brand_name, r.generic_name].filter(Boolean) : [r.name];
  const hits = rows.filter((r) => names(r).some((n) => String(n).trim().toLowerCase() === want));
  return hits.length === 1 ? hits[0] : hits.length > 1 ? 'ambiguous' : null;
};

export const formatProblems = (problems) =>
  problems.map((p) => `  line ${String(p.line)}: ${p.code} — ${p.detail}`).join('\n');
