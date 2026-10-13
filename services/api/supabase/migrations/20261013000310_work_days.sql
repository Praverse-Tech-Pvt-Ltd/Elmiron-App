-- `BE-W190` -- the rep's WORKING DAY becomes a server record: opened, ended, and reopened only by
-- the rep's manager or an admin, with a reason. `BE-W191` -- the manager sees the team's days.
--
-- **What existed.** A day-end SUMMARY screen (`apps/field/app/day-end.tsx`): the day's visits from
-- the pull, the distance from `daily_mileage`, the queue. It wrote nothing. Nothing on the server
-- said a rep's day had started or finished; "Day End" was a screen, not an act. The live-tracking
-- shell (`apps/field/src/integrations/tracking.ts`) already takes a `dayOpen` input, and nothing
-- could answer it.
--
-- **What the design documents say, and where they are silent.** The operator lists "Day End" as a
-- must-have (`docs/operator/must-haves.json`, OP-4) and the tracking design has the rep start
-- sharing "at the start of the working day" (`docs/ai-platform/LIVE-TRACKING-DESIGN.md`). Neither
-- says what a day IS on the server. The simplest correct design, chosen here:
--
--   * ONE row per rep per territory-date (`work_days`, unique `(mr_id, work_date)`). The date is
--     reckoned in the rep's zone by `day_zone_unchecked` -- the one rule `visit_day()`,
--     `daily_mileage` and `rep_today` already use; no second zone rule is minted.
--   * OPENED by the rep's first check-in of that date (a trigger on `check_ins`, so every path
--     opens it), or by an explicit "start my day" (`open_work_day`). The server stamps `opened_at`;
--     the phone's instant is kept beside it as `client_opened_at`, never instead of it.
--   * CLOSED by the rep (`close_work_day`): server-stamped `closed_at`, the phone's instant beside
--     it, an optional note, and a SNAPSHOT of the day's totals taken by the server at that moment.
--   * A CLOSED DAY REFUSES NEW CHECK-INS for that date (45015). The refusal is a trigger on
--     `check_ins`, not a line in `record_check_in`, so no path -- RPC, sync, owner -- walks past it.
--   * Closing is IDEMPOTENT: an already-closed day is returned as it is, and a replay of a close a
--     manager has since undone does not close the day again.
--   * A day cannot be closed while one of its visits is still CHECKED IN (45016): the rep checks
--     out first. Closing does not invent a check-out -- a departure is a fact only the rep witnessed.
--   * REOPENED only by the rep's field manager or an admin of the company, with a reason. The undone
--     close is kept, whole, in `work_day_reopenings` (append-only, audited). An admin reopening a
--     day is not authorship of field activity (`constraints.md`): it writes no visit, check-in or
--     report, only lifts the refusal so the rep can record what they did.
--
-- **Through the outbox.** A rep ends their day in places with no signal, so it is a `sync_push`
-- entity (`work_day`, added in `20261013000300`), dispatched by `apply_sync_item` to the same two
-- functions a direct call reaches. And the record rides `sync_pull`, so the phone learns the
-- server's verdict -- and the tracking rule can read whether the day is open -- from the pulled
-- store. A row's open/closed state CHANGES THE ROW (its `updated_at` moves), so it may travel on
-- the cursor; it is not a clock-derived property (`constraints.md`, "A property that depends on
-- the clock cannot ride sync_pull").
--
-- Rollback: services/api/rollbacks/20261013000310_work_days.down.sql

-- ---------------------------------------------------------------------------
-- 1. The record
-- ---------------------------------------------------------------------------

create table public.work_days (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  -- The rep's territory when the day opened. Informational: the DATE is what the day is keyed on.
  territory_id      uuid references public.territories (id) on delete restrict,
  work_date         date not null,
  -- The zone `work_date` was reckoned in, kept so a later change of territory hours cannot make
  -- the record mean a different span of time from the one it was opened for.
  time_zone         text not null,
  opened_at         timestamptz not null default clock_timestamp(),
  opened_via        text not null check (opened_via in ('check_in', 'start', 'day_end')),
  client_opened_at  timestamptz,
  open_request_id   uuid,
  closed_at         timestamptz,
  close_request_id  uuid,
  client_closed_at  timestamptz,
  closing_note      text check (closing_note is null or char_length(closing_note) between 1 and 1000),
  -- The snapshot, taken by the SERVER when the day closed. Null while the day is open.
  visits_total      integer check (visits_total >= 0),
  visits_completed  integer check (visits_completed >= 0),
  visits_not_met    integer check (visits_not_met >= 0),
  visits_missed     integer check (visits_missed >= 0),
  visits_unplanned  integer check (visits_unplanned >= 0),
  check_in_count    integer check (check_in_count >= 0),
  distance_metres   double precision check (distance_metres >= 0),
  samples_quantity  integer check (samples_quantity >= 0),
  inputs_quantity   integer check (inputs_quantity >= 0),
  reopen_count      integer not null default 0 check (reopen_count >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint work_days_one_per_rep_day unique (mr_id, work_date),
  -- A close is WHOLE or absent: no closed day without its stamp, its request and its snapshot, and
  -- no open day carrying the leftovers of a close.
  constraint work_days_close_is_whole check (
    (closed_at is null and close_request_id is null and client_closed_at is null
       and closing_note is null and visits_total is null and visits_completed is null
       and visits_not_met is null and visits_missed is null and visits_unplanned is null
       and check_in_count is null and distance_metres is null and samples_quantity is null
       and inputs_quantity is null)
    or
    (closed_at is not null and close_request_id is not null and client_closed_at is not null
       and visits_total is not null and visits_completed is not null and visits_not_met is not null
       and visits_missed is not null and visits_unplanned is not null and check_in_count is not null
       and distance_metres is not null and samples_quantity is not null
       and inputs_quantity is not null)),
  constraint work_days_closed_after_opened check (closed_at is null or closed_at >= opened_at)
);

create index work_days_organisation_date_idx on public.work_days (organisation_id, work_date);

-- An undone close, kept whole. Append-only: a reopening is never edited and never removed.
create table public.work_day_reopenings (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  work_day_id         uuid not null references public.work_days (id) on delete restrict,
  mr_id               uuid not null references public.user_profiles (id) on delete restrict,
  work_date           date not null,
  reopened_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  reason              text not null check (char_length(btrim(reason)) between 3 and 500),
  -- The close this undid: its stamp, its request (so a replay of it cannot close the day again)
  -- and its snapshot, exactly as the rep's day stood.
  closed_at           timestamptz not null,
  close_request_id    uuid not null,
  closed_snapshot     jsonb not null,
  created_at          timestamptz not null default clock_timestamp(),
  constraint work_day_reopenings_not_by_the_rep check (reopened_by_user_id <> mr_id)
);

create index work_day_reopenings_work_day_idx on public.work_day_reopenings (work_day_id);

create trigger work_days_set_updated_at before update on public.work_days
  for each row execute function public.set_updated_at();

-- A day is never deleted: a closed one is evidence, an open one is what refuses nothing yet.
create trigger work_days_reject_delete
  before delete or truncate on public.work_days
  for each statement execute function public.reject_mutation();
create trigger work_day_reopenings_reject_mutation
  before update or delete or truncate on public.work_day_reopenings
  for each statement execute function public.reject_mutation();

create trigger work_days_audit after insert or update on public.work_days
  for each row execute function public.write_audit_row();
create trigger work_day_reopenings_audit after insert on public.work_day_reopenings
  for each row execute function public.write_audit_row();

-- ---------------------------------------------------------------------------
-- 2. Boundary
-- ---------------------------------------------------------------------------
-- Read: the rep, and whoever may see the rep (`visible_user_ids`: their managers, their admins).
-- Write: nobody directly. Every write is one of the functions below.

alter table public.work_days enable row level security;
alter table public.work_days force row level security;
alter table public.work_day_reopenings enable row level security;
alter table public.work_day_reopenings force row level security;

revoke all on table public.work_days from anon, authenticated;
revoke all on table public.work_day_reopenings from anon, authenticated;
revoke delete, truncate on table public.work_days from service_role;
revoke update, delete, truncate on table public.work_day_reopenings from service_role;

create policy work_days_select_scope on public.work_days
  for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy work_day_reopenings_select_scope on public.work_day_reopenings
  for select to authenticated
  using (mr_id in (select public.visible_user_ids()));

create policy work_days_tenant_boundary on public.work_days
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy work_day_reopenings_tenant_boundary on public.work_day_reopenings
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

grant select on table public.work_days to authenticated;
grant select on table public.work_day_reopenings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A check-in opens the day, and a closed day refuses it
-- ---------------------------------------------------------------------------
-- On `check_ins` itself, BEFORE INSERT, so every path that records an arrival passes through it:
-- `record_check_in` (direct and through `sync_push`), and the owner. A replayed check-in never
-- reaches it -- `record_check_in` returns the stored row before inserting.
--
-- `for share` on the day's row: a close holds it `for update` while it counts the day's checked-in
-- visits, so a check-in racing a close waits, re-reads, and is refused rather than slipping a
-- visit into a day that has just been snapshotted.

create or replace function public.work_day_on_check_in()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_zone      text;
  v_date      date;
  v_day       public.work_days;
  v_org       uuid;
  v_territory uuid;
begin
  select z.time_zone into v_zone from public.day_zone_unchecked(new.mr_id) z;
  v_date := (new.occurred_at at time zone v_zone)::date;

  select * into v_day from public.work_days w
   where w.mr_id = new.mr_id and w.work_date = v_date
   for share;

  if v_day.id is not null then
    if v_day.closed_at is not null then
      raise exception 'work_day_closed: your working day % was ended at %, so a check-in on it is refused',
        v_date, v_day.closed_at
        using errcode = '45015',
              detail = format('day %s, ended %s', v_date, v_day.closed_at),
              hint = 'If this visit really happened on that day, ask your manager to reopen the day.';
    end if;
    return new;
  end if;

  select p.organisation_id, p.territory_id into v_org, v_territory
    from public.user_profiles p where p.id = new.mr_id;
  -- No organisation, no tenant to file the day under (MR-06: no organisation, no scope). Such a
  -- rep cannot end a day either (`work_day_rep`), so there is nothing a missing row would hide.
  if v_org is null then
    return new;
  end if;

  insert into public.work_days (organisation_id, mr_id, territory_id, work_date, time_zone,
                                opened_via, client_opened_at)
  values (v_org, new.mr_id, v_territory, v_date, v_zone, 'check_in', new.occurred_at)
  on conflict (mr_id, work_date) do nothing;
  return new;
end;
$$;

revoke execute on function public.work_day_on_check_in() from public, anon, authenticated;

create trigger check_ins_work_day
  before insert on public.check_ins
  for each row execute function public.work_day_on_check_in();

-- ---------------------------------------------------------------------------
-- 4. Who, which day, and what the day held
-- ---------------------------------------------------------------------------

-- The caller, if they are an active rep of an organisation; otherwise a refusal. A working day is
-- the rep's own: a manager or an admin never opens or ends one for them.
create or replace function public.work_day_rep()
returns public.user_profiles
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
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.is_active is not true or v_me.role is distinct from 'mr'
     or v_me.organisation_id is null then
    raise exception 'only a rep opens or ends their own working day'
      using errcode = '42501',
            hint = 'A manager or an admin may REOPEN an ended day (reopen_work_day); nobody ends one for a rep.';
  end if;
  return v_me;
end;
$$;

revoke execute on function public.work_day_rep() from public, anon, authenticated;

-- The day a phone may open or end: today in the rep's zone, or up to seven days back for a phone
-- that was offline. Never a future day. The DATE is the phone's to send -- it is the day the
-- screen showed the rep, from the SERVER's clock (`serverTime` on the pull) -- and this bounds it.
create or replace function public.assert_work_date_in_range(p_mr_id uuid, p_work_date date)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_today date := public.rep_today(p_mr_id);
begin
  if p_work_date is null or p_work_date > v_today or p_work_date < v_today - 7 then
    raise exception 'work_date_out_of_range: % is not a working day you can open or end (today is %)',
      p_work_date, v_today
      using errcode = '22023',
            hint = 'A day is opened or ended on the day, or up to seven days later from a phone that was offline.';
  end if;
end;
$$;

revoke execute on function public.assert_work_date_in_range(uuid, date) from public, anon, authenticated;

-- What the day held, read by the server at the moment it closes. The rules are the ones already
-- in force elsewhere, called rather than copied:
--   * a visit is on the day by `visit_day()` -- the day `sync_pull` sends the phone, so the
--     snapshot and the Day End screen count the same visits; cancelled visits are not counted;
--   * `missed` is a visit still `planned` -- never started -- when the day closed;
--   * distance and check-ins are `daily_mileage`'s, the figure the Mileage screen shows;
--   * samples and inputs are dated in the same zone as everything else.
create or replace function public.work_day_totals(p_mr_id uuid, p_date date)
returns table (
  visits_total integer, visits_completed integer, visits_not_met integer, visits_missed integer,
  visits_unplanned integer, check_in_count integer, distance_metres double precision,
  samples_quantity integer, inputs_quantity integer)
language sql
stable
security definer
set search_path to ''
as $$
  with day_visits as (
    select v.status, v.origin
      from public.visits v
     where v.mr_id = p_mr_id
       and v.status <> 'cancelled'
       and public.visit_day(v) = p_date
  ),
  zone as (
    select z.time_zone from public.day_zone_unchecked(p_mr_id) z
  ),
  given as (
    select s.kind, s.quantity
      from public.samples_and_inputs s cross join zone
     where s.mr_id = p_mr_id
       and (s.occurred_at at time zone zone.time_zone)::date = p_date
  ),
  mileage as (
    select m.check_in_count, m.distance_metres
      from public.daily_mileage(p_date, p_date, p_mr_id) m
     where m.mr_id = p_mr_id
  )
  select
    (select count(*) from day_visits)::integer,
    (select count(*) from day_visits where status = 'completed')::integer,
    (select count(*) from day_visits where status = 'not_met')::integer,
    (select count(*) from day_visits where status = 'planned')::integer,
    (select count(*) from day_visits where origin = 'unplanned')::integer,
    coalesce((select m.check_in_count from mileage m), 0)::integer,
    coalesce((select m.distance_metres from mileage m), 0)::double precision,
    coalesce((select sum(g.quantity) from given g where g.kind = 'sample'), 0)::integer,
    coalesce((select sum(g.quantity) from given g where g.kind = 'input'), 0)::integer;
$$;

revoke execute on function public.work_day_totals(uuid, date) from public, anon, authenticated;

-- The day's row for this rep and date, locked for the caller's transaction; created OPEN (by
-- `p_via`) when there is none yet. One writer per rep and day at a time.
create or replace function public.lock_work_day(
  p_me              public.user_profiles,
  p_work_date       date,
  p_via             text,
  p_client_at       timestamptz,
  p_open_request_id uuid
)
returns public.work_days
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_day  public.work_days;
  v_zone text;
begin
  select * into v_day from public.work_days w
   where w.mr_id = p_me.id and w.work_date = p_work_date
   for update;
  if v_day.id is not null then
    return v_day;
  end if;

  select z.time_zone into v_zone from public.day_zone_unchecked(p_me.id) z;
  insert into public.work_days (organisation_id, mr_id, territory_id, work_date, time_zone,
                                opened_via, client_opened_at, open_request_id)
  values (p_me.organisation_id, p_me.id, p_me.territory_id, p_work_date, v_zone,
          p_via, p_client_at, p_open_request_id)
  on conflict (mr_id, work_date) do nothing;

  select * into v_day from public.work_days w
   where w.mr_id = p_me.id and w.work_date = p_work_date
   for update;
  return v_day;
end;
$$;

revoke execute on function public.lock_work_day(public.user_profiles, date, text, timestamptz, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The rep's two acts
-- ---------------------------------------------------------------------------

-- "Start my day". Idempotent: an open day is returned as it is. A CLOSED day is refused (45015),
-- because starting it again is exactly the reopening only a manager or an admin may do.
create or replace function public.open_work_day(p_id uuid, p_work_date date, p_occurred_at timestamptz)
returns public.work_days
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me  public.user_profiles := public.work_day_rep();
  v_day public.work_days;
begin
  if p_id is null or p_occurred_at is null then
    raise exception 'a day is opened with a request id and the moment it was pressed'
      using errcode = '22023';
  end if;
  perform public.assert_work_date_in_range(v_me.id, p_work_date);
  -- The phone's clock may not run ahead of the server's (`BE-W173`, 45013): the same bound as a
  -- check-in, because the same phone recorded it.
  perform public.assert_field_event_not_in_future('day start', p_occurred_at);

  v_day := public.lock_work_day(v_me, p_work_date, 'start', p_occurred_at, p_id);
  if v_day.closed_at is not null then
    raise exception 'work_day_closed: your working day % was ended at %, so it cannot be started again',
      p_work_date, v_day.closed_at
      using errcode = '45015',
            detail = format('day %s, ended %s', p_work_date, v_day.closed_at),
            hint = 'Ask your manager to reopen the day.';
  end if;
  return v_day;
end;
$$;

-- "End my day". See the header for the rules; each is a branch below.
create or replace function public.close_work_day(
  p_id          uuid,
  p_work_date   date,
  p_occurred_at timestamptz,
  p_note        text default null
)
returns public.work_days
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me    public.user_profiles := public.work_day_rep();
  v_day   public.work_days;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_open  integer;
  v_t     record;
begin
  if p_id is null or p_occurred_at is null then
    raise exception 'a day is ended with a request id and the moment it was pressed'
      using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'closing_note_too_long: a closing note is at most 1000 characters'
      using errcode = '22023';
  end if;
  perform public.assert_work_date_in_range(v_me.id, p_work_date);
  perform public.assert_field_event_not_in_future('day end', p_occurred_at);

  v_day := public.lock_work_day(v_me, p_work_date, 'day_end', p_occurred_at, null);

  -- Idempotent. Ending an ended day returns it unchanged -- the first close's stamp and snapshot
  -- stand -- and a replay of a close a manager has since UNDONE does not end the day again.
  if v_day.closed_at is not null then
    return v_day;
  end if;
  if exists (select 1 from public.work_day_reopenings r
              where r.work_day_id = v_day.id and r.close_request_id = p_id) then
    return v_day;
  end if;

  -- Not with a visit still checked in. The rep checks out first: a departure is something only
  -- they saw, and the server does not invent one to make the day tidy.
  select count(*) into v_open
    from public.visits v
   where v.mr_id = v_me.id
     and v.status = 'in_progress'
     and public.visit_day(v) = p_work_date;
  if v_open > 0 then
    raise exception 'work_day_has_open_visit: % visit(s) on % are still checked in', v_open, p_work_date
      using errcode = '45016',
            detail = format('%s visit(s) checked in and not checked out on %s', v_open, p_work_date),
            hint = 'Check out of every visit, then end the day again.';
  end if;

  select * into v_t from public.work_day_totals(v_me.id, p_work_date);

  update public.work_days w
     set closed_at        = greatest(clock_timestamp(), w.opened_at),
         close_request_id = p_id,
         client_closed_at = p_occurred_at,
         closing_note     = v_note,
         visits_total     = v_t.visits_total,
         visits_completed = v_t.visits_completed,
         visits_not_met   = v_t.visits_not_met,
         visits_missed    = v_t.visits_missed,
         visits_unplanned = v_t.visits_unplanned,
         check_in_count   = v_t.check_in_count,
         distance_metres  = v_t.distance_metres,
         samples_quantity = v_t.samples_quantity,
         inputs_quantity  = v_t.inputs_quantity
   where w.id = v_day.id
  returning * into v_day;
  return v_day;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The manager's two acts
-- ---------------------------------------------------------------------------

-- Reopen an ended day: the rep's field manager (the rep is in their `visible_user_ids`) or an
-- admin of the rep's company, never the rep. The undone close is kept whole; the day is open
-- again and accepts check-ins until the rep ends it again.
create or replace function public.reopen_work_day(p_work_day_id uuid, p_reason text)
returns public.work_days
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_me     public.user_profiles;
  v_day    public.work_days;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.is_active is not true
     or v_me.role not in ('field_manager', 'admin') or v_me.organisation_id is null then
    raise exception 'only a manager or an admin reopens a working day'
      using errcode = '42501',
            hint = 'A rep cannot reopen their own ended day.';
  end if;

  select * into v_day from public.work_days w where w.id = p_work_day_id for update;
  -- Not found, another company's, outside the manager's team, and the caller's own are ONE
  -- answer: anything else is an existence oracle across territories and tenants.
  if v_day.id is null
     or v_day.organisation_id is distinct from v_me.organisation_id
     or v_day.mr_id = v_me.id
     or v_day.mr_id not in (select public.visible_user_ids()) then
    raise exception 'work day % is not one you may reopen', p_work_day_id
      using errcode = '42501';
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'reopen_needs_reason: say why the day is being reopened (3 to 500 characters)'
      using errcode = '22023';
  end if;
  if v_day.closed_at is null then
    raise exception 'work_day_not_closed: the working day % is open, so there is nothing to reopen',
      v_day.work_date
      using errcode = '22023';
  end if;

  insert into public.work_day_reopenings (organisation_id, work_day_id, mr_id, work_date,
                                          reopened_by_user_id, reason, closed_at,
                                          close_request_id, closed_snapshot)
  values (v_day.organisation_id, v_day.id, v_day.mr_id, v_day.work_date, v_me.id, v_reason,
          v_day.closed_at, v_day.close_request_id,
          jsonb_build_object(
            'clientClosedAt', v_day.client_closed_at,
            'closingNote', v_day.closing_note,
            'visitsTotal', v_day.visits_total,
            'visitsCompleted', v_day.visits_completed,
            'visitsNotMet', v_day.visits_not_met,
            'visitsMissed', v_day.visits_missed,
            'visitsUnplanned', v_day.visits_unplanned,
            'checkInCount', v_day.check_in_count,
            'distanceMetres', v_day.distance_metres,
            'samplesQuantity', v_day.samples_quantity,
            'inputsQuantity', v_day.inputs_quantity));

  update public.work_days w
     set closed_at = null, close_request_id = null, client_closed_at = null, closing_note = null,
         visits_total = null, visits_completed = null, visits_not_met = null,
         visits_missed = null, visits_unplanned = null, check_in_count = null,
         distance_metres = null, samples_quantity = null, inputs_quantity = null,
         reopen_count = w.reopen_count + 1
   where w.id = v_day.id
  returning * into v_day;
  return v_day;
end;
$$;

-- `BE-W191`. The team's days on one date, for the console: every active rep the caller may see,
-- whether or not their day has a row -- "not started" is an answer a manager needs, and an
-- absent row is how it is spelled. A field manager sees their team; an admin their company.
create or replace function public.team_work_days(p_on date)
returns table (
  mr_id uuid, full_name text, territory_name text, work_day_id uuid, status text,
  time_zone text, opened_at timestamptz, opened_via text, closed_at timestamptz, closing_note text,
  visits_total integer, visits_completed integer, visits_not_met integer, visits_missed integer,
  distance_metres double precision, samples_quantity integer, reopen_count integer)
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
  select * into v_me from public.user_profiles p where p.id = (select auth.uid());
  if v_me.id is null or v_me.is_active is not true
     or v_me.role not in ('field_manager', 'admin') or v_me.organisation_id is null then
    raise exception 'only a manager or an admin sees the team''s working days'
      using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'a day is required' using errcode = '22023';
  end if;

  return query
    select p.id, p.full_name, t.name, w.id,
           case when w.id is null then 'not_started'
                when w.closed_at is null then 'open'
                else 'closed' end,
           w.time_zone, w.opened_at, w.opened_via, w.closed_at, w.closing_note,
           w.visits_total, w.visits_completed, w.visits_not_met, w.visits_missed,
           w.distance_metres, w.samples_quantity, coalesce(w.reopen_count, 0)
      from public.user_profiles p
      left join public.territories t on t.id = p.territory_id
      left join public.work_days w on w.mr_id = p.id and w.work_date = p_on
     where p.role = 'mr'
       and p.is_active
       and p.organisation_id = v_me.organisation_id
       and p.id in (select public.visible_user_ids())
     order by p.full_name, p.id;
end;
$$;

revoke execute on function public.open_work_day(uuid, date, timestamptz) from public, anon;
revoke execute on function public.close_work_day(uuid, date, timestamptz, text) from public, anon;
revoke execute on function public.reopen_work_day(uuid, text) from public, anon;
revoke execute on function public.team_work_days(date) from public, anon;
grant execute on function public.open_work_day(uuid, date, timestamptz) to authenticated;
grant execute on function public.close_work_day(uuid, date, timestamptz, text) to authenticated;
grant execute on function public.reopen_work_day(uuid, text) to authenticated;
grant execute on function public.team_work_days(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sync: the outbox reaches the two acts, and the pull carries the day
-- ---------------------------------------------------------------------------
-- Both bodies are taken from `pg_get_functiondef` on a database at `20261009000500` and patched,
-- not retyped (the rule `20260908001500` records after a hand-typed body dropped a FROM clause).
-- `apply_sync_item` is `20261009000200`'s definition with the `work_day` branch added before the
-- final `else`; `sync_pull` is `20260921000200`'s with one arm and one `c_entities` member added.
-- `create or replace` keeps both functions' grants.

CREATE OR REPLACE FUNCTION public.apply_sync_item(p_entity sync_entity_kind, p_entity_id uuid, p_payload jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid;
  v_warnings text[] := '{}';
  v_beat_plan uuid;
  v_row_id    uuid;
  v_check_in  public.check_ins;
  v_reason    text;
begin
  v_uid := (select auth.uid());

  v_row_id := nullif(p_payload ->> 'id', '')::uuid;
  if v_row_id is null and p_entity not in ('visit', 'recording', 'voice_note') then
    raise exception 'a % item carries no id of its own', p_entity using errcode = '22023';
  end if;

  case p_entity
    when 'visit' then
      v_beat_plan := nullif(p_payload ->> 'beatPlanId', '')::uuid;
      if v_beat_plan is not null then
        raise exception 'planned_visit_from_plan_only: a visit on a plan is created by the plan'
          using errcode = '22023',
                hint = 'BE-C78. Check in against the planned visit the plan sent; a visit of your own is unplanned.';
      end if;
      if coalesce(p_payload ->> 'origin', '') <> 'unplanned' then
        raise exception 'visit_origin_required: a visit sent from the phone is unplanned'
          using errcode = '22023',
                hint = 'Send origin "unplanned" and a reason.';
      end if;
      v_reason := btrim(coalesce(p_payload ->> 'unplannedReason', ''));
      if char_length(v_reason) < 3 then
        raise exception 'unplanned_visit_needs_reason'
          using errcode = '22023',
                hint = 'An unplanned visit records why it happened (at least 3 characters).';
      end if;

      insert into public.visits (id, mr_id, doctor_id, beat_plan_id, clinic_address_id,
                                 status, scheduled_for, started_at, completed_at,
                                 origin, unplanned_reason)
      values (p_entity_id,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              null,
              nullif(p_payload ->> 'clinicAddressId', '')::uuid,
              coalesce(nullif(p_payload ->> 'status', ''), 'planned')::public.visit_status,
              nullif(p_payload ->> 'scheduledFor', '')::timestamptz,
              nullif(p_payload ->> 'startedAt', '')::timestamptz,
              nullif(p_payload ->> 'completedAt', '')::timestamptz,
              'unplanned',
              v_reason)
      on conflict (id) do nothing;

    when 'check_in' then
      v_check_in := public.record_check_in(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source);

      if v_check_in.geofence_status = 'outside' then
        v_warnings := array_append(v_warnings, 'check_in_outside_geofence');
      end if;
      if v_check_in.location_is_approximate is true then
        v_warnings := array_append(v_warnings, 'check_in_location_approximate');
      end if;
      -- A check-in against a planned visit whose plan has since been revised: accepted, and said.
      if exists (select 1 from public.visits v where v.id = (p_payload ->> 'visitId')::uuid
                   and v.beat_plan_id is not null and public.beat_plan_is_stale(v.beat_plan_id)) then
        v_warnings := array_append(v_warnings, 'stale_beat_plan');
      end if;

    when 'check_out' then
      perform public.record_check_out(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        (p_payload -> 'coordinates' ->> 'latitude')::double precision,
        (p_payload -> 'coordinates' ->> 'longitude')::double precision,
        (p_payload ->> 'occurredAt')::timestamptz,
        nullif(p_payload -> 'coordinates' ->> 'accuracyMetres', '')::double precision,
        coalesce(nullif(p_payload ->> 'source', ''), 'automatic')::public.capture_source,
        nullif(p_payload ->> 'notMetReason', ''));

    when 'call_report' then
      if nullif(p_payload ->> 'supersedesCallReportId', '') is not null then
        perform public.revise_call_report(
          v_row_id,
          (p_payload ->> 'supersedesCallReportId')::uuid,
          coalesce(p_payload ->> 'summary', ''),
          coalesce((select array_agg(value::text::uuid)
                      from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                   '{}'::uuid[]),
          nullif(p_payload ->> 'objectionsRaised', ''),
          nullif(p_payload ->> 'nextStep', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'submitted')::public.call_report_status);
      else
        insert into public.call_reports (id, visit_id, mr_id, summary, product_ids_discussed,
                                         objections_raised, next_step, status, draft_source)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                v_uid,
                coalesce(p_payload ->> 'summary', ''),
                coalesce((select array_agg(value::text::uuid)
                            from jsonb_array_elements_text(coalesce(p_payload -> 'productIdsDiscussed', '[]'::jsonb)) value),
                         '{}'::uuid[]),
                nullif(p_payload ->> 'objectionsRaised', ''),
                nullif(p_payload ->> 'nextStep', ''),
                coalesce(nullif(p_payload ->> 'status', ''), 'draft')::public.call_report_status,
                coalesce(nullif(p_payload ->> 'draftSource', ''), 'manual')::public.call_report_draft_source)
        on conflict (id) do nothing;
      end if;

    when 'consent_record' then
      -- BE-W74. A CAPTURE goes through capture_consent, exactly as check_in goes through
      -- record_check_in. Before this, the offline path did a direct INSERT, so every bound
      -- FIX-02 and FIX-12 built was absent on the one path where they exist to matter --
      -- offline capture is the entire reason FIX-12 validates against captured_at rather
      -- than now(). See the migration header for the proof, both directions.
      --
      -- capture_consent derives doctor_id from the visit and displayed_language from the
      -- version that was actually active at captured_at, so the payload's own `doctorId`
      -- and `displayedLanguage` are deliberately not passed: a client cannot assert either.
      -- It is idempotent on p_id, which is what `on conflict (id) do nothing` was doing.
      if coalesce((p_payload ->> 'isWithdrawal')::boolean, false) then
        -- A WITHDRAWAL is a different act and capture_consent cannot express it: it takes
        -- no supersedes_consent_record_id and no is_withdrawal. The table's own
        -- constraints and the validate_consent_withdrawal trigger are what guard this
        -- shape, and they fire on a direct insert. Routed separately rather than forced
        -- through a function that would have to grow two parameters it has no other use
        -- for.
        insert into public.consent_records (id, visit_id, doctor_id, captured_by_mr_id,
                                            outcome, not_asked_reason,
                                            consent_text_version_id, displayed_language,
                                            supersedes_consent_record_id, is_withdrawal,
                                            captured_at)
        values (v_row_id,
                (p_payload ->> 'visitId')::uuid,
                (p_payload ->> 'doctorId')::uuid,
                v_uid,
                (p_payload ->> 'outcome')::public.consent_outcome,
                nullif(p_payload ->> 'notAskedReason', ''),
                (p_payload ->> 'consentTextVersionId')::uuid,
                p_payload ->> 'displayedLanguage',
                nullif(p_payload ->> 'supersedesConsentRecordId', '')::uuid,
                true,
                (p_payload ->> 'capturedAt')::timestamptz)
        on conflict (id) do nothing;
      else
        perform public.capture_consent(
          v_row_id,
          (p_payload ->> 'visitId')::uuid,
          (p_payload ->> 'outcome')::public.consent_outcome,
          p_payload ->> 'displayedLanguage',
          (p_payload ->> 'consentTextVersionId')::uuid,
          nullif(p_payload ->> 'notAskedReason', ''),
          (p_payload ->> 'capturedAt')::timestamptz);
      end if;

    when 'sample_and_input' then
      insert into public.samples_and_inputs (id, visit_id, mr_id, doctor_id, kind, item_name,
                                             quantity, declared_value_inr, occurred_at)
      values (v_row_id,
              (p_payload ->> 'visitId')::uuid,
              v_uid,
              (p_payload ->> 'doctorId')::uuid,
              (p_payload ->> 'kind')::public.sample_or_input_kind,
              p_payload ->> 'itemName',
              (p_payload ->> 'quantity')::integer,
              coalesce((p_payload ->> 'declaredValueInr')::numeric, 0),
              (p_payload ->> 'occurredAt')::timestamptz)
      on conflict (id) do nothing;

    when 'recording', 'voice_note' then
      -- The bytes are already in storage; this is the finalisation. complete_upload
      -- re-checks consent one last time, so a withdrawal that arrived while the
      -- device was offline stops the row from ever being created.
      if nullif(p_payload ->> 'uploadGrantId', '') is null then
        raise exception 'a % item must carry its uploadGrantId', p_entity
          using errcode = '22023';
      end if;

      perform public.complete_upload(
        (p_payload ->> 'uploadGrantId')::uuid,
        p_entity_id,
        (p_payload ->> 'durationSeconds')::integer,
        (p_payload ->> 'sizeBytes')::bigint,
        coalesce((p_payload ->> 'recordedAt')::timestamptz, now()),
        nullif(p_payload ->> 'bitrateKbps', '')::integer);

    when 'adverse_event' then
      -- W2-C B / `BE-W159`, `BE-C36`. The rep FLAGS a possible adverse event; nothing more. Through
      -- `report_adverse_event`, which already exists and already enforces everything the flag
      -- needs: the visit must be the caller's (42501), there must be words (22023), and the id is
      -- the idempotency key, so a replay is the same report and the same statutory clock.
      perform public.report_adverse_event(
        v_row_id,
        (p_payload ->> 'visitId')::uuid,
        p_payload ->> 'reportedText',
        nullif(p_payload ->> 'clientReportedAt', '')::timestamptz);

    when 'work_day' then
      -- `BE-W190`. The rep opens or ends their working day, offline too. Through the same two
      -- functions a direct call reaches, so the rules -- the date's bounds, the clock, no visit
      -- left checked in, idempotency on the request id -- are checked once, in one place.
      if p_payload ->> 'action' = 'close' then
        perform public.close_work_day(
          v_row_id,
          (p_payload ->> 'workDate')::date,
          (p_payload ->> 'occurredAt')::timestamptz,
          nullif(p_payload ->> 'note', ''));
      elsif p_payload ->> 'action' = 'open' then
        perform public.open_work_day(
          v_row_id,
          (p_payload ->> 'workDate')::date,
          (p_payload ->> 'occurredAt')::timestamptz);
      else
        raise exception 'work_day_action_unknown: a work_day item must say "open" or "close", not %',
          coalesce(p_payload ->> 'action', 'nothing')
          using errcode = '22023';
      end if;

    else
      raise exception 'entity % is not yet accepted by sync', p_entity
        using errcode = '0A000';
  end case;

  return v_warnings;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_pull(p_cursor text DEFAULT NULL::text, p_entities text[] DEFAULT NULL::text[], p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'beat_plan_entry', 'doctor',
                                      'clinic_address', 'consent_text_version', 'work_day'];
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
    -- `BE-W190`. The rep's working day, so the phone holds the server's word on whether the day
    -- is open or ended -- offline too, and for the live-tracking rule's `dayOpen`. No predicate,
    -- like every arm above: this function is SECURITY INVOKER, and `work_days_select_scope` plus
    -- `work_days_tenant_boundary` scope it. A day is never deleted and never changes owner, so it
    -- needs no tombstone.
    select 'work_day', w.id, w.updated_at, w.xmin, 'upserted', to_jsonb(w)
      from public.work_days w
     where 'work_day' = any(v_want)
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
