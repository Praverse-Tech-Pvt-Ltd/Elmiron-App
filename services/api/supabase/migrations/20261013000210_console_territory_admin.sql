-- `BE-W187` -- territories and their working hours, administered from the console.
--
-- **What existed.** The territory tree was loaded once from the operator's sheet
-- (`check-territory-sheet.mjs` -> `seed:reference`) and changed afterwards only in the SQL editor;
-- per-territory hours were an INSERT the runbook printed (step 3.1). The sheet checker refuses a bad
-- tree by row; nothing refused a bad edit afterwards.
--
-- **The rules, the sheet checker's, now enforced on every edit:**
--   * three levels: a territory with no parent is National, beneath it a Region, beneath that an
--     Area/Territory, and nothing beneath that (`territory_too_deep`);
--   * a code is unique across EVERY company, as `territories_code_key` already is -- checked here
--     case-insensitively, as the sheet checker compares, and stored upper-case;
--   * a code never starts `EXAMPLE-` (the template's own rows);
--   * nothing goes beneath a territory a rep sits on: a rep's territory is the bottom of its branch
--     (`parent_has_reps`), the same rule `validate_console_profile` applies from the other side;
--   * a territory is never DELETED, by anyone. Measured while building this: deleting even an
--     empty territory cascades into `app_thresholds` (`on delete cascade`), whose statement-level
--     `reject_mutation` trigger fires for a ZERO-row delete and refuses it (constraints, "Never use
--     a row-level trigger"). So a delete function would refuse every call; none is offered.
--     A territory no longer used is renamed, and nothing is placed on it.
--
-- **Hours.** `territory_shift_windows` holds a territory's own hours; `resolve_shift_window` walks
-- up to the nearest ancestor that has some, then the company default. The tree read returns both,
-- so the screen shows where each territory's hours come from, not only whether it has its own.
--
-- Reads: an admin sees the company's tree; a field manager sees their own subtree, read-only, which
-- is what `visible_territory_ids` already gives them. A rep is refused.
--
-- Rollback: services/api/rollbacks/20261013000210_console_territory_admin.down.sql

-- ---------------------------------------------------------------------------
-- 1. The tree, with what hangs off each node
-- ---------------------------------------------------------------------------

create or replace function public.console_territory_json(p_territory_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'id',           t.id,
    'parentId',     t.parent_id,
    'name',         t.name,
    'code',         t.code,
    'depth',        public.territory_depth(t.id),
    'children',     (select count(*)::integer from public.territories c where c.parent_id = t.id),
    'activeUsers',  (select count(*)::integer from public.user_profiles p
                      where p.territory_id = t.id and p.is_active),
    'reps',         (select count(*)::integer from public.user_profiles p
                      where p.territory_id = t.id and p.role = 'mr' and p.is_active),
    'doctors',      (select count(*)::integer from public.doctors d where d.territory_id = t.id),
    'ownHours',     (select jsonb_build_object(
                              'shiftStart',     w.shift_start::text,
                              'shiftEnd',       w.shift_end::text,
                              'timezone',       w.timezone,
                              'graceMinutes',   w.grace_minutes,
                              'activeWeekdays', to_jsonb(w.active_weekdays))
                       from public.territory_shift_windows w where w.territory_id = t.id),
    'hours',        (select jsonb_build_object(
                              'shiftStart',     r.shift_start::text,
                              'shiftEnd',       r.shift_end::text,
                              'timezone',       r.timezone,
                              'graceMinutes',   r.grace_minutes,
                              'activeWeekdays', to_jsonb(r.active_weekdays),
                              'source',         r.source,
                              'resolvedFromTerritoryId', r.resolved_from_territory_id)
                       from public.resolve_shift_window(t.id) r))
    from public.territories t
   where t.id = p_territory_id;
$$;

create or replace function public.territory_tree()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.user_profiles p where p.id = (select auth.uid()) and p.is_active;
  if v_me.id is null or v_me.role not in ('admin', 'field_manager') then
    raise exception 'not_an_admin: only an admin or a field manager reads the territory tree'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'canEdit', v_me.role = 'admin',
    'territories', coalesce((
      select jsonb_agg(public.console_territory_json(t.id) order by t.code)
        from public.territories t
       where t.organisation_id = v_me.organisation_id
         and t.id in (select public.visible_territory_ids(v_me.id))), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Writes -- admin only
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_territory(p_name text, p_code text, p_parent_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me     public.user_profiles := public.console_admin();
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_name   text := btrim(coalesce(p_name, ''));
  v_parent public.territories;
  v_reps   integer;
  v_id     uuid;
begin
  if char_length(v_name) not between 1 and 120 then
    raise exception 'territory_name_required: give the territory a name' using errcode = '22023';
  end if;
  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,39}$' then
    raise exception 'territory_code_invalid: a code is 1-40 letters, digits, - or _' using errcode = '22023';
  end if;
  if v_code like 'EXAMPLE-%' then
    raise exception 'territory_code_invalid: EXAMPLE- codes are the template''s example rows'
      using errcode = '22023';
  end if;
  -- Across every company, because `territories_code_key` is. The message names no company.
  if exists (select 1 from public.territories t where upper(t.code) = v_code) then
    raise exception 'territory_code_taken: % is already used -- codes are unique across the whole system', v_code
      using errcode = '23505';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.territories t
     where t.id = p_parent_id and t.organisation_id = v_me.organisation_id;
    if v_parent.id is null then
      raise exception 'territory_not_in_organisation: territory % is not one of your company''s', p_parent_id
        using errcode = '42501';
    end if;
    if public.territory_depth(v_parent.id) >= 3 then
      raise exception 'territory_too_deep: % is an Area/Territory, the lowest level -- nothing goes beneath it', v_parent.code
        using errcode = '22023';
    end if;
    select count(*) into v_reps from public.user_profiles p
     where p.territory_id = v_parent.id and p.role = 'mr';
    if v_reps > 0 then
      raise exception 'parent_has_reps: % rep(s) are placed on % -- a rep''s territory stays the lowest level; move them first', v_reps, v_parent.code
        using errcode = '22023';
    end if;
  end if;

  insert into public.territories (name, code, parent_id, organisation_id)
  values (v_name, v_code, p_parent_id, v_me.organisation_id)
  returning id into v_id;

  return public.console_territory_json(v_id);
end;
$$;

create or replace function public.admin_rename_territory(p_territory_id uuid, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me   public.user_profiles := public.console_admin();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 120 then
    raise exception 'territory_name_required: give the territory a name' using errcode = '22023';
  end if;
  update public.territories set name = v_name
   where id = p_territory_id and organisation_id = v_me.organisation_id;
  if not found then
    raise exception 'territory_not_in_organisation: territory % is not one of your company''s', p_territory_id
      using errcode = '42501';
  end if;
  return public.console_territory_json(p_territory_id);
end;
$$;

-- A territory's own hours. Clearing them (`admin_clear_territory_hours`) makes it inherit again.
create or replace function public.admin_set_territory_hours(
  p_territory_id    uuid,
  p_shift_start     time,
  p_shift_end       time,
  p_timezone        text,
  p_grace_minutes   integer,
  p_active_weekdays smallint[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles := public.console_admin();
begin
  if not exists (select 1 from public.territories t
                  where t.id = p_territory_id and t.organisation_id = v_me.organisation_id) then
    raise exception 'territory_not_in_organisation: territory % is not one of your company''s', p_territory_id
      using errcode = '42501';
  end if;
  if p_shift_start is null or p_shift_end is null or p_shift_end <= p_shift_start then
    raise exception 'hours_invalid: the day ends after it starts, on the same day' using errcode = '22023';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'timezone_unknown: % is not a time zone name', coalesce(p_timezone, '(empty)')
      using errcode = '22023';
  end if;
  if p_grace_minutes is null or p_grace_minutes not between 0 and 240 then
    raise exception 'grace_invalid: grace is 0 to 240 minutes' using errcode = '22023';
  end if;
  if p_active_weekdays is null or cardinality(p_active_weekdays) not between 1 and 7
     or not (p_active_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]) then
    raise exception 'weekdays_invalid: choose at least one working day' using errcode = '22023';
  end if;

  insert into public.territory_shift_windows
    (territory_id, shift_start, shift_end, timezone, grace_minutes, active_weekdays)
  values
    (p_territory_id, p_shift_start, p_shift_end, p_timezone, p_grace_minutes,
     (select array_agg(distinct d order by d) from unnest(p_active_weekdays) d))
  on conflict (territory_id) do update
     set shift_start = excluded.shift_start, shift_end = excluded.shift_end,
         timezone = excluded.timezone, grace_minutes = excluded.grace_minutes,
         active_weekdays = excluded.active_weekdays;

  return public.console_territory_json(p_territory_id);
end;
$$;

create or replace function public.admin_clear_territory_hours(p_territory_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me public.user_profiles := public.console_admin();
begin
  if not exists (select 1 from public.territories t
                  where t.id = p_territory_id and t.organisation_id = v_me.organisation_id) then
    raise exception 'territory_not_in_organisation: territory % is not one of your company''s', p_territory_id
      using errcode = '42501';
  end if;
  delete from public.territory_shift_windows w where w.territory_id = p_territory_id;
  return public.console_territory_json(p_territory_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.console_territory_json(uuid) from public, anon, authenticated;

revoke execute on function public.territory_tree() from public, anon;
revoke execute on function public.admin_create_territory(text, text, uuid) from public, anon;
revoke execute on function public.admin_rename_territory(uuid, text) from public, anon;
revoke execute on function public.admin_set_territory_hours(uuid, time, time, text, integer, smallint[]) from public, anon;
revoke execute on function public.admin_clear_territory_hours(uuid) from public, anon;

grant execute on function public.territory_tree() to authenticated;
grant execute on function public.admin_create_territory(text, text, uuid) to authenticated;
grant execute on function public.admin_rename_territory(uuid, text) to authenticated;
grant execute on function public.admin_set_territory_hours(uuid, time, time, text, integer, smallint[]) to authenticated;
grant execute on function public.admin_clear_territory_hours(uuid) to authenticated;
