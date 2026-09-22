-- Rollback for MR-47 C -- BE-W107, the one day rule.
--
-- WHAT APPLYING THIS MEANS: the two copies of the day rule come back, and so does the
-- hard-coded India zone in coverage(). The MR's screen and the manager's report will disagree
-- again for every MR whose territory is not configured in India time. Both bodies below are
-- the catalogue's definitions from before 20260921000200, byte for byte. A client built after
-- MR-47 reads `visit_day` from the pull; with this applied it gets none, and its route counts
-- no visit as on any day until a client that reckons the day itself is shipped.

drop function public.coverage(date, date);

CREATE OR REPLACE FUNCTION public.coverage(p_from date, p_to date)
 RETURNS TABLE(mr_id uuid, coverage_date date, planned_visit_count integer, actual_visit_count integer, missed_visit_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '10s'
AS $function$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  scope as (
    select p.id from public.user_profiles p
     where p.id in (select public.visible_user_ids()) and p.role = 'mr'
  ),
  planned as (
    select bp.mr_id, bp.plan_date, e.doctor_id
      from public.beat_plan_current bp
      join public.beat_plan_entries e on e.beat_plan_id = bp.id
  ),
  actual as (
    select v.mr_id,
           (v.completed_at at time zone 'Asia/Kolkata')::date as d,
           v.doctor_id
      from public.visits v
     where v.status = 'completed' and v.completed_at is not null
  )
  select s.id,
         days.d,
         (select count(*)::integer from planned p where p.mr_id = s.id and p.plan_date = days.d),
         (select count(*)::integer from actual a where a.mr_id = s.id and a.d = days.d),
         -- Planned doctors with no completed visit that day. A missed visit is a
         -- doctor who was on the plan and was not seen, not a count difference.
         (select count(*)::integer
            from planned p
           where p.mr_id = s.id and p.plan_date = days.d
             and not exists (
               select 1 from actual a
                where a.mr_id = s.id and a.d = days.d and a.doctor_id = p.doctor_id))
    from scope s cross join days
   order by days.d desc, s.id;
$function$;

revoke execute on function public.coverage(date, date) from public, anon;
grant execute on function public.coverage(date, date) to authenticated;

CREATE OR REPLACE FUNCTION public.sync_pull(p_cursor text DEFAULT NULL::text, p_entities text[] DEFAULT NULL::text[], p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'beat_plan_entry', 'doctor',
                                      'clinic_address', 'consent_text_version'];
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

  if p_cursor is null or btrim(p_cursor) = '' then
    v_cursor := null;
  else
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

  v_freeze_limit := (current_setting('vacuum_freeze_min_age')::bigint) / 2;

  if v_since is not null then
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

  with candidates as (
    select 'visit'::text as entity, v.id, v.updated_at, v.xmin, 'upserted'::text as reason,
           to_jsonb(v) as payload
      from public.visits v
     where 'visit' = any(v_want)
    union all
    select 'beat_plan', b.id, b.updated_at, b.xmin, 'upserted', to_jsonb(b)
      from public.beat_plans b
     where 'beat_plan' = any(v_want)
    union all
    -- MR-44 / BE-W89. Its OWN arm, carrying no predicate, exactly like the clinic_address
    -- arm: this function is SECURITY INVOKER, so `beat_plan_entries_select_via_plan` does
    -- the scoping, through the plan's `mr_id` and `visible_user_ids()`. An entry has no
    -- `mr_id` of its own, which is precisely why it must NOT grow a hand-written predicate
    -- here: that would be a second copy of a boundary that already has one home.
    select 'beat_plan_entry', e.id, e.updated_at, e.xmin, 'upserted', to_jsonb(e)
      from public.beat_plan_entries e
     where 'beat_plan_entry' = any(v_want)
    union all
    select 'doctor', d.id, d.updated_at, d.xmin, 'upserted', to_jsonb(d)
      from public.doctors d
     where 'doctor' = any(v_want)
    union all
    -- MR-11 / BE-W87. Its OWN arm, so RLS scopes it through
    -- `clinic_addresses_select_visible_doctor` exactly as the doctor arm is scoped -- this
    -- function is SECURITY INVOKER, which is why neither arm carries a predicate. And so a
    -- clinic edit moves its own `updated_at`, rather than depending on a trigger to bump a
    -- parent row that would otherwise never change.
    select 'clinic_address', a.id, a.updated_at, a.xmin, 'upserted', to_jsonb(a)
      from public.clinic_addresses a
     where 'clinic_address' = any(v_want)
    union all
    -- MR-26 B1. The consent NOTICE travels with the pull so a doctor can be asked with no
    -- signal.
    --
    -- `apps/field/src/consent/notices.ts` called `active_consent_text` live, so an MR in a
    -- basement clinic could not put the question at all -- the screen rendered "the app could
    -- not reach the server" and the visit ended without an answer either way.
    --
    -- **This does NOT reopen MR-12 Q4.** That decision kept `consent_record` out of the pull
    -- and it stands, for the reason it gave: ~3,000 audit rows a day per entity, for value
    -- that is reinstall-only. A consent TEXT VERSION carries neither cost -- there are two in
    -- this tenant, they are immutable except for `effective_until`, and they change when a
    -- company publishes a new notice. `consent_record` remains in `c_omitted` below.
    --
    -- **No predicate, deliberately, exactly like the two arms above.** This function is
    -- SECURITY INVOKER, so `consent_text_versions_select_own_tenant` (permissive) and
    -- `consent_text_versions_tenant_boundary` (RESTRICTIVE) scope this arm. Adding
    -- `organisation_id = ...` here would be a second, unguarded copy of a rule the database
    -- owns -- which is what BE-W79 exists to prevent.
    --
    -- `full_text` rides along inside `to_jsonb`. That is the point: the client cannot show a
    -- doctor a notice it does not hold, and FIX-02's rule is unchanged -- the client still
    -- captures against a version id the SERVER issued, and `capture_consent` still
    -- re-resolves at `captured_at` and refuses 45001 if the two disagree.
    select 'consent_text_version', t.id, t.updated_at, t.xmin, 'upserted',
           -- MR-27 B1. The SERVER's precedence rides with the row, so the client never
           -- re-derives the ordering. See the migration header for why this is a RANK and
           -- not an `is_active` flag.
           to_jsonb(t) || jsonb_build_object('precedence', p.precedence)
      from public.consent_text_versions t
      join public.consent_text_version_precedence p on p.id = t.id
     where 'consent_text_version' = any(v_want)
    union all
    -- Tombstones and leave-scope, merged into the same ordering so a client cannot see a
    -- delete out of order with the update that preceded it.
    --
    -- `v_since is not null` is section 1's second protection: a full re-sync is a client
    -- rebuilding from nothing, so a tombstone could only tell it about records it never
    -- held. RLS on sync_events is the first protection and does the real work.
    --
    -- `age(...) < v_freeze_limit` keeps the guarantee between purge runs: an event older
    -- than the oldest acceptable cursor has already reached everyone entitled to it.
    select e.entity, e.entity_id, e.occurred_at, e.xmin, e.reason, null::jsonb
      from public.sync_events e
     where v_since is not null
       and e.entity = any(v_want)
       and age(e.xmin::text::xid) < v_freeze_limit
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
                'reason',    p.reason,
                -- Null for a tombstone, and that is the payload-free property expressed
                -- in the wire format rather than only in the table.
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
      'phase', 2,
      -- Phase 2 shrinks this, and `omits` empties. A completeness field that does not
      -- move as the capability grows becomes a lie in the other direction: a client that
      -- keeps warning about missing deletes after they arrive is as wrong as one that
      -- never warned.
      'reflects', case
        when v_since is null
          then jsonb_build_array('insert', 'update')
          else jsonb_build_array('insert', 'update', 'delete', 'out_of_scope')
        end,
      'omits', case
        when v_since is null
          then jsonb_build_array('delete', 'out_of_scope')
          else jsonb_build_array()
        end,
      'entities', to_jsonb(c_entities),
      'omittedEntities', to_jsonb(c_omitted),
      'maxCursorAgeTransactions', v_freeze_limit,
      'note', case
        when v_since is null
          then 'This is a full re-sync and carries no deletions: everything you are '
               'entitled to see is in the stream, so anything absent from it is gone. '
               'Replace your local state rather than merging into it.'
          else 'Deletions arrive as payload-free tombstones and records that left your '
               'scope arrive as out_of_scope. Consent records and analyses are not '
               'carried by this pull at all.'
        end
    )
  );
end;
$function$;

drop function public.visit_day(public.visits);
drop function public.day_zone_for(uuid);
