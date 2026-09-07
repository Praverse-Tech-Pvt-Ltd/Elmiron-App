-- ============================================================================
-- BE-W61 · `sync_pull`, phase 1 — inserts and updates only, and it says so
--
-- `sync_push` has existed since BE-W5 with 40 tests. `sync_pull` has existed on neither
-- side: no function, no view, no table, and `apps/field/src/sync/` is entirely outbox.
-- The app promises an MR a notification "when tomorrow's visits are ready, and when a
-- manager changes them", and without a pull it can never learn that either happened.
--
-- `docs/adr-sync-pull.md` recommends shipping an updates-only pull first and warns it is
-- **worse than nothing if it ships silently**, because an MR watching their list update
-- will reasonably conclude it is current. Both halves are requirements here: §4 below is
-- the machine-readable half of the warning.
--
-- ----------------------------------------------------------------------------
-- 1. HOLE ONE: rows sharing updated_at could not paginate
-- ----------------------------------------------------------------------------
--
-- The contract's `since: IsoDateTime` cannot express a position INSIDE a group of rows
-- that share one `updated_at`, so a page boundary landing in such a group either repeats
-- rows or skips them, and `hasMore` is unactionable without somewhere to resume from.
--
-- Fixed with a composite ordering key `(updated_at, id)` carried in an opaque cursor.
-- `id` is a primary key, so the order is TOTAL: no two rows can tie, and the comparison
-- `(updated_at, id) > (last_updated_at, last_id)` is exact rather than approximate.
--
-- ----------------------------------------------------------------------------
-- 2. HOLE TWO: a row committed during a pull was lost permanently
-- ----------------------------------------------------------------------------
--
-- This is the one that loses data silently and is discovered months later as "a visit
-- that never synced", so the reasoning is written out rather than summarised.
--
-- `updated_at` is stamped with `now()`, which is TRANSACTION START time. A transaction
-- that begins at 10:00:00 and commits at 10:00:05 writes rows stamped 10:00:00. A pull at
-- 10:00:02 cannot see them — they are uncommitted — and if it advances a timestamp
-- watermark to 10:00:02, the next pull asks for changes after 10:00:02 and **those rows
-- are never returned again.** No amount of care with the timestamp fixes this, because
-- the timestamp is written before the visibility it is standing in for.
--
-- **Rejected: an overlap window** — re-request the last N seconds each time. The ADR
-- rejects it explicitly and it is worth repeating: N is a guess, and when the guess is
-- wrong the data loss is silent. That is the failure mode this project has spent ten
-- sessions removing.
--
-- **Rejected: a monotonic sequence column.** ADR §2.1(c) claims "commit order and
-- sequence order agree". **They do not.** `nextval()` is evaluated when the row is
-- written, not when the transaction commits, so a long transaction takes a low sequence
-- number and commits after a short one that took a higher one. A cursor above that value
-- misses the row for ever — the identical defect, at the cost of a column, an index and a
-- trigger on every synced table. That correction belongs on the record.
--
-- **Chosen: the transaction snapshot.** The cursor carries two snapshots — `since`, from
-- the end of the previous sweep, and `upto`, taken once at the start of this one — and a
-- row is returned when its `xmin` is NOT visible in `since` and IS visible in `upto`:
--
--     not pg_visible_in_snapshot(xmin, since) and pg_visible_in_snapshot(xmin, upto)
--
-- A transaction still in flight when `since` was taken is by definition not visible in
-- it, so whenever it commits the row it wrote qualifies. **Nothing can be missed**,
-- regardless of how long a writing transaction runs, because visibility is what is being
-- tested rather than a value written inside it. Every UPDATE writes a new row version
-- with a new `xmin`, so "changed since" and "not visible then, visible now" are the same
-- question.
--
-- Two snapshots rather than one because a sweep may span pages: `upto` is frozen for the
-- whole sweep, so a row committed between page 1 and page 3 cannot appear on page 3 with
-- a lower `(updated_at, id)` than page 1 already passed. It is picked up by the next
-- sweep, whose `since` is this sweep's `upto`.
--
-- The cost is duplicates, never omissions: a row written by a transaction in flight
-- across a sweep boundary can be returned twice. A pull consumer must upsert, which it
-- must anyway.
--
-- **KNOWN BOUND, and it is UNVERIFIED beyond arithmetic.** `xmin` is a 32-bit `xid` and
-- the cast to `xid8` cannot recover the epoch, so this comparison is only meaningful
-- while the database has not wrapped 2^32 transactions since the cursor was issued. At
-- this product's write volume that is years, and the remedy — a cursor the server no
-- longer recognises, answered with a full re-sync — is the same remedy the tombstone
-- window will need. What is NOT implemented is detecting it: phase 1 has no way to tell a
-- wrapped cursor from a valid one. Registered rather than hidden.
--
-- ----------------------------------------------------------------------------
-- 3. SCOPE, AND WHY THIS ONE IS security invoker
-- ----------------------------------------------------------------------------
--
-- BE-W64 made `search_doctors` `security definer` because RLS made its ILIKE unindexable.
-- **The opposite choice is right here**, and the difference is worth stating so the two
-- do not look inconsistent:
--
--   * `search_doctors` needed an index on a non-leakproof predicate, which RLS forbids.
--     `sync_pull` filters on a snapshot function over an already-scoped row set; the
--     indexable part IS the scope, so RLS costs nothing.
--   * `security definer` means transcribing three tables' policies into one body, and a
--     transcription error is a cross-territory data leak. Here there is no reason to
--     take that risk.
--
-- So the policies scope this: `visits_select_own_or_team`, `beat_plans_select_own_or_team`
-- (both `mr_id in (select visible_user_ids())`) and `doctors_select_in_territory`. An MR
-- outside the subtree gets an ABSENCE, not a refusal — see §6.
--
-- **The moment consent_records or analyses enter this pull, it must become
-- `security definer`**, because every read of those is required to write an audit row
-- first and Postgres has no SELECT trigger. That is the engineering consequence of ADR
-- §5 question 4, and it is why they are not here.
--
-- ----------------------------------------------------------------------------
-- 4. WHAT THIS PULL DOES NOT DO, AS A FIELD
-- ----------------------------------------------------------------------------
--
-- Every response carries a `completeness` object naming what is reflected and what is
-- omitted. **A field, not a comment**, and required rather than optional, so a client
-- that parses the response cannot avoid receiving it and cannot tell "complete" from
-- "incomplete" by version-sniffing.
--
-- Deletes and leave-scope are absent because they need answers this repository does not
-- have: how long a record of a deleted thing may be kept, whether a consent tombstone
-- conflicts with the withdrawal promise, and whether an MR who loses a territory keeps
-- its doctors on their handset. Those are ADR §5 questions 1 and 2 — legal and product,
-- not engineering.
--
-- Rollback: services/api/rollbacks/20260907001100_sync_pull_phase1.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5. Refusal code
-- ----------------------------------------------------------------------------
--
-- 45005, continuing the project-defined range 45001-45004 from FIX-02, FIX-06 and
-- BE-W21. A table read can only ever refuse with RLS 42501, which is why this is an RPC:
-- "your cursor is not one I issued" has a remedy the client can act on — start again with
-- a null cursor — and 42501 does not.
--
-- 45006, "cursor expired, re-sync from scratch", is deliberately NOT minted here. It
-- becomes meaningful when tombstones acquire a retention window, and a code that can
-- never be raised is the same class of thing as an index that can never be used.

create function public.sync_pull(
  p_cursor   text    default null,
  p_entities text[]  default null,
  p_limit    integer default 200
)
returns jsonb
language plpgsql
volatile              -- pg_current_snapshot() is volatile; so is this
security invoker      -- deliberate, see section 3
set search_path = ''
as $$
declare
  c_entities constant text[] := array['visit', 'beat_plan', 'doctor'];
  c_omitted  constant text[] := array['consent_record', 'analysis', 'call_report',
                                      'check_in', 'check_out', 'sample_and_input',
                                      'voice_note', 'recording'];
  v_uid       uuid;
  v_lim       integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_cursor    jsonb;
  v_since     pg_snapshot;
  v_upto      pg_snapshot;
  v_after_u   timestamptz;
  v_after_i   uuid;
  v_want      text[];
  v_rows      jsonb;
  v_count     integer;
  v_last_u    timestamptz;
  v_last_i    uuid;
  v_has_more  boolean;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- ---- the cursor -----------------------------------------------------------
  if p_cursor is null or btrim(p_cursor) = '' then
    v_cursor := null;
  else
    begin
      v_cursor := p_cursor::jsonb;
    exception when others then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end;
    if coalesce((v_cursor->>'v')::integer, 0) <> 1 then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        detail = format('cursor version %s, this server issues version 1', coalesce(v_cursor->>'v', 'absent')),
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end if;
  end if;

  begin
    v_since   := nullif(v_cursor->>'since', '')::pg_snapshot;
    v_upto    := nullif(v_cursor->>'upto', '')::pg_snapshot;
    v_after_u := nullif(v_cursor#>>'{after,u}', '')::timestamptz;
    v_after_i := nullif(v_cursor#>>'{after,i}', '')::uuid;
  exception when others then
    raise exception 'sync cursor is not recognised' using errcode = '45005',
      hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
  end;

  -- A fresh sweep takes a fresh `upto`. A continuing sweep keeps the one it was given,
  -- which is what stops a row committed mid-sweep from landing behind the page pointer.
  if v_upto is null then
    v_upto    := pg_current_snapshot();
    v_after_u := null;
    v_after_i := null;
  end if;

  v_want := coalesce(p_entities, c_entities);

  -- ---- the changes ----------------------------------------------------------
  --
  -- One statement, because a CTE does not survive to the next one in plpgsql and the
  -- page has to be built, counted and probed for `hasMore` against the SAME evaluation.
  -- Building it twice would let the two disagree.
  with candidates as (
    select 'visit'::text as entity, v.id, v.updated_at, v.xmin, to_jsonb(v) as payload
      from public.visits v
     where 'visit' = any(v_want)
    union all
    select 'beat_plan', b.id, b.updated_at, b.xmin, to_jsonb(b)
      from public.beat_plans b
     where 'beat_plan' = any(v_want)
    union all
    select 'doctor', d.id, d.updated_at, d.xmin, to_jsonb(d)
      from public.doctors d
     where 'doctor' = any(v_want)
  ),
  changed as (
    select c.*
      from candidates c
     where pg_visible_in_snapshot(c.xmin::text::xid8, v_upto)
       and (v_since is null or not pg_visible_in_snapshot(c.xmin::text::xid8, v_since))
       and (v_after_u is null or (c.updated_at, c.id) > (v_after_u, v_after_i))
     order by c.updated_at, c.id
     limit v_lim + 1          -- one more than asked for, so hasMore is measured
  ),
  page as (
    select * from changed order by updated_at, id limit v_lim
  )
  select
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'entity',    p.entity,
                'entityId',  p.id,
                -- Phase 1 emits this and only this. `completeness.omits` below is the
                -- machine-readable statement that the other two exist and are absent.
                'reason',    'upserted',
                'payload',   p.payload,
                'updatedAt', p.updated_at
              ) order by p.updated_at, p.id)
         from page p),
      '[]'::jsonb),
    (select count(*) from changed) > v_lim
  into v_rows, v_has_more;

  -- The cursor resumes from the LAST ROW OF THE PAGE, read back off the payload rather
  -- than recomputed, so the two can never disagree about where the page ended.
  if jsonb_array_length(v_rows) > 0 then
    v_last_u := (v_rows -> -1 ->> 'updatedAt')::timestamptz;
    v_last_i := (v_rows -> -1 ->> 'entityId')::uuid;
  end if;

  return jsonb_build_object(
    'changes', v_rows,
    'hasMore', v_has_more,
    -- The server's clock, and NOT the thing a client stores. It looks like a watermark
    -- and is exactly the trap section 2 describes; the cursor is the only thing that
    -- should be persisted.
    'serverTime', now(),
    'nextCursor',
      case
        when v_has_more then
          -- Same sweep: keep both snapshots, advance the page pointer.
          jsonb_build_object('v', 1, 'since', v_since::text, 'upto', v_upto::text,
                             'after', jsonb_build_object('u', v_last_u, 'i', v_last_i))::text
        else
          -- Sweep complete: this sweep's `upto` becomes the next sweep's `since`, and the
          -- next call takes a fresh `upto`.
          jsonb_build_object('v', 1, 'since', v_upto::text, 'upto', null,
                             'after', null)::text
      end,
    'completeness', jsonb_build_object(
      'phase', 1,
      'reflects', jsonb_build_array('insert', 'update'),
      -- Required, not optional. A client that parses this response cannot avoid
      -- receiving it, and cannot tell a complete pull from an incomplete one by
      -- guessing at the server version.
      'omits', jsonb_build_array('delete', 'out_of_scope'),
      'entities', to_jsonb(c_entities),
      'omittedEntities', to_jsonb(c_omitted),
      'note', 'Deletions and records that left your scope are NOT reflected. A record '
              'removed on the server, or reassigned away from you, will keep appearing '
              'until a full re-sync. Do not present this as a current view.'
    )
  );
end;
$$;

revoke execute on function public.sync_pull(text, text[], integer) from public, anon;
grant execute on function public.sync_pull(text, text[], integer) to authenticated;

comment on function public.sync_pull(text, text[], integer) is
  'BE-W61 phase 1. Inserts and updates only, scoped by RLS, paginated on a total '
  '(updated_at, id) order, and made loss-free by carrying two transaction snapshots '
  'rather than a timestamp watermark: a row is returned when its xmin is not visible in '
  'the previous sweep''s snapshot and is visible in this one, so a transaction still in '
  'flight cannot be skipped. Every response carries a completeness object saying that '
  'deletes and leave-scope are absent -- a field rather than a comment, because a pull '
  'presented as current when it is not is worse than no pull.';
