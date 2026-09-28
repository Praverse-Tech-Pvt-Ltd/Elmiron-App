import { afterEach, describe, expect, it } from 'vitest';
import type { ExpoConfig } from 'expo/config';
import appConfig from '../app.config';
import plugin from '../plugins/demo-cleartext.cjs';

/**
 * FE-D5 1 — the demo cleartext plugin (operator-approved, with conditions).
 *
 * A release build targets API 36, where Android blocks plain http by default (FE-D4 4), and the
 * demo reaches local Supabase and the mock at the laptop's LAN address over http. The approved
 * fix: one build-time variable, `DEMO_CLEARTEXT_HOSTS`, a list of hosts. Unset or empty: nothing
 * changes. Set: http is allowed to exactly those hosts and nowhere else, and the app's display
 * name ends in " (demo)". The release config guard is not touched.
 */

const { demoCleartextHosts, networkSecurityConfigXml, withDemoCleartext } = plugin;

const base = (): ExpoConfig => ({ name: 'Field Force', slug: 'field-force' });

/** The `<domain>` entries in a network security config, in order. */
const domainsIn = (xml: string): string[] =>
  [...xml.matchAll(/<domain[^>]*>([^<]*)<\/domain>/gu)].map((match) => match[1] ?? '');

afterEach(() => {
  delete process.env['DEMO_CLEARTEXT_HOSTS'];
  delete process.env['EXPO_PUBLIC_APP_DISPLAY_NAME'];
});

describe('demoCleartextHosts — the variable', () => {
  it('unset or empty is no hosts', () => {
    expect(demoCleartextHosts(undefined)).toEqual([]);
    expect(demoCleartextHosts('')).toEqual([]);
    expect(demoCleartextHosts(' , ')).toEqual([]);
  });

  it('a comma-separated list, trimmed', () => {
    expect(demoCleartextHosts(' 192.168.43.20 , laptop.local ')).toEqual([
      '192.168.43.20',
      'laptop.local',
    ]);
  });

  it('refuses anything that is not a bare host — no scheme, port or path can reach the XML', () => {
    for (const bad of [
      'http://192.168.43.20',
      '192.168.43.20:4010',
      '192.168.43.20/x',
      'a b',
      '<x>',
    ]) {
      expect(() => demoCleartextHosts(bad)).toThrow(/DEMO_CLEARTEXT_HOSTS/u);
    }
  });
});

describe('networkSecurityConfigXml — exactly those hosts, nothing else', () => {
  it('allows cleartext to exactly the hosts given', () => {
    const xml = networkSecurityConfigXml(['192.168.43.20']);
    expect(domainsIn(xml)).toEqual(['192.168.43.20']);
    expect(xml).toMatch(/<domain-config cleartextTrafficPermitted="true">/u);
  });

  it('keeps every other host blocked: the base config says so explicitly', () => {
    const xml = networkSecurityConfigXml(['192.168.43.20', 'laptop.local']);
    expect(xml).toMatch(/<base-config cleartextTrafficPermitted="false"/u);
    expect(domainsIn(xml)).toEqual(['192.168.43.20', 'laptop.local']);
    // One domain-config, and only the listed hosts in it — no subdomains either.
    expect(xml.match(/<domain-config/gu)).toHaveLength(1);
    expect(xml).not.toMatch(/includeSubdomains="true"/u);
  });
});

describe('withDemoCleartext — no hosts, no change', () => {
  it('returns the very same config when there are no hosts', () => {
    const config = base();
    expect(withDemoCleartext(config, [])).toBe(config);
    expect(config).toEqual(base());
  });

  it('with hosts, registers its Android mods', () => {
    const out = withDemoCleartext(base(), ['192.168.43.20']) as ExpoConfig & {
      mods?: { android?: Record<string, unknown> };
    };
    expect(Object.keys(out.mods?.android ?? {}).sort()).toEqual(['dangerous', 'manifest']);
  });
});

describe('app.config.ts — the demo build says it is one', () => {
  const run = (): ExpoConfig => appConfig({ config: base() } as Parameters<typeof appConfig>[0]);

  it('with hosts set, the display name ends in " (demo)"', () => {
    process.env['DEMO_CLEARTEXT_HOSTS'] = '192.168.43.20';
    expect(run().name).toBe('Field Force (demo)');
  });

  it('with hosts set, the configured display name is kept and suffixed', () => {
    process.env['DEMO_CLEARTEXT_HOSTS'] = '192.168.43.20';
    process.env['EXPO_PUBLIC_APP_DISPLAY_NAME'] = 'Elmiron Field';
    expect(run().name).toBe('Elmiron Field (demo)');
  });

  it('POSITIVE CONTROL: without hosts, the name and config are exactly as before', () => {
    const out = run() as ExpoConfig & { mods?: unknown };
    expect(out.name).toBe('Field Force');
    expect(out.mods).toBeUndefined();
  });
});
