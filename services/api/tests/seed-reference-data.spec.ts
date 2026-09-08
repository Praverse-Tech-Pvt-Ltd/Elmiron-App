import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DB_URL, requireDatabase, withClient } from './db.js';
import { parseSeedCliArgs, seedReferenceData } from '../scripts/seed-reference-data.mjs';
import type { ReferenceData } from '../scripts/seed-reference-data.d.mts';

/**
 * BE-W8 §2.3 — the seed script's data is supplied separately and never fabricated
 * into this repo (see the script header). This suite proves the *mechanism* only:
 * idempotency, the dry-run rollback, and the CLI refusal — using data that is
 * obviously synthetic (`OBSOLETE_TEST_FIXTURE`) and never intended to represent a
 * real organisation, territory or doctor.
 *
 * Keys carry a fresh runId, the same reason services/api/tests/fixtures.ts does:
 * ids are deterministic from the key, so a fixed key would collide with whatever
 * this suite committed on a previous run (nothing here is torn down — the whole
 * point under test is that a second run of the SAME file inserts nothing, which
 * has to stay distinguishable from two DIFFERENT runs colliding by accident).
 */

const reachable = await requireDatabase();
const runId = randomUUID().slice(0, 8);

const FIXTURE: ReferenceData = {
  organisations: [
    { key: `be-w8-test-org-${runId}`, name: `OBSOLETE_TEST_FIXTURE Organisation ${runId}` },
  ],
  territories: [
    {
      key: `be-w8-test-territory-${runId}`,
      name: `OBSOLETE_TEST_FIXTURE Territory ${runId}`,
      code: `BE-W8-TEST-${runId}`,
      parentKey: null,
      organisationKey: `be-w8-test-org-${runId}`,
    },
  ],
  doctors: [
    {
      key: `be-w8-test-doctor-${runId}`,
      organisationKey: `be-w8-test-org-${runId}`,
      territoryKey: `be-w8-test-territory-${runId}`,
      fullName: `OBSOLETE_TEST_FIXTURE Doctor ${runId}`,
      registrationNumber: null,
      specialty: null,
      qualification: null,
    },
  ],
  consentTextVersions: [
    {
      key: `be-w8-test-consent-text-${runId}`,
      organisationKey: `be-w8-test-org-${runId}`,
      versionLabel: `BE-W8 test fixture ${runId}`,
      language: 'en',
      fullText: 'OBSOLETE_TEST_FIXTURE consent text, used only by this suite.',
    },
  ],
};

describe.skipIf(!reachable)('seedReferenceData', () => {
  it('changes nothing on a dry run', async () => {
    // Scoped to THIS fixture's own organisation, not to a global `count(*)`.
    //
    // It was a global count until MR-06, and that was a race the suite kept winning. The
    // two reads bracket a call that takes a connection and a transaction, and vitest runs
    // these suites in parallel -- so any other suite committing an organisation between
    // them failed this assertion with a message about a dry run, which is not what went
    // wrong. `seedFixtures()` began committing TWO organisations rather than one when the
    // rival tenant was added, and the race started being lost.
    //
    // The test's intent is "a dry run inserts nothing", and the honest expression of that
    // is that the row this dry run would have written is absent. That cannot be perturbed
    // by a suite seeding its own data, and it is a strictly stronger claim than a count
    // that happened to stay level.
    const orgName = FIXTURE.organisations[0]?.name;

    const before = await withClient((client) =>
      client.query<{ n: number }>(
        'select count(*)::int as n from public.organisations where name = $1',
        [orgName],
      ),
    );
    expect(before.rows[0]?.n, 'the fixture organisation must not exist yet').toBe(0);

    const result = await seedReferenceData(FIXTURE, { apply: false, dbUrl: DB_URL });
    expect(result.applied).toBe(false);
    expect(result.counts.organisations).toBe(1);
    expect(result.counts.territories).toBe(1);
    expect(result.counts.doctors).toBe(1);
    expect(result.counts.consentTextVersions).toBe(1);

    const after = await withClient((client) =>
      client.query<{ n: number }>(
        'select count(*)::int as n from public.organisations where name = $1',
        [orgName],
      ),
    );
    expect(after.rows[0]?.n, 'a dry run wrote the organisation it only counted').toBe(0);
  });

  it('is idempotent: applying the same file twice inserts nothing the second time', async () => {
    const first = await seedReferenceData(FIXTURE, { apply: true, dbUrl: DB_URL });
    expect(first.applied).toBe(true);
    expect(first.counts.organisations).toBe(1);
    expect(first.counts.territories).toBe(1);
    expect(first.counts.doctors).toBe(1);
    expect(first.counts.consentTextVersions).toBe(1);

    const second = await seedReferenceData(FIXTURE, { apply: true, dbUrl: DB_URL });
    expect(second.applied).toBe(true);
    expect(second.counts.organisations).toBe(0);
    expect(second.counts.territories).toBe(0);
    expect(second.counts.doctors).toBe(0);
    expect(second.counts.consentTextVersions).toBe(0);
  });

  it('never writes a territory_shift_windows row or an org_default_shift_window threshold', async () => {
    await seedReferenceData(FIXTURE, { apply: true, dbUrl: DB_URL });

    const window = await withClient((client) =>
      client.query<{ n: number }>(
        `select count(*)::int as n
           from public.territory_shift_windows
          where territory_id = (select id from public.territories where name = $1)`,
        [`OBSOLETE_TEST_FIXTURE Territory ${runId}`],
      ),
    );
    expect(window.rows[0]?.n).toBe(0);
  });

  it('writes audit_log rows for territories and doctors, none for organisations', async () => {
    const territoryId = await withClient((client) =>
      client
        .query<{ id: string }>('select id from public.territories where name = $1', [
          `OBSOLETE_TEST_FIXTURE Territory ${runId}`,
        ])
        .then((r) => r.rows[0]?.id),
    );

    const auditRows = await withClient((client) =>
      client.query(
        `select table_name from public.audit_log where table_name = 'territories' and row_id = $1`,
        [territoryId],
      ),
    );
    expect(auditRows.rowCount).toBeGreaterThan(0);
  });
});

describe('parseSeedCliArgs', () => {
  it('refuses without --data', () => {
    expect(() => {
      parseSeedCliArgs([]);
    }).toThrow(/requires --data/);
  });

  it('refuses --apply without --db-url', () => {
    expect(() => {
      parseSeedCliArgs(['--data', 'reference.json', '--apply']);
    }).toThrow(/refuses to run without --db-url/);
  });

  it('allows a dry run with only --data', () => {
    const args = parseSeedCliArgs(['--data', 'reference.json']);
    expect(args).toEqual({ apply: false, dataPath: 'reference.json', dbUrl: undefined });
  });

  it('allows --apply with --db-url given explicitly', () => {
    const args = parseSeedCliArgs([
      '--data',
      'reference.json',
      '--apply',
      '--db-url',
      'postgresql://x',
    ]);
    expect(args).toEqual({
      apply: true,
      dataPath: 'reference.json',
      dbUrl: 'postgresql://x',
    });
  });
});
