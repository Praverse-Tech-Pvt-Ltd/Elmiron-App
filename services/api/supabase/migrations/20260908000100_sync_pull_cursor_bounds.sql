-- ============================================================================
-- BE-W61 (2 of 2) · The snapshot cursor's limits, made explicit and enforced
--
-- `20260907001100` made the pull loss-free by carrying transaction snapshots instead of
-- a timestamp watermark. That mechanism is bounded rather than unbounded in three ways.
-- Two of them are enforced here; the third is stated in the record because it needs no
-- work at this product's volume and should not be discovered at year three.
--
-- ----------------------------------------------------------------------------
-- 1. FROZEN ROWS, AND WHY THIS BOUND EXISTS EVEN THOUGH THE HAZARD IS NARROW
-- ----------------------------------------------------------------------------
--
-- `pg_visible_in_snapshot(xid8, pg_snapshot)` is a pure function of its two arguments and
-- never consults the heap, so freezing cannot change its answer for a given `xmin`. And
-- measured on this schema's Postgres 17, `xmin` survives both operations that might have
-- been expected to rewrite it:
--
--   insert                -> xmin 1293
--   vacuum freeze         -> xmin 1293   (freezing sets HEAP_XMIN_FROZEN hint bits)
--   vacuum full (rewrite) -> xmin 1293
--
-- So the everyday case is safe. **The hazard is real anyway**, because there are paths
-- (`heap_prepare_freeze_tuple` replacing `t_xmin` with `FrozenTransactionId`, tuples
-- carried through certain upgrades) where a genuinely frozen tuple reads as `xmin = 2`.
-- A frozen xid is visible in EVERY snapshot, so such a row reads as "already seen in
-- `since`" and is silently excluded from the pull. **Silently** is the operative word:
-- the client gets a well-formed, incomplete answer with no way to tell.
--
-- Verifying the frozen case directly needs 50,000,000 transactions to pass, which is not
-- something this session can produce, so the behaviour of `xmin` for a truly frozen tuple
-- is **UNVERIFIED here** and taken from the documented freeze machinery. The bound below
-- does not depend on which way that goes.
--
-- **The bound, and it is a proof rather than a safety margin.** A row this pull still owes
-- the client changed AFTER the cursor was issued, so its `xmin` is newer than the cursor's
-- and therefore `age(row.xmin) < age(cursor.xmin)`. A tuple cannot be frozen until
-- `age(xmin) >= vacuum_freeze_min_age`. Therefore while
--
--     age(cursor_since_xmin) < vacuum_freeze_min_age
--
-- no row the client is owed can have been frozen, whatever freezing does to `xmin`. Past
-- that point the cursor is refused with SQLSTATE 45006 and the client is told to re-sync
-- from scratch — which is a complete answer, where a silent omission is not.
--
-- The threshold is read from the server's own `vacuum_freeze_min_age` rather than written
-- here as a number, so it cannot drift away from the setting it is derived from. Half of
-- it is used, as margin for a per-table `autovacuum_freeze_min_age` override; none of the
-- three tables in the pull sets one today (`select relname, reloptions from pg_class where
-- relnamespace = 'public'::regnamespace and reloptions is not null` returns zero rows) and
-- a future one would have to be lower than half the global setting to defeat this.
--
-- ----------------------------------------------------------------------------
-- 2. CURSOR SIZE, WHICH IS BOUNDED BY max_connections
-- ----------------------------------------------------------------------------
--
-- The cursor carries two `pg_snapshot`s rendered as text, `xmin:xmax:xip_list`. Only the
-- `xip_list` grows, and it holds one xid per transaction in flight when the snapshot was
-- taken — which cannot exceed `max_connections` (100 on this stack). So:
--
--     per snapshot  <= 2 * 10 digits + 2 colons + max_connections * 11 bytes  ~= 1,122 B
--     whole cursor  <= two of those + a uuid + a timestamp + JSON keys        ~= 2,400 B
--
-- The cap below is 8,192 bytes: several times the arithmetic bound, so it can only be hit
-- by something that is not a cursor this server issued. **It refuses rather than
-- truncating.** A truncated snapshot still parses — `xmin:xmax:` with a short `xip_list`
-- is a syntactically valid snapshot describing a different set of in-flight transactions —
-- so truncation would produce a plausible cursor with a wrong answer, which is the worst
-- available outcome.
--
-- ----------------------------------------------------------------------------
-- 3. TRANSACTION ID WRAPAROUND — stated, not enforced
-- ----------------------------------------------------------------------------
--
-- `xmin` is a 32-bit `xid` and the cast to `xid8` cannot recover the epoch, so comparisons
-- are meaningful only while the database has not wrapped 2^32 transactions since the
-- cursor was issued. At 100 MRs writing a few thousand rows a day that is years away, and
-- the freeze bound in section 1 fires first in every realistic ordering — `age()` itself
-- is wraparound-aware, so a cursor old enough to matter is refused as expired long before
-- its raw value becomes ambiguous. The assumption is recorded in `docs/adr-sync-pull.md`
-- and registered as BE-W68 rather than left for somebody to find.
--
-- Rollback: services/api/rollbacks/20260908000100_sync_pull_cursor_bounds.down.sql
-- ============================================================================

create or replace function public.sync_pull(
  p_cursor   text    default null,
  p_entities text[]  default null,
  p_limit    integer default 200
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  -- Several times the arithmetic bound of section 2, so only a cursor this server did not
  -- issue can reach it.
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'doctor'];
  c_omitted  constant text[] := array['consent_record', 'analysis', 'call_report',
                                      'check_in', 'check_out', 'sample_and_input',
                                      'voice_note', 'recording'];
  v_uid          uuid;
  v_lim          integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_cursor       jsonb;
  v_since        pg_snapshot;
  v_upto         pg_snapshot;
  v_after_u      timestamptz;
  v_after_i      uuid;
  v_want         text[];
  v_rows         jsonb;
  v_has_more     boolean;
  v_last_u       timestamptz;
  v_last_i       uuid;
  v_freeze_limit bigint;
  v_since_age    bigint;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- ---- the cursor -----------------------------------------------------------
  if p_cursor is null or btrim(p_cursor) = '' then
    v_cursor := null;
  else
    -- Size first, before anything tries to parse it. Refuse, never truncate.
    if octet_length(p_cursor) > c_max_cursor_bytes then
      raise exception 'sync cursor is not recognised' using errcode = '45005',
        detail = format('cursor is %s bytes, the maximum is %s',
                        octet_length(p_cursor), c_max_cursor_bytes),
        hint = 'Start again with a null cursor. This is a full re-sync, not an error you can retry.';
    end if;

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

  -- ---- section 1: is the cursor still younger than the freeze horizon? -------
  --
  -- SQLSTATE 45006, reserved in 20260907001100 for exactly this and deliberately not
  -- minted until it could be raised. It is distinct from 45005 because the remedies read
  -- the same to a machine and not to a person: 45005 means the cursor is wrong, 45006
  -- means it was right and is now too old, which is the difference between a bug and a
  -- handset that was in a drawer.
  if v_since is not null then
    v_freeze_limit := (current_setting('vacuum_freeze_min_age')::bigint) / 2;
    v_since_age := age(pg_snapshot_xmin(v_since)::text::xid);
    if v_since_age >= v_freeze_limit then
      raise exception 'sync cursor is older than this server will vouch for'
        using errcode = '45006',
              detail = format(
                'cursor is %s transactions old; the limit is %s, half of vacuum_freeze_min_age',
                v_since_age, v_freeze_limit),
              hint = 'Pull again with a null cursor. Past this age a row frozen by VACUUM '
                     'could read as already-seen, and an incomplete answer that looks '
                     'complete is worse than starting over.';
    end if;
  end if;

  if v_upto is null then
    v_upto    := pg_current_snapshot();
    v_after_u := null;
    v_after_i := null;
  end if;

  v_want := coalesce(p_entities, c_entities);

  -- ---- the changes ----------------------------------------------------------
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
     limit v_lim + 1
  ),
  page as (
    select * from changed order by updated_at, id limit v_lim
  )
  select
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'entity',    p.entity,
                'entityId',  p.id,
                'reason',    'upserted',
                'payload',   p.payload,
                'updatedAt', p.updated_at
              ) order by p.updated_at, p.id)
         from page p),
      '[]'::jsonb),
    (select count(*) from changed) > v_lim
  into v_rows, v_has_more;

  if jsonb_array_length(v_rows) > 0 then
    v_last_u := (v_rows -> -1 ->> 'updatedAt')::timestamptz;
    v_last_i := (v_rows -> -1 ->> 'entityId')::uuid;
  end if;

  return jsonb_build_object(
    'changes', v_rows,
    'hasMore', v_has_more,
    'serverTime', now(),
    'nextCursor',
      case
        when v_has_more then
          jsonb_build_object('v', 1, 'since', v_since::text, 'upto', v_upto::text,
                             'after', jsonb_build_object('u', v_last_u, 'i', v_last_i))::text
        else
          jsonb_build_object('v', 1, 'since', v_upto::text, 'upto', null,
                             'after', null)::text
      end,
    'completeness', jsonb_build_object(
      'phase', 1,
      'reflects', jsonb_build_array('insert', 'update'),
      'omits', jsonb_build_array('delete', 'out_of_scope'),
      'entities', to_jsonb(c_entities),
      'omittedEntities', to_jsonb(c_omitted),
      -- The maximum age is reported so a client can see the limit before it hits it,
      -- for the same reason `org_default_shift_window_status()` exists: a bound only
      -- discoverable by tripping over it is a worse bound.
      'maxCursorAgeTransactions', (current_setting('vacuum_freeze_min_age')::bigint) / 2,
      'note', 'Deletions and records that left your scope are NOT reflected. A record '
              'removed on the server, or reassigned away from you, will keep appearing '
              'until a full re-sync. Do not present this as a current view.'
    )
  );
end;
$$;

comment on function public.sync_pull(text, text[], integer) is
  'BE-W61 phase 1. Inserts and updates only, scoped by RLS, paginated on a total '
  '(updated_at, id) order, and made loss-free by carrying two transaction snapshots '
  'rather than a timestamp watermark. Bounded three ways: a cursor older than half of '
  'vacuum_freeze_min_age is refused with 45006 rather than risking a frozen row reading '
  'as already-seen, a cursor over 8 KB is refused with 45005 rather than truncated, and '
  'the xid wraparound assumption is recorded in docs/adr-sync-pull.md. Every response '
  'carries a completeness object saying that deletes and leave-scope are absent.';
