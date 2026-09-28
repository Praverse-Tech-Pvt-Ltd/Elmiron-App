import type { ConfigContext, ExpoConfig } from 'expo/config';
import demoCleartext from './plugins/demo-cleartext.cjs';

const { demoCleartextHosts, withDemoCleartext } = demoCleartext;

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
export default ({ config }: ConfigContext): ExpoConfig => {
  /**
   * FE-D5 1 — DEMO BUILDS ONLY. `DEMO_CLEARTEXT_HOSTS` (a build-time list, never inlined into the
   * app) lets plain http reach exactly those hosts — the laptop's LAN address — and marks the
   * build " (demo)" on the home screen, so nobody mistakes it for a production install. Unset or
   * empty: nothing here changes. See `plugins/demo-cleartext.cjs`.
   */
  const demoHosts = demoCleartextHosts(process.env['DEMO_CLEARTEXT_HOSTS']);
  const name = process.env.EXPO_PUBLIC_APP_DISPLAY_NAME ?? 'Field Force';

  return withDemoCleartext(
    {
      ...config,
      name: demoHosts.length === 0 ? name : `${name} (demo)`,
      slug: config.slug ?? 'field-force',
    },
    demoHosts,
  );
};
