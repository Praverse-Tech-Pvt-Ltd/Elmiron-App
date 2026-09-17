/**
 * MR-42 B1 — one target guard, for the scripts that may legitimately touch a deployment.
 *
 * ## Why this is NOT `assertLocalhostOnly`
 *
 * `seed:day`, `seed:mr`, `seed:synthetic` and `verify:rollbacks` refuse any non-local host
 * outright, and that is right for them: every one writes invented rows or drops the schema,
 * so there is no target but a laptop where they make sense.
 *
 * **`purge:audio`, `check:purge-health` and `reconcile:restore` are different, and copying
 * the seeds' guard onto them would break a compliance control.** `retention.yml` and
 * `retention-watchdog.yml` run the first two **against production on a schedule**, with
 * `secrets.SUPABASE_DB_URL`. The 90-day deletion promise is kept by that scheduled run —
 * BE-W7's own note is that "a control nobody runs is not a control". A localhost-only
 * assertion would turn the purge off and leave the promise false again.
 *
 * So the risk here is not *touching a deployment*. It is **touching one by accident** —
 * inheriting a stale or wrong `SUPABASE_DB_URL` from a shell and reconciling, or purging,
 * the wrong project. `docs/backend-prompt-w8.md` §53 asked exactly this and left it open:
 * whether the target should be named explicitly rather than inherited.
 *
 * **This is the answer: a non-local target must be opted into deliberately.** Local hosts
 * run freely, because that is the development case and a guard that fires constantly is a
 * guard people route around. A deployment target requires `ELMIRON_ALLOW_REMOTE_TARGET=1`,
 * which the two scheduled workflows set in a file that goes through review.
 *
 * ## Why the refusal names the host
 *
 * Because `getaddrinfo ENOTFOUND` is exactly what a missing guard looks like. A test that
 * accepts any non-zero exit certifies nothing: every script "fails" against a host that does
 * not resolve. The refusal has to say **which** host it refused, before any connection is
 * opened, or it cannot be distinguished from the failure it is supposed to prevent.
 */

/** Hosts that are this machine. IPv6 loopback arrives bracketed from `new URL`. */
export const LOCALHOST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** The opt-in a deployment target requires. Set by the scheduled workflows, not by a shell. */
export const REMOTE_OPT_IN = 'ELMIRON_ALLOW_REMOTE_TARGET';

/**
 * The host of a URL, or `null` when it cannot be parsed.
 *
 * Unparseable is its own outcome and must not be treated as local: a malformed URL that fell
 * through to "allowed" would be the guard failing open on exactly the input most likely to be
 * a mistake.
 */
export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
};

export const isLocalHost = (url) => {
  const host = hostOf(url);
  return host !== null && LOCALHOST_HOSTS.has(host);
};

/**
 * Refuse a deployment target unless it was opted into, and NAME THE HOST when refusing.
 *
 * @param {object} args
 * @param {string} args.command   what the operator typed, e.g. `purge:audio`
 * @param {string} args.label     which URL this is, e.g. `database URL`
 * @param {string} args.url       the URL itself
 * @param {string} args.consequence  what running it against that host would do
 * @param {NodeJS.ProcessEnv} [args.env]
 * @throws {Error} naming the host, before any connection is opened
 */
export const assertTargetAllowed = ({ command, label, url, consequence, env = process.env }) => {
  const host = hostOf(url);

  if (host === null) {
    throw new Error(`${command} refuses to run: could not parse ${label} "${url}".`);
  }

  if (LOCALHOST_HOSTS.has(host)) return;

  if (env[REMOTE_OPT_IN] === '1') return;

  throw new Error(
    `${command} refuses to run against host "${host}". ${consequence} ` +
      `That host is not 127.0.0.1, ::1 or localhost, so it is treated as a deployment. ` +
      `If that is genuinely what you mean, set ${REMOTE_OPT_IN}=1 — the scheduled ` +
      `workflows set it deliberately, and a shell that inherited a stale ${label} does not.`,
  );
};
