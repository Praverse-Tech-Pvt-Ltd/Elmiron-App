import { describe, expect, it } from 'vitest';
import { notificationLink, registerForPush, unregisterForPush } from './registration';
import type { PushDeps, PushPermission } from './registration';
import { runBeforeSignOut, setBeforeSignOut } from './before-sign-out';

/** `FE-W86` — registering this phone for push, and taking it back, with everything faked. */

const fakes = (
  permission: PushPermission,
  options: { token?: string; serverFails?: boolean; hang?: boolean } = {},
) => {
  const registered: string[] = [];
  const unregistered: string[] = [];
  let stored: { userId: string; token: string } | null = null;
  const deps: PushDeps = {
    platform: {
      permission: () => Promise.resolve(permission),
      deviceToken: () => Promise.resolve(options.token ?? 'fcm-token-1'),
      ensureChannel: () => Promise.resolve(),
    },
    server: {
      register: (token) => {
        if (options.serverFails === true) return Promise.reject(new Error('offline'));
        registered.push(token);
        return Promise.resolve();
      },
      unregister: (token) => {
        if (options.hang === true) return new Promise(() => undefined);
        unregistered.push(token);
        return Promise.resolve();
      },
    },
    memory: {
      read: () => Promise.resolve(stored),
      write: (value) => {
        stored = value === null ? null : { ...value };
        return Promise.resolve();
      },
    },
  };
  return { deps, registered, unregistered, stored: () => stored };
};

describe('registerForPush', () => {
  it('permission not granted: nothing is asked and nothing is registered', async () => {
    for (const answer of ['denied', 'undetermined'] as const) {
      const f = fakes(answer);
      expect(await registerForPush(f.deps, 'rep-1')).toBe('no-permission');
      expect(f.registered).toEqual([]);
    }
  });

  it('granted: registered once; again for the same person and token is a no-op', async () => {
    const f = fakes('granted');
    expect(await registerForPush(f.deps, 'rep-1')).toBe('registered');
    expect(await registerForPush(f.deps, 'rep-1')).toBe('already');
    expect(f.registered).toEqual(['fcm-token-1']);
  });

  it('a different person on the same phone registers again', async () => {
    const f = fakes('granted');
    await registerForPush(f.deps, 'rep-1');
    expect(await registerForPush(f.deps, 'rep-2')).toBe('registered');
    expect(f.stored()).toEqual({ userId: 'rep-2', token: 'fcm-token-1' });
  });

  it('a server that cannot be reached is "failed", never a throw, and nothing is remembered', async () => {
    const f = fakes('granted', { serverFails: true });
    expect(await registerForPush(f.deps, 'rep-1')).toBe('failed');
    expect(f.stored()).toBeNull();
  });
});

describe('unregisterForPush and the sign-out step', () => {
  it('retires the remembered token and forgets it', async () => {
    const f = fakes('granted');
    await registerForPush(f.deps, 'rep-1');
    expect(await unregisterForPush(f.deps)).toBe(true);
    expect(f.unregistered).toEqual(['fcm-token-1']);
    expect(f.stored()).toBeNull();
  });

  it('a server that never answers does not hold sign-out past the timeout', async () => {
    const f = fakes('granted', { hang: true });
    await registerForPush(f.deps, 'rep-1');
    expect(await unregisterForPush(f.deps, 20)).toBe(false);
    expect(f.stored()).toBeNull();
  });

  it('the sign-out step runs once registered, and a failing step never throws', async () => {
    let ran = 0;
    const clear = setBeforeSignOut(() => {
      ran += 1;
      return Promise.reject(new Error('no signal'));
    });
    await runBeforeSignOut();
    expect(ran).toBe(1);
    clear();
    await runBeforeSignOut();
    expect(ran).toBe(1);
  });
});

describe('notificationLink', () => {
  it('opens only the screens the server’s four kinds name; anything else opens Today', () => {
    expect(notificationLink({ link: '/beat-plan' })).toBe('/beat-plan');
    expect(notificationLink({ link: '/day-end' })).toBe('/day-end');
    expect(notificationLink({ link: '/learning' })).toBe('/learning');
    expect(notificationLink({ link: '/analysis/9a12f3dc-4f61-4b13-879d-f2224d1dc498' })).toBe(
      '/analysis/9a12f3dc-4f61-4b13-879d-f2224d1dc498',
    );
    for (const bad of [{ link: 'https://evil.example' }, { link: '/visit/../me' }, {}, null, 'x']) {
      expect(notificationLink(bad)).toBe('/home');
    }
  });
});
