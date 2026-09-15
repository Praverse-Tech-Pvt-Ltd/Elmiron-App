import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { DB_URL, requireDatabase, withClient } from './db.js';

/**
 * `BE-W76` / `BE-W79`, MR-35 B4 — the two migration backfills that branch on existing data.
 *
 * **Why this file exists.** `20260908000800_user_profiles_organisation.sql` carried a comment
 * claiming its single-organisation branch was "exercised only by its test". There was no such
 * test, and the branch did not work: it called `min(id)` on a `uuid` column, and PostgreSQL has
 * no `min` aggregate for `uuid`, so it raised `42883` the moment it was reached. MR-34 found it
 * by rehearsing the deploy; MR-35 fixed it, found an identical second instance in
 * `20260908001200_consent_text_versions_tenant.sql`, and wrote this.
 *
 * **Why no test could have caught it before.** A backfill executes ONCE, at migration time. By
 * the time any suite runs, `schema_migrations` already holds the version and nothing will apply
 * it again. And on a fresh database — which is every CI database — both blocks return
 * immediately, because there is nothing to backfill. **The branches that matter are unreachable
 * from CI's migration run by construction.**
 *
 * ## Why these run in a database of their own
 *
 * Both blocks branch on **whole-table counts** — how many organisations exist, how many rows
 * need attributing. The shared test database carries committed fixtures from other files, so
 * the branch taken here would depend on what else had run.
 *
 * Two earlier approaches were tried and both were wrong, each caught by running rather than by
 * reasoning:
 *
 * 1. **Clear the tables first.** Not permitted: `app_thresholds.set_by_user_id` references
 *    `user_profiles` `ON DELETE SET NULL`, and `app_thresholds` is append-only, so deleting a
 *    profile raises *"app_thresholds is append-only: UPDATE is not permitted by any role"*. It
 *    passed alone and failed in the full run.
 * 2. **Build a schema inside the shared database.** Abandoned as an unnecessary risk: it put
 *    DDL in a transaction alongside `tenant-boundary-restrictive.spec.ts`, which creates tables
 *    and policies of its own.
 *
 *    **A correction belongs here, because the first version of this comment got it wrong.** The
 *    deadlocks seen while developing this file were blamed on it, on the strength of three
 *    clean runs with the file removed against two failures in four with it. Widening the
 *    baseline to seven runs showed the deadlock in **two of seven with this file absent
 *    entirely** — same test, same `mirrorTable` line. It is PRE-EXISTING and unrelated (see
 *    `docs/gotchas.md`). Three runs was not a baseline, it was a coincidence, and "the fix
 *    worked" would have been evidence for a diagnosis that was false.
 *
 * So this file creates its OWN DATABASE, which shares no catalog with anything else running.
 * The pattern is `verify-backup.mjs`'s: create a scratch database, refuse to reuse an existing
 * one, drop it afterwards. Inside it, each test builds the two or three tables the block
 * touches and rewrites the `public.` qualifier — the ONLY edit made to the shipped SQL, and it
 * is made to text read out of the migration file at run time rather than to a copy kept here.
 * A copy would pass forever while the migration drifted away from it, which is the same class
 * of mistake as the comment this file replaces.
 *
 * **What this deliberately does NOT claim to prove:** that the block works against the real
 * schema with its triggers and constraints. That was proven the only way it can be — by
 * applying the 37 pending migrations to a database seeded to meet each precondition, in MR-35
 * B4, recorded in `PROJECT-OVERVIEW.md`.
 */

const reachable = await requireDatabase();

const MIGRATIONS = dirname(
  join(fileURLToPath(import.meta.url), '../../supabase/migrations/placeholder'),
);
const ORG_BACKFILL = join(MIGRATIONS, '20260908000800_user_profiles_organisation.sql');
const NOTICE_BACKFILL = join(MIGRATIONS, '20260908001200_consent_text_versions_tenant.sql');

/**
 * The `do` block from a migration, anchored on a declaration unique to it so it cannot silently
 * match a neighbouring block. Throws rather than returning nothing, because a test that
 * extracted the wrong block would pass while measuring something else.
 */
const doBlock = (file: string, anchor: string): string => {
  const blocks = [...readFileSync(file, 'utf8').matchAll(/do \$\$[\s\S]*?\$\$;/gu)].map(
    (m) => m[0],
  );
  const block = blocks.find((b) => b.includes(anchor));
  if (block === undefined) {
    throw new Error(
      `Could not find the \`do\` block containing "${anchor}" in ${file}. This suite asserts the ` +
        'SHIPPED SQL; if the migration was restructured, re-anchor this extractor rather than ' +
        'deleting the assertion.',
    );
  }
  return block;
};

const SCHEMA = 'backfill';
const SCRATCH = 'mr35_backfill_test';
const ORG_A = '22222222-2222-2222-2222-222222222222';
const ORG_B = '33333333-3333-3333-3333-333333333333';
const ADMIN = '11111111-1111-1111-1111-111111111111';

/** Run the block against `SCHEMA` instead of `public`. The only edit made to the shipped SQL. */
const against = (block: string): string => block.replaceAll('public.', `${SCHEMA}.`);

const scratchUrl = (): string => {
  const url = new URL(DB_URL);
  url.pathname = `/${SCRATCH}`;
  return url.toString();
};

/**
 * A transaction on the SCRATCH database, always rolled back.
 *
 * Deliberately not `inRolledBackTransaction`, which targets the shared database — the whole
 * point of this file is that its DDL must not share a catalog with the rest of the suite.
 */
const inScratch = async (fn: (client: Client) => Promise<void>): Promise<void> => {
  const client = new Client({ connectionString: scratchUrl() });
  await client.connect();
  try {
    await client.query('begin');
    await fn(client);
  } finally {
    try {
      await client.query('rollback');
    } catch {
      // Already failing, or the connection is gone. The original exception wins.
    }
    try {
      await client.end();
    } catch {
      // Nothing useful to add if tearing down the connection itself fails.
    }
  }
};

beforeAll(async () => {
  if (!reachable) return;
  await withClient(async (client) => {
    // Refuse to reuse one, the same way `verify-backup.mjs` refuses to restore over an existing
    // database: a leftover from an interrupted run would make every assertion below meaningless.
    const { rows } = await client.query('select 1 from pg_database where datname = $1', [SCRATCH]);
    if (rows.length > 0) await client.query(`drop database ${SCRATCH}`);
    await client.query(`create database ${SCRATCH}`);
  });

  const client = new Client({ connectionString: scratchUrl() });
  await client.connect();
  try {
    await client.query(`create schema ${SCHEMA}`);
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (!reachable) return;
  await withClient(async (client) => {
    await client.query(`drop database if exists ${SCRATCH}`);
  });
});

const buildSchema = async (client: Client, organisations: number): Promise<void> => {
  await client.query(
    `create table ${SCHEMA}.organisations (id uuid primary key, name text not null)`,
  );
  await client.query(
    `create table ${SCHEMA}.user_profiles (
       id uuid primary key, full_name text not null, role text not null,
       territory_id uuid, organisation_id uuid)`,
  );
  await client.query(
    `create table ${SCHEMA}.consent_text_versions (
       id uuid primary key default gen_random_uuid(), version_label text not null,
       language text not null, full_text text not null, organisation_id uuid)`,
  );

  await client.query(`insert into ${SCHEMA}.organisations (id, name) values ($1, 'Org A')`, [
    ORG_A,
  ]);
  if (organisations > 1) {
    await client.query(`insert into ${SCHEMA}.organisations (id, name) values ($1, 'Org B')`, [
      ORG_B,
    ]);
  }

  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from ${SCHEMA}.organisations`,
  );
  expect(rows[0]?.n).toBe(String(organisations));
};

const addOrphanProfile = async (client: Client): Promise<void> => {
  await client.query(
    `insert into ${SCHEMA}.user_profiles (id, full_name, role, territory_id, organisation_id)
     values ($1, 'MR-35 Admin', 'admin', null, null)`,
    [ADMIN],
  );
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from ${SCHEMA}.user_profiles where organisation_id is null`,
  );
  expect(rows[0]?.n).toBe('1');
};

describe.skipIf(!reachable)('BE-W76 — the user_profiles organisation backfill', () => {
  const block = (): string => against(doBlock(ORG_BACKFILL, 'v_orphans'));

  it('assigns the territory-less user when exactly one organisation exists', async () => {
    await inScratch(async (client) => {
      await buildSchema(client, 1);
      await addOrphanProfile(client);

      await client.query(block());

      const { rows } = await client.query<{ organisation_id: string | null }>(
        `select organisation_id from ${SCHEMA}.user_profiles where id = $1`,
        [ADMIN],
      );
      expect(rows[0]?.organisation_id).toBe(ORG_A);
    });
  });

  it('refuses, rather than guessing, when more than one organisation exists', async () => {
    await inScratch(async (client) => {
      await buildSchema(client, 2);
      await addOrphanProfile(client);

      // Choosing an organisation for an administrator is choosing whose data they may read.
      await expect(client.query(block())).rejects.toMatchObject({ code: '23502' });
    });
  });

  it('does nothing when there are no territory-less users — the only path CI runs', async () => {
    await inScratch(async (client) => {
      // Two organisations AND no orphans. The refusal above would fire if the early return were
      // removed, so this is the positive control for that return rather than a smoke test.
      await buildSchema(client, 2);

      await expect(client.query(block())).resolves.toBeDefined();
    });
  });
});

describe.skipIf(!reachable)('BE-W79 — the consent notice attribution backfill', () => {
  const block = (): string => against(doBlock(NOTICE_BACKFILL, 'v_rows'));

  it('attributes an existing notice when exactly one organisation exists', async () => {
    await inScratch(async (client) => {
      await buildSchema(client, 1);
      await client.query(
        `insert into ${SCHEMA}.consent_text_versions (version_label, language, full_text)
         values ('v1', 'en', 'text')`,
      );

      await client.query(block());

      const { rows } = await client.query<{ organisation_id: string | null }>(
        `select organisation_id from ${SCHEMA}.consent_text_versions`,
      );
      expect(rows[0]?.organisation_id).toBe(ORG_A);
    });
  });

  it('refuses when more than one organisation could own the notice', async () => {
    await inScratch(async (client) => {
      await buildSchema(client, 2);
      await client.query(
        `insert into ${SCHEMA}.consent_text_versions (version_label, language, full_text)
         values ('v1', 'en', 'text')`,
      );

      await expect(client.query(block())).rejects.toMatchObject({ code: '23502' });
    });
  });

  it('does nothing when there are no notices to attribute', async () => {
    await inScratch(async (client) => {
      await buildSchema(client, 2);
      await expect(client.query(block())).resolves.toBeDefined();
    });
  });
});

describe('min() of a uuid, which PostgreSQL does not have', () => {
  it('is used by no migration in this repository', () => {
    // MR-35 B6. The first instance was found by rehearsing a deploy, which is expensive and only
    // ever covers one pending batch. The sweep that followed found a SECOND, identical instance
    // behind its own early return, which also had never executed anywhere. Two instances of one
    // mistake is a shape, not an accident, so the check is the shape rather than the two files.
    //
    // Comments are stripped first. An earlier version matched the whole file and failed — on the
    // comment above the fix, which quotes the broken form on purpose so the next reader knows
    // what it looked like. A guard that cannot tell code from prose makes you delete the
    // explanation in order to go green, and that is the wrong trade.
    const offenders = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => {
        const executable = readFileSync(join(MIGRATIONS, name), 'utf8')
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('--'))
          .join('\n');
        return /\bmin\s*\(\s*id\s*\)/u.test(executable);
      });
    expect(offenders).toEqual([]);
  });

  it('is absent from the catalogue, which is why the shipped form is a subquery', async () => {
    await inScratch(async (client) => {
      // Asserted against the server rather than remembered: if a future PostgreSQL adds
      // min(uuid), this fails and the rule above can be relaxed deliberately.
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from pg_proc
          where proname = 'min' and 'uuid'::regtype::oid = any (proargtypes)`,
      );
      expect(rows[0]?.count).toBe('0');
    });
  });

  it('is replaced by an ordered subquery in both backfills', () => {
    for (const file of [ORG_BACKFILL, NOTICE_BACKFILL]) {
      expect(readFileSync(file, 'utf8')).toMatch(/order by id\s+limit 1/u);
    }
  });
});
