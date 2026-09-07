-- Rollback for 20260908000300_sync_pull_phase2.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Removes tombstones and leave-scope entirely and restores the phase 1 body from
-- 20260908000100 verbatim -- including its completeness object, which goes back to
-- declaring that deletes and out_of_scope are OMITTED. That is the important part: the
-- response keeps telling the truth in both directions. A rollback that removed the
-- capability while leaving the field claiming phase 2 would be worse than either state.
--
-- Order matters. The triggers are dropped BEFORE the table, because an AFTER DELETE
-- trigger inserting into a table that no longer exists fails every delete on visits,
-- beat_plans and doctors -- which would take the write path down with the sync feature.
--
-- The events themselves are destroyed with the table. They carry an id, a type, a reason
-- class and a scope key and nothing else, so nothing personal is lost; what IS lost is
-- every handset's ability to learn about deletions that happened while it was offline.
-- Any client that has already been told deletes are reflected will silently stop hearing
-- about them, so ship a client that reads the completeness field before applying this.

drop trigger if exists visits_sync_events on public.visits;
drop trigger if exists beat_plans_sync_events on public.beat_plans;
drop trigger if exists doctors_sync_events on public.doctors;
drop function if exists public.emit_sync_event();
drop function if exists public.purge_expired_sync_events();
drop table if exists public.sync_events;

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
