import { z } from 'zod';

/**
 * Runtime configuration.
 *
 * Nothing single-app is hardcoded anywhere in this package. The JWT audience, the
 * site URL, the permitted redirect URLs and the deep-link scheme all come from the
 * environment, because a second app — the patient app — will consume
 * `@elmiron/core` with different values for every one of them.
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

  /** Mobile deep-link scheme, without `://` — e.g. `elmironmr`. */
  deepLinkScheme: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9+.-]*$/, 'a scheme is lowercase and starts with a letter'),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export type EnvLike = Record<string, string | undefined>;

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
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid application configuration:\n${detail}`);
  }

  return parsed.data;
};
