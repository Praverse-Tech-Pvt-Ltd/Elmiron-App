import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The display name is configuration, not a constant.
 *
 * This file exists for one reason: to stop the branding decision being welded to the
 * irreversible one. `android.package` and `scheme` in `app.json` are permanent the
 * moment anything is published — a different package id is a different app, with a
 * new listing and no upgrade path. The name on the home screen is none of those
 * things, and it should be changeable by whoever owns the brand without an engineer
 * touching an identifier.
 *
 * So: everything static stays in `app.json`, and the one value that is expected to
 * change comes from the environment with a neutral default.
 *
 * See `docs/brand-identifier-decision.md`. The default is deliberately not a brand
 * name — the trademark position is still open, and an internally-circulated APK
 * carrying somebody else's mark is a small exposure taken for no reason.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: process.env.EXPO_PUBLIC_APP_DISPLAY_NAME ?? 'Field Force',
  slug: config.slug ?? 'field-force',
});
