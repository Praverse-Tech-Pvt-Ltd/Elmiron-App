import { z } from 'zod';

/**
 * Runtime configuration.
 *
 * Nothing single-app is hardcoded anywhere in this package. The JWT audience, the
 * site URL, the permitted redirect URLs and the deep-link scheme all come from the
 * environment, because a second app — the patient app — will consume
 * `@fieldforce/core` with different values for every one of them.
 *
 * `loadAppConfig` fails loudly on a missing or malformed value rather than falling
 * back to a default. A silently-wrong redirect URL is an auth loop nobody can
 * debug from the symptom.
 */

export const AppConfigSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(1),

  /** The `aud` claim tokens must carry. Supabase issues `authenticated`. */
  jwtAudience: z.string().min(1),

  /** Where auth redirects land. Differs per app and per environment. */
  siteUrl: z.url(),

  /** Exact URLs auth providers may redirect to. Empty is valid for a mobile-only app. */
  additionalRedirectUrls: z.array(z.url()),

  /** Mobile deep-link scheme, without `://` — e.g. `com.praversetech.fieldforce`. */
  deepLinkScheme: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9+.-]*$/, 'a scheme is lowercase and starts with a letter'),

  /**
   * MR-53 B2 — consultation recording, OFF unless this build says otherwise.
   *
   * **`C3` is not reversed.** Scope §8.6 requires a named PV/DPDP signatory before the recording
   * feature ships, and §2.4's adverse-event screening duty follows from transcripts existing. The
   * feature is therefore built and unreachable, behind TWO independent switches: this one, and a
   * server-side `app_thresholds` row that is also false. The screen draws a record control only
   * when both say yes.
   */
  recordingEnabled: z.boolean(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export type EnvLike = Record<string, string | undefined>;

/**
 * Hosts that are this machine — the same set `services/api/scripts/target-guard.mjs` uses, and for
 * the same reason: a rule about "is this a deployment" must be one rule.
 *
 * IPv6 loopback arrives bracketed from `new URL`.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * Is this URL a local stack?
 *
 * **Unparseable is NOT local.** A malformed URL failing open would be the guard failing on exactly
 * the input most likely to be a mistake — `target-guard.mjs` records the same rule.
 */
export const isLocalTarget = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * MR-53 B2 — the flag's enforcement, not its documentation.
 *
 * `true` only when the build asked for it AND the target is a local stack. A build pointed at a
 * deployment that asks for recording does not get a quiet `false`: it THROWS, because silently
 * ignoring the request would leave whoever set it believing the feature is on.
 */
const readRecordingFlag = (env: EnvLike, supabaseUrl: string | undefined): boolean => {
  const asked = (env['APP_RECORDING_ENABLED'] ?? '').trim().toLowerCase() === 'true';
  if (!asked) return false;
  if (supabaseUrl === undefined || !isLocalTarget(supabaseUrl)) {
    throw new Error(
      'APP_RECORDING_ENABLED is set, but SUPABASE_URL is not a local stack ' +
        `(${supabaseUrl ?? 'unset'}). Consultation recording may not be enabled against a ` +
        'deployment: C3 stands until the named PV/DPDP signatory exists (scope 8.6), and a ' +
        'recording creates the 2.4 adverse-event screening duty. Point this build at a local ' +
        'Supabase, or leave the flag unset.',
    );
  }
  return true;
};

const splitList = (value: string | undefined): string[] =>
  value === undefined || value.trim() === ''
    ? []
    : value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');

export const loadAppConfig = (env: EnvLike): AppConfig => {
  const parsed = AppConfigSchema.safeParse({
    supabaseUrl: env['SUPABASE_URL'],
    supabasePublishableKey: env['SUPABASE_PUBLISHABLE_KEY'],
    jwtAudience: env['APP_JWT_AUDIENCE'],
    siteUrl: env['APP_SITE_URL'],
    additionalRedirectUrls: splitList(env['APP_ADDITIONAL_REDIRECT_URLS']),
    deepLinkScheme: env['APP_DEEP_LINK_SCHEME'],
    // Thrown from here rather than validated as a field: the refusal has to name the host it
    // refused, which a schema message cannot do.
    recordingEnabled: readRecordingFlag(env, env['SUPABASE_URL']),
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid application configuration:\n${detail}`);
  }

  return parsed.data;
};
