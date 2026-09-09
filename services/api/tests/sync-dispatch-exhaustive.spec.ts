import { describe, expect, it } from 'vitest';
import { inRolledBackTransaction, requireDatabase } from './db.js';

/**
 * MR-12 Part B — the SQL half of "audit every dispatch site, not just the one that broke".
 *
 * MR-09 made `sendFor` exhaustive after a queued check-out was replayed as a check-in.
 * MR-11 gave `applyChanges` a `never` default after finding its bare `else` would have
 * stored every clinic address as a beat plan. Both audits stopped at the site where the
 * defect had been found, and the class kept going.
 *
 * There are two dispatchers in the database on this path. This file proves both of them
 * fail on an entity or a table they do not know, rather than succeeding as the wrong
 * thing — the property TypeScript gives the two client-side dispatchers for free and that
 * SQL has to be given deliberately.
 */

const reachable = await requireDatabase();

describe.skipIf(!reachable)('emit_sync_event refuses a table it has no branch for', () => {
  /**
   * **The defect this replaced.** Both `else` arms read
   *
   *     case tg_table_name when 'visits' then 'visit' else 'beat_plan' end
   *
   * so any table carrying this trigger that was not `doctors`, `clinic_addresses` or
   * `visits` had its rows filed under `beat_plan`. `sync_events_entity_check` permits
   * `beat_plan`, so nothing rejected it.
   *
   * MR-11's record called this arm safe — "its ELSE reads `old.mr_id`, so a trigger added
   * without a branch would raise, loud rather than silent". That holds only for a table
   * with no `mr_id`. Seventeen public tables have one, including `call_reports`,
   * `check_ins`, `check_outs`, `samples_and_inputs`, `recordings` and `voice_notes` —
   * every plausible next candidate for this trigger.
   */
  it('raises rather than filing an unknown table under beat_plan', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `create table public.scratch_dispatch_thing (id uuid primary key, mr_id uuid not null)`,
      );
      await client.query(
        `create trigger scratch_dispatch_sync_event
           after update or delete on public.scratch_dispatch_thing
           for each row execute function public.emit_sync_event()`,
      );
      await client.query(
        `insert into public.scratch_dispatch_thing (id, mr_id)
         select '11111111-1111-1111-1111-111111111111', p.id
           from public.user_profiles p where p.role = 'mr' limit 1`,
      );

      await expect(
        client.query(
          `delete from public.scratch_dispatch_thing
            where id = '11111111-1111-1111-1111-111111111111'`,
        ),
      ).rejects.toMatchObject({
        // 0A000 is the code `apply_sync_item` already raises for an entity it does not
        // accept, and the code `sync_push` maps to `unsupported_entity`. One vocabulary.
        code: '0A000',
        message: expect.stringContaining('no sync entity for table'),
      });
    });
  });

  /**
   * The positive control. A resolver that raised for everything would satisfy the test
   * above and break every real write — which is the failure mode the `sendFor` guard was
   * given a control for in MR-09, for the same reason.
   */
  it('and still resolves each of the four tables that legitimately carry it', async () => {
    await inRolledBackTransaction(async (client) => {
      const resolved = await client.query<{ t: string; entity: string }>(
        `select t, public.sync_entity_for_table(t) as entity
           from unnest(array['visits','beat_plans','doctors','clinic_addresses']) t`,
      );
      expect(Object.fromEntries(resolved.rows.map((r) => [r.t, r.entity]))).toEqual({
        visits: 'visit',
        beat_plans: 'beat_plan',
        doctors: 'doctor',
        clinic_addresses: 'clinic_address',
      });
    });
  });

  /**
   * The mapping and the constraint have to agree. If a table is added to one and not the
   * other the trigger raises at write time instead of at deploy time — later, and on
   * somebody else's handset.
   */
  it('resolves only entities sync_events_entity_check actually admits', async () => {
    await inRolledBackTransaction(async (client) => {
      const admitted = await client.query<{ ok: boolean }>(
        `select bool_and(
                  public.sync_entity_for_table(t) = any (
                    array['visit','beat_plan','doctor','clinic_address']
                  )
                ) as ok
           from unnest(array['visits','beat_plans','doctors','clinic_addresses']) t`,
      );
      expect(admitted.rows[0]?.ok).toBe(true);
    });
  });
});

describe.skipIf(!reachable)('apply_sync_item refuses an entity it has no branch for', () => {
  /**
   * Already guarded before MR-12 — its `case p_entity` ends in
   * `else raise ... using errcode = '0A000'`. Verified rather than assumed, and pinned
   * here so that a future `create or replace` in this chain cannot quietly drop it.
   *
   * This is the B3 answer: SQL's equivalent of the `never` default is an `else` that
   * raises, and the enum argument type is what makes it reachable at all.
   */
  it('raises 0A000 on an enum member with no branch', async () => {
    await inRolledBackTransaction(async (client) => {
      // `recording` requires an uploadGrantId the payload below does not carry, so this
      // exercises the refusal path without needing an enum member that does not exist.
      await expect(
        client.query(
          `select public.apply_sync_item(
                    'recording'::public.sync_entity_kind,
                    '22222222-2222-2222-2222-222222222222'::uuid,
                    '{}'::jsonb)`,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('uploadGrantId') });
    });
  });

  it('and its else arm is still present in the live definition', async () => {
    await inRolledBackTransaction(async (client) => {
      // Read the LIVE definition, not the migration file. This is a `create or replace`
      // chain seven files long; the file that last wrote it is not obvious from the tree,
      // and MR-11 lost half a session to editing a stale copy of `sync_pull`.
      const def = await client.query<{ src: string }>(
        `select pg_get_functiondef(
                  'public.apply_sync_item(public.sync_entity_kind,uuid,jsonb)'::regprocedure
                ) as src`,
      );
      const src = def.rows[0]?.src ?? '';
      expect(src).toContain('is not yet accepted by sync');
      expect(src).toContain("errcode = '0A000'");
    });
  });
});
