import { beforeAll, describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';
import { asOwner } from './auth.js';
import { seedFixtures } from './fixtures.js';
import type { FixtureWorld } from './fixtures.js';

/**
 * MR-18 A2 — the load-bearing predicates can actually fail.
 *
 * `docs/gotchas.md` carries the rule: **a predicate over `A AND B` is only falsifiable if
 * the pair varies within the scope it reads.** It also carries the query that finds
 * violations. **A query in a document is a written lesson, and a written lesson is not a
 * control** — this repository has six worked examples of that and the rule itself says so.
 * This is the control.
 *
 * **Only the predicates that carry compliance weight.** MR-16 B4 found five single-valued
 * columns and most are harmless: `call_reports.status` being always `submitted` costs
 * nothing today. Asserting all of them would make this file noise, and noise gets deleted.
 * The ones here decide who can see a record, which notice a doctor was shown, and which
 * one was active when they were shown it.
 *
 * **Scoped to the fixture's own organisation, not to the database.** Running the naive
 * global query on a working database reads `MIN languages per org = 1`, because a
 * long-lived local database accumulates tenants from `seed:day` and older runs, and a
 * single-language demo tenant is CORRECT. A test that failed on those would be measuring
 * the wrong scope and would be weakened or deleted within a session. The predicate reads
 * one organisation at a time, so the assertion does too — which is the same reasoning the
 * rule is about, applied to the test rather than to the fixture.
 */

// Awaited at module scope, matching every other database spec here. `requireDatabase()`
// returns whether the database is reachable and hard-fails in CI when it is not, so a
// green run always means these actually executed rather than skipped.
const reachable = await requireDatabase();

let world: FixtureWorld;

beforeAll(async () => {
  if (!reachable) return;
  world = await seedFixtures();
}, 60_000);

describe('the predicates that decide who sees what can be falsified', () => {
  it('TENANT — a second organisation exists AND holds rows of its own', async () => {
    // `organisation_id = X` is the RESTRICTIVE tenant boundary. With one organisation,
    // every isolation test ever written was asserting that an MR could not see rows that
    // DID NOT EXIST -- green for twenty sessions and proving nothing, until MR-06 added
    // the rival. The second half matters as much as the first: a rival with no rows under
    // it restores exactly the same hole.
    expect(world.rivalOrganisationId).not.toBe(world.organisationId);

    await inRolledBackTransaction(async (client) => {
      await asOwner(client, async () => {
        const rows = await client.query<{ organisation_id: string; n: string }>(
          `select organisation_id, count(*)::text as n from public.doctors
            where organisation_id in ($1, $2) group by 1`,
          [world.organisationId, world.rivalOrganisationId],
        );
        expect(rows.rows.length, 'one of the two tenants holds no doctors').toBe(2);
        for (const row of rows.rows) {
          expect(Number(row.n), `tenant ${row.organisation_id} has no rows`).toBeGreaterThan(0);
        }
      });
    });
  });

  it('LANGUAGE — the fixture tenant holds more than one, so the clause can discriminate', async () => {
    // `and v.language = p_language`, INSIDE `and v.organisation_id = p_organisation_id`.
    // `freshLanguage()` already varied language per TEST and it still hid: the pair is
    // (organisation, language), and each tenant held exactly one language. Deleting the
    // clause left 30 consent cases green.
    await inRolledBackTransaction(async (client) => {
      await asOwner(client, async () => {
        const rows = await client.query<{ n: string }>(
          `select count(distinct language)::text as n from public.consent_text_versions
            where organisation_id = $1`,
          [world.organisationId],
        );
        expect(
          Number(rows.rows[0]?.n),
          'this tenant holds one language again; the language clause cannot fail',
        ).toBeGreaterThan(1);
      });
    });
  });

  it('ACTIVE-AT — the tenant holds notices with different effective_from', async () => {
    // `and v.effective_from <= p_at ... order by v.effective_from desc`. This is the clause
    // that decides which notice was active AT THE MOMENT OF CAPTURE, which is the whole of
    // FIX-12 and the reason 45001 exists. With every notice sharing one `effective_from`,
    // "the newest active one" and "any of them" are the same answer and the ordering is
    // untested.
    await inRolledBackTransaction(async (client) => {
      await asOwner(client, async () => {
        const rows = await client.query<{ n: string }>(
          `select count(distinct effective_from)::text as n from public.consent_text_versions
            where organisation_id = $1`,
          [world.organisationId],
        );
        expect(
          Number(rows.rows[0]?.n),
          'every notice shares one effective_from; the active-at ordering cannot fail',
        ).toBeGreaterThan(1);
      });
    });
  });

  it('and the newest notice is in a DIFFERENT language from the oldest', async () => {
    // The two dimensions have to vary TOGETHER, not merely both be present. If the newest
    // and oldest notices shared a language, deleting the language clause would still return
    // the same row and the mutation would pass -- the pair would not vary even though each
    // column does. This is the property MR-16 B2's mutation actually depends on.
    await inRolledBackTransaction(async (client) => {
      await asOwner(client, async () => {
        const rows = await client.query<{ language: string }>(
          `select language from public.consent_text_versions
            where organisation_id = $1 order by effective_from desc`,
          [world.organisationId],
        );
        expect(rows.rows.length).toBeGreaterThan(1);
        expect(
          rows.rows[0]?.language,
          'newest and oldest share a language; deleting the language clause would be undetectable',
        ).not.toBe(rows.rows[rows.rows.length - 1]?.language);
      });
    });
  });
});

/**
 * The fourth load-bearing dimension — the UTC offset — is NOT asserted here, and this
 * records why rather than leaving it as an omission.
 *
 * The defect was client-side: `services/mock` renders `+05:30` and Supabase renders
 * `+00:00`, and `clockFrom` sliced characters on the stated belief that the offset was
 * always the territory's. There is no SQL predicate on the offset to falsify — the
 * rendering happens in PostgREST and the reading happens in the app. The assertion that
 * both renderings are exercised therefore lives where the data does, in
 * `apps/field/src/today/territory-day.test.ts`.
 *
 * The related SERVER-side dimension, `territory_shift_windows.timezone`, is single-valued
 * (`Asia/Kolkata` everywhere) and is deliberately left that way for now: the second fixture
 * window is `06:00-10:00` with zero grace, and moving its timezone shifts which captures
 * fall inside the shift window across every capture suite. That is a fixture change with a
 * blast radius, not a one-line addition, and it is registered in the MR-16 B4 sweep rather
 * than attempted here. The client-side day boundary is covered directly by
 * `territory-day.test.ts`, which exercises Asia/Kolkata, America/Denver and UTC.
 */
