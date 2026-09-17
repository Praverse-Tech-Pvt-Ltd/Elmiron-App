import { describe, expect, it } from 'vitest';
import { assertTargetAllowed, REMOTE_OPT_IN } from '../scripts/target-guard.mjs';

/**
 * `BE-W103` — MR-42 B1/B2. The guard on the three scripts that may legitimately touch a
 * deployment.
 *
 * ## The check demands the refusal NAMES THE HOST, and that is the whole point
 *
 * MR-41 found these three unguarded by pointing them at a non-local hostname and watching
 * them fail with `getaddrinfo ENOTFOUND`. **That failure is what a missing guard looks like.**
 * Every script "fails" against a host that does not resolve, so a test satisfied by a non-zero
 * exit — or by any thrown error — would have passed before the guard existed and would pass
 * again if it were deleted.
 *
 * So each assertion below requires the refused host to appear in the message, and the
 * positive control requires the guard to STAND ASIDE when the opt-in is present. A guard that
 * refuses everything is as useless as one that refuses nothing; the scheduled retention
 * workflows have to keep working, because a stopped purge makes the 90-day promise false.
 *
 * ## Why this is not `assertLocalhostOnly`
 *
 * `retention.yml` and `retention-watchdog.yml` run `purge:audio` and `check:purge-health`
 * against production on a schedule. Copying the seeds' localhost-only guard onto them would
 * switch a compliance control off. The risk is an ACCIDENTAL deployment target — a shell with
 * a stale `SUPABASE_DB_URL` — so a deployment target is allowed, but only deliberately.
 */

const REMOTE = 'postgresql://postgres:postgres@db.example-not-real.supabase.co:5432/postgres';
const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const call = (url: string, env: Record<string, string> = {}): void => {
  assertTargetAllowed({
    command: 'purge:audio',
    label: 'database URL',
    url,
    consequence: 'It DELETES audio objects.',
    env,
  });
};

describe('BE-W103 — the target guard refuses a deployment by NAME', () => {
  it('names the host it refused, so the refusal is distinguishable from ENOTFOUND', () => {
    expect(() => {
      call(REMOTE);
    }).toThrow(/db\.example-not-real\.supabase\.co/u);
  });

  it('says it is refusing, not merely failing', () => {
    // `toThrow(/host/)` alone would pass on "could not connect to host ...". The refusal has
    // to be a refusal.
    expect(() => {
      call(REMOTE);
    }).toThrow(/refuses to run against host/u);
  });

  it('names the opt-in, so the operator is not left guessing at the way through', () => {
    expect(() => {
      call(REMOTE);
    }).toThrow(new RegExp(REMOTE_OPT_IN, 'u'));
  });
});

describe('BE-W103 — and it stands aside where it must', () => {
  it('allows a deployment target when the opt-in is set — the positive control', () => {
    // Without this, a guard that threw unconditionally would satisfy every assertion above
    // and silently stop the scheduled purge, which is the compliance control itself.
    expect(() => {
      call(REMOTE, { [REMOTE_OPT_IN]: '1' });
    }).not.toThrow();
  });

  it('allows localhost with no opt-in at all', () => {
    expect(() => {
      call(LOCAL);
    }).not.toThrow();
  });

  it('does not accept a near-miss opt-in value', () => {
    // '1' exactly. `true`, `yes` and an empty string are the values a hurried operator
    // reaches for, and none of them should work.
    for (const value of ['true', 'yes', '', '0']) {
      expect(() => {
        call(REMOTE, { [REMOTE_OPT_IN]: value });
      }).toThrow(/refuses to run against host/u);
    }
  });
});

describe('BE-W103 — an unparseable URL is its own outcome', () => {
  it('refuses rather than treating it as local', () => {
    // Failing open on the input most likely to be a mistake is the worst available default.
    expect(() => {
      call('not a url at all');
    }).toThrow(/could not parse database URL/u);
  });
});
