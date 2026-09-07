-- Rollback for 20260908000100_sync_pull_cursor_bounds.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores the 20260907001100 body verbatim, which removes all three bounds:
--
--   * a cursor older than half of vacuum_freeze_min_age is accepted again, and a row
--     frozen by VACUUM can then read as already-seen and be silently dropped from the
--     pull. That is a SILENT incomplete answer, which is the failure the bound exists to
--     turn into a loud one (45006).
--   * an oversized cursor is no longer refused before parsing. It is still not truncated
--     -- nothing truncates it -- but the size is unbounded.
--   * completeness.maxCursorAgeTransactions disappears from the response, so a client
--     that had begun reading the limit sees undefined rather than a number.
--
-- Applying this is safe for a client that pulls often; it is not safe for one that has
-- been offline for a long time, which is the case the bound was written for.

create or replace function public.sync_pull(
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
