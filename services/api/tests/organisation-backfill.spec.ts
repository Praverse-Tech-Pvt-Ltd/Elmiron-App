import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import type { Client } from 'pg';

/**
 * `BE-W76` / MR-35 B4 — the organisation backfill's two non-empty branches.
 *
 * **Why this file exists at all.** `20260908000800_user_profiles_organisation.sql` carried a
 * comment claiming its single-organisation branch was "exercised only by its test". There was
 * no such test, and the branch did not work: it called `min(id)` on a `uuid` column, and
 * PostgreSQL has no `min` aggregate for `uuid`, so it raised `42883` the moment it was reached.
 * MR-34 found it by rehearsing the deploy; MR-35 fixed it and wrote this.
 *
 * **Why it could never have been found by re-running the migration.** A backfill executes ONCE,
 * at migration time. By the time any suite runs, `schema_migrations` already holds the version
 * and nothing will apply it again. And on a fresh database — which is every CI database — the
 * block returns immediately, because there are no territory-less profiles to backfill. **The
 * two branches that matter are unreachable from CI's migration run by construction.**
 *
 * So this runs the migration's own `do` block, READ OUT OF THE SHIPPED FILE, against seeded
 * data inside a rolled-back transaction. Reading the file rather than restating the SQL is
 * deliberate: a copy of the statement in this file would pass forever while the migration drifted
 * away from it, which is the same class of mistake as the comment this replaces.
 */

const reachable = await requireDatabase();

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../supabase/migrations/20260908000800_user_profiles_organisation.sql',
);

/**
 * The second backfill — the one that resolves or refuses — as it is shipped.
 *
 * Anchored on the `v_orphans` declaration so it cannot silently match the first backfill or a
 * later `do` block added above it. If the file is restructured this throws rather than testing
 * nothing, which is the failure mode that matters here.
 */
const backfillBlock = (): string => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const blocks = [...sql.matchAll(/do \$\$[\s\S]*?\$\$;/gu)].map((m) => m[0]);
  const block = blocks.find((b) => b.includes('v_orphans'));
  if (block === undefined) {
    throw new Error(
      'Could not find the orphan backfill `do` block in 20260908000800. This test asserts the ' +
        'SHIPPED SQL; if the migration was restructured, re-anchor this extractor rather than ' +
        'deleting the assertion.',
    );
  }
  return block;
};

const TWIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '../supabase/migrations/20260908001200_consent_text_versions_tenant.sql',
);

/** The twin's attribution block, anchored on its own `v_rows` declaration. */
const twinBlock = (): string => {
  const blocks = [...readFileSync(TWIN, 'utf8').matchAll(/do \$\$[\s\S]*?\$\$;/gu)].map(
    (m) => m[0],
  );
  const block = blocks.find((b) => b.includes('v_rows'));
  if (block === undefined) {
    throw new Error('Could not find the attribution `do` block in 20260908001200.');
  }
  return block;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ORG_A = '22222222-2222-2222-2222-222222222222';
const ORG_B = '33333333-3333-3333-3333-333333333333';

/**
 * Rebuild the pre-backfill world inside the transaction.
 *
 * `organisation_id` is `not null` from this migration onward, so a profile that has not been
 * backfilled cannot be expressed on today's schema. Dropping the constraint is what makes the
 * branch reachable at all; DDL is transactional in PostgreSQL, so it goes back with everything
 * else. `orphans: false` is the CI path — the one that has always run.
 */
const seed = async (
  client: Client,
  options: { readonly organisations: number; readonly orphans: boolean },
): Promise<void> => {
  // Two things make the pre-backfill state unrepresentable on today's schema, and BOTH are
  // installed by this same migration: the `not null` constraint, and a trigger that refuses a
  // profile with neither a territory nor an explicit organisation. Reaching the branch means
  // standing both down. DDL and `disable trigger` are transactional, so they roll back too.
  await client.query('alter table public.user_profiles alter column organisation_id drop not null');
  await client.query(
    'alter table public.user_profiles disable trigger user_profiles_derive_organisation',
  );
  await client.query('delete from public.user_profiles');
  await client.query('delete from public.organisations');

  await client.query("insert into public.organisations (id, name) values ($1, 'Org A')", [ORG_A]);
  if (options.organisations > 1) {
    await client.query("insert into public.organisations (id, name) values ($1, 'Org B')", [ORG_B]);
  }

  if (options.orphans) {
    await client.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
               'mr35-backfill@example.test', 'x', now(), now(), now())
       on conflict (id) do nothing`,
      [ADMIN],
    );
    await client.query(
      `insert into public.user_profiles (id, full_name, role, territory_id, organisation_id)
       values ($1, 'MR-35 Backfill Admin', 'admin', null, null)`,
      [ADMIN],
    );
  }

  // The precondition this whole file turns on. Asserted here rather than trusted, because a
  // seed that silently did nothing would make every branch below look like the no-op path.
  const { rows } = await client.query<{ orphans: string; orgs: string }>(
    `select (select count(*) from public.user_profiles where organisation_id is null)::text as orphans,
            (select count(*) from public.organisations)::text as orgs`,
  );
  expect(rows[0]?.orphans).toBe(options.orphans ? '1' : '0');
  expect(rows[0]?.orgs).toBe(String(options.organisations));
};

describe.skipIf(!reachable)('BE-W76 — the organisation backfill', () => {
  it('assigns the territory-less user when exactly one organisation exists', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client, { organisations: 1, orphans: true });

      await client.query(backfillBlock());

      const { rows } = await client.query<{ organisation_id: string | null }>(
        'select organisation_id from public.user_profiles where id = $1',
        [ADMIN],
      );
      expect(rows[0]?.organisation_id).toBe(ORG_A);
    });
  });

  it('refuses, rather than guessing, when more than one organisation exists', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client, { organisations: 2, orphans: true });

      // Choosing an organisation for an administrator is choosing whose data they may read.
      await expect(client.query(backfillBlock())).rejects.toMatchObject({ code: '23502' });
    });
  });

  it('does nothing when there are no territory-less users — the only path CI runs', async () => {
    await inRolledBackTransaction(async (client) => {
      await seed(client, { organisations: 2, orphans: false });

      // Two organisations AND no orphans: the refusal above would fire if the early return
      // were removed, so this is the positive control for that return, not a smoke test.
      await expect(client.query(backfillBlock())).resolves.toBeDefined();
    });
  });

  it('never uses min() on a uuid, because PostgreSQL has no such aggregate', () => {
    // The regression guard, stated two ways.
    //
    // Assert the EXECUTABLE SQL, not the file. The first version of this matched the whole
    // file and failed — on the comment above the fix, which quotes the broken form on purpose
    // so the next reader knows what it looked like. A guard that cannot tell code from prose
    // forces you to delete the explanation in order to make it pass, and that is the wrong
    // trade. Strip the comments, then require the statements to be clean.
    const executable = backfillBlock()
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executable).toMatch(/order by id\s+limit 1/u);
    expect(executable).not.toMatch(/\bmin\s*\(\s*id\s*\)/u);
  });

  it('BE-W79: attributes an existing consent notice when one organisation exists', async () => {
    // The twin, `20260908001200_consent_text_versions_tenant.sql`, found by the B6 sweep.
    // Same expression, same uuid column, same early return that kept it from ever running:
    // no migration inserts into `consent_text_versions`, so it is empty on every CI database.
    await inRolledBackTransaction(async (client) => {
      await client.query(
        'alter table public.consent_text_versions alter column organisation_id drop not null',
      );
      // No DELETE here: `consent_text_versions` is append-only and a trigger refuses one for
      // every role. It does not need clearing — it is empty on a fresh database, which is the
      // whole reason this branch has never executed.
      await client.query('delete from public.organisations');
      await client.query("insert into public.organisations (id, name) values ($1, 'Org A')", [
        ORG_A,
      ]);
      await client.query(
        `insert into public.consent_text_versions
           (version_label, language, full_text, effective_from, organisation_id)
         values ('v1', 'en', 'text', now(), null)`,
      );

      const before = await client.query<{ n: string }>(
        `select count(*)::text as n from public.consent_text_versions where organisation_id is null`,
      );
      expect(before.rows[0]?.n).toBe('1');

      await client.query(twinBlock());

      const { rows } = await client.query<{ organisation_id: string | null }>(
        'select organisation_id from public.consent_text_versions',
      );
      expect(rows[0]?.organisation_id).toBe(ORG_A);
    });
  });

  it('no migration anywhere takes min() of an id column', async () => {
    // MR-35 B6. The first instance was found by rehearsing a deploy, which is expensive and
    // only ever covers the migrations in one pending batch. The sweep that followed found a
    // SECOND, identical instance in `20260908001200_consent_text_versions_tenant.sql` —
    // same expression, same uuid column, also guarded behind an early return that meant it
    // had never executed anywhere either.
    //
    // Two instances of one mistake is a shape, not an accident, so the check is the shape
    // rather than the two files. This is the whole sweep, encoded, and it runs on every push.
    const dir = dirname(MIGRATION);
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => {
        const executable = readFileSync(join(dir, name), 'utf8')
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n');
        return /\bmin\s*\(\s*id\s*\)/u.test(executable);
      });
    expect(offenders).toEqual([]);

    await inRolledBackTransaction(async (client) => {
      // And the reason, asserted against the server rather than remembered: if a future
      // PostgreSQL adds min(uuid) this fails and the comment above can be relaxed.
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count
           from pg_proc
          where proname = 'min'
            and 'uuid'::regtype::oid = any (proargtypes)`,
      );
      expect(rows[0]?.count).toBe('0');
    });
  });
});
