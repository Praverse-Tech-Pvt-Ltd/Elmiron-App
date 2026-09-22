-- ============================================================================
-- MR-47 C -- BE-W107: ONE rule for which day a visit belongs to, and no hard-coded India time.
-- ============================================================================
--
-- WHAT WAS WRONG
--
-- Two copies of the rule, already different:
--
--   coverage()            (v.completed_at at time zone <India, hard-coded>)::date
--   the MR's beat plan    dayIn(completedAt ?? startedAt ?? scheduledFor, <territory zone>)
--
-- The client's zone comes from my_shift_window() -> resolve_shift_window(<the MR's territory>),
-- falling back to UTC, labelled, when none is configured. coverage() ignored the territory
-- entirely. So for an MR with no configured hours the route's day ended at 05:30 IST and the
-- manager's report's day at midnight IST, and for a territory in any other zone they disagreed
-- all day.
--
-- WHAT THIS DOES
--
-- * `day_zone_for(mr)` -- the zone a given MR's day is reckoned in, by EXACTLY my_shift_window()'s
--   rule: the MR's territory, only for an active profile, through resolve_shift_window(); else
--   'UTC' with source 'fallback_utc'.
-- * `visit_day(visit)` -- coalesce(completed_at, started_at, scheduled_for) in that zone. The
--   instant order is the one the route used; for a COMPLETED visit it is completed_at, which is
--   what coverage() counted, so coverage's counts change only where the zone does.
-- * coverage() counts completed visits by visit_day(), and now RETURNS the zone and its source
--   per MR, so a fallback is labelled on the report as it is on the screen.
-- * sync_pull() sends `visit_day` on every visit. The client uses it and no longer reckons a
--   visit's day itself -- the consent-precedence pattern (MR-27): the server sends the answer.
--
-- WHAT THE MANAGER'S REPORT WILL SHOW DIFFERENTLY
--
-- * An MR whose territory is configured in India time: nothing changes.
-- * An MR in a territory configured in another zone: visits count on that zone's date.
-- * An MR with NO configured hours: visits count on the UTC date, and the row says
--   `fallback_utc`. A visit completed between 00:00 and 05:30 IST moves to the previous day.
--   That is the answer the MR's own screen already gives; the fix for both is configuring the
--   hours (`org_default_shift_window` is null today), not a second hard-coded zone.
--
-- The helpers take an MR id, and a SECURITY DEFINER function taking a caller-supplied id is how
-- BE-W106 leaked. They cannot simply be revoked: sync_pull() is SECURITY INVOKER -- it runs as
-- the MR, under RLS -- so it needs EXECUTE on visit_day(). (The first draft revoked them, and
-- the MR-47 C4 spec failed with `permission denied for function visit_day` -- the test found it.)
-- So day_zone_for() REFUSES an MR outside the caller's visible_user_ids(), with 42501, rather
-- than answering. With no signed-in user (the owner, scripts, SECURITY DEFINER callers that
-- carry no claims) there is no caller to scope, and it answers.

create or replace function public.day_zone_for(p_mr_id uuid)
returns table (time_zone text, source text)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_territory uuid;
  v_zone      text;
begin
  if (select auth.uid()) is not null
     and p_mr_id not in (select public.visible_user_ids()) then
    raise exception 'not permitted to read the day zone of that user'
      using errcode = '42501';
  end if;

  select p.territory_id into v_territory
    from public.user_profiles p
   where p.id = p_mr_id and p.is_active;

  if v_territory is not null then
    select w.timezone into v_zone from public.resolve_shift_window(v_territory) w;
  end if;

  if v_zone is null then
    return query select 'UTC'::text, 'fallback_utc'::text;
  else
    return query select v_zone, 'territory'::text;
  end if;
end;
$$;

create or replace function public.visit_day(p_visit public.visits)
returns date
language sql
stable
security definer
set search_path to ''
as $$
  select (coalesce(p_visit.completed_at, p_visit.started_at, p_visit.scheduled_for)
            at time zone z.time_zone)::date
    from public.day_zone_for(p_visit.mr_id) z;
$$;

revoke execute on function public.day_zone_for(uuid) from public, anon;
revoke execute on function public.visit_day(public.visits) from public, anon;
grant execute on function public.day_zone_for(uuid) to authenticated;
grant execute on function public.visit_day(public.visits) to authenticated;

-- coverage() gains two columns, so it is dropped and recreated with its grant.
drop function public.coverage(date, date);

create function public.coverage(p_from date, p_to date)
returns table (mr_id uuid, coverage_date date, planned_visit_count integer,
               actual_visit_count integer, missed_visit_count integer,
               day_zone text, day_zone_source text)
language sql
stable
security definer
set search_path to ''
set statement_timeout to '10s'
as $$
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
    -- BE-W107. The day is visit_day(), the same function sync_pull sends the MR.
    select v.mr_id, public.visit_day(v) as d, v.doctor_id
      from public.visits v
     where v.status = 'completed' and v.completed_at is not null
       and v.mr_id in (select id from scope)
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
                where a.mr_id = s.id and a.d = days.d and a.doctor_id = p.doctor_id)),
         z.time_zone,
         z.source
    from scope s
    cross join days
    cross join lateral public.day_zone_for(s.id) z
   order by days.d desc, s.id;
$$;

revoke execute on function public.coverage(date, date) from public, anon;
grant execute on function public.coverage(date, date) to authenticated;

-- sync_pull(): unchanged except the visit payload, which now carries visit_day.
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
           -- BE-W107 (MR-47). The server sends the visit's day; the client does not reckon it.
           to_jsonb(v) || jsonb_build_object('visit_day', public.visit_day(v)) as payload
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

-- ---- postconditions: this migration asserts its own result ----
do $$
begin
  if has_function_privilege('anon', 'public.day_zone_for(uuid)', 'execute')
     or has_function_privilege('anon', 'public.visit_day(public.visits)', 'execute') then
    raise exception 'MR-47 C: a day-rule helper is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.visit_day(public.visits)', 'execute') then
    raise exception 'MR-47 C: sync_pull runs as the caller and cannot reach visit_day()';
  end if;
  if position('visible_user_ids' in pg_get_functiondef('public.day_zone_for(uuid)'::regprocedure)) = 0 then
    raise exception 'MR-47 C: day_zone_for() answers for any MR id';
  end if;
  if not has_function_privilege('authenticated', 'public.coverage(date, date)', 'execute') then
    raise exception 'MR-47 C: coverage() lost its authenticated grant in the recreate';
  end if;
  if has_function_privilege('anon', 'public.coverage(date, date)', 'execute') then
    raise exception 'MR-47 C: anon can execute coverage()';
  end if;
  if position('Kolkata' in pg_get_functiondef('public.coverage(date, date)'::regprocedure)) > 0 then
    raise exception 'MR-47 C: coverage() still hard-codes India time';
  end if;
  if position('visit_day' in pg_get_functiondef('public.sync_pull(text, text[], integer)'::regprocedure)) = 0 then
    raise exception 'MR-47 C: sync_pull() does not send visit_day';
  end if;
end;
$$;
