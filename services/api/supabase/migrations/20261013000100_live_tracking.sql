-- `BE-W180` -- LIVE TRACKING: a rep's position every few minutes, during working hours, while the app is
-- on screen, after the rep has read and accepted a separate notice, and only if the company switched
-- it on. Operator decision `BE-C45` (A-5); the safe defaults chosen by the owner on 13 October 2026.
--
-- **What existed.** The design (`docs/ai-platform/LIVE-TRACKING-DESIGN.md`), a DRAFT rep notice
-- (`docs/operator/live-tracking-notice-DRAFT.md`), and `apps/field/src/integrations/tracking.ts`,
-- which decides WHETHER the phone may track and records nothing. No table, no RPC.
--
-- **The rules, and what holds each one:**
--   1. OFF unless the company switched it on: `app_thresholds` key `live_tracking_enabled`, scoped to
--      the organisation (`BE-C10`). No global row is written, so a company that never chose is OFF.
--      An admin changes it through `set_live_tracking_enabled`, a row in an append-only, audited table.
--   2. The rep accepted the CURRENT notice: `live_tracking_acceptances`, append-only; a withdrawal is
--      a later row. A new notice version is a different id, so an acceptance of the old one no
--      longer counts -- re-acceptance is not a flag somebody has to remember to clear.
--   3. Within the rep's working hours, by the SERVER's window (`is_within_shift`), at the moment
--      the position was taken AND the moment it arrived. The phone decides when to COLLECT; this
--      decides what is KEPT (the design's C1). Day open and app on screen are the phone's facts --
--      the server cannot observe either, and does not pretend to.
--   4. Who sees a position: `visible_user_ids()` -- the rep, a manager over the rep's territory
--      subtree or reporting line, an admin of the rep's company. A restrictive tenant boundary on
--      top. Nobody across companies; `anon` has no grant at all.
--   5. Deleted 90 days after the server received it: `purge_after`, stamped by trigger, and
--      `purge_expired_location_pings`, run hourly by the existing retention worker (`BE-W181`).
--
-- **One write path per table, every one an RPC.** `record_location_ping` is the only way a position
-- enters; it re-checks rules 1-3 on every call and trusts nothing the phone says about them. A
-- refused position is NOT an exception: it is answered `{stored: false, reason}` and counted in
-- `write_rejections` (the `BE-W129` mechanism, one new entry point), so a phone that keeps sending
-- outside hours is visible to an admin rather than silently refused forever.
--
-- **The notice.** The engineering draft enters as a version with NO organisation, and is shown to a
-- rep labelled DRAFT. It can never be approved (it has no company to approve it). A company loads
-- its own text with `propose_live_tracking_notice` and a SECOND admin approves it
-- (`approve_live_tracking_notice`, four-eyes, `C24`/`BE-C44`/`BE-C77`); from that moment the
-- company's reps see the approved text and must accept it again.

-- ---------------------------------------------------------------------------
-- 1. The notice: versions and approvals, append-only
-- ---------------------------------------------------------------------------

create table public.live_tracking_notice_versions (
  id                  uuid primary key default gen_random_uuid(),
  -- NULL only for the engineering draft this migration ships; every company version names its own.
  organisation_id     uuid references public.organisations (id) on delete restrict,
  version_label       text not null check (char_length(btrim(version_label)) between 1 and 80),
  body                text not null check (char_length(btrim(body)) between 50 and 20000),
  authored_by_user_id uuid references public.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default clock_timestamp(),
  -- A company version has an author; the engineering draft has neither company nor author.
  constraint live_tracking_notice_author_iff_company
    check ((organisation_id is null) = (authored_by_user_id is null)),
  constraint live_tracking_notice_label_once unique (organisation_id, version_label)
);

create table public.live_tracking_notice_approvals (
  id                  uuid primary key default gen_random_uuid(),
  notice_version_id   uuid not null unique
                        references public.live_tracking_notice_versions (id) on delete restrict,
  approved_by_user_id uuid not null references public.user_profiles (id) on delete restrict,
  attestation         text not null check (char_length(btrim(attestation)) between 3 and 500),
  created_at          timestamptz not null default clock_timestamp()
);

-- Four-eyes as a TRIGGER, not only as a check inside the RPC: a guard that is not a policy, a
-- trigger or a revoked grant is not a guard. The approver is an active admin of the version's own
-- company and is not its author; the engineering draft (no company) can never be approved.
create or replace function public.live_tracking_notice_approval_valid()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_version  public.live_tracking_notice_versions%rowtype;
  v_approver public.user_profiles%rowtype;
begin
  select * into v_version from public.live_tracking_notice_versions v where v.id = new.notice_version_id;
  if v_version.organisation_id is null then
    raise exception 'the engineering draft cannot be approved; load the company''s own text'
      using errcode = '42501';
  end if;
  select * into v_approver from public.user_profiles p where p.id = new.approved_by_user_id;
  if v_approver.role is distinct from 'admin' or v_approver.is_active is not true
     or v_approver.organisation_id is distinct from v_version.organisation_id then
    raise exception 'only an active admin of the notice''s own company approves it'
      using errcode = '42501';
  end if;
  if new.approved_by_user_id = v_version.authored_by_user_id then
    raise exception 'the author of a notice may not approve it' using errcode = '42501';
  end if;
  new.created_at := clock_timestamp();
  return new;
end;
$$;

create trigger live_tracking_notice_approvals_valid
  before insert on public.live_tracking_notice_approvals
  for each row execute function public.live_tracking_notice_approval_valid();

-- ---------------------------------------------------------------------------
-- 2. The rep's acceptance ledger, append-only
-- ---------------------------------------------------------------------------

create table public.live_tracking_acceptances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  -- For a withdrawal, the version that was accepted until then.
  notice_version_id uuid not null references public.live_tracking_notice_versions (id) on delete restrict,
  action            text not null check (action in ('accepted', 'withdrawn')),
  occurred_at       timestamptz not null default clock_timestamp()
);

create index live_tracking_acceptances_mr_idx
  on public.live_tracking_acceptances (mr_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 3. The positions
-- ---------------------------------------------------------------------------

create table public.location_pings (
  -- The PHONE's id for this position, so a resend after a dropped response is one row, not two.
  id                uuid primary key,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  mr_id             uuid not null references public.user_profiles (id) on delete restrict,
  -- The rep's territory when the position arrived. Visibility follows the rep, not this column.
  territory_id      uuid references public.territories (id) on delete restrict,
  -- The notice the rep had accepted when this was taken: what they agreed to, row by row.
  notice_version_id uuid not null references public.live_tracking_notice_versions (id) on delete restrict,
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  accuracy_m        double precision check (accuracy_m is null or accuracy_m >= 0),
  -- What the DEVICE says. Its clock is not trusted, only bounded (see `record_location_ping`).
  recorded_at       timestamptz not null,
  -- The server's, stamped by trigger. A device can neither start nor shorten the retention clock.
  received_at       timestamptz not null,
  purge_after       timestamptz not null
);

create index location_pings_mr_received_idx on public.location_pings (mr_id, received_at desc);
create index location_pings_purge_after_idx on public.location_pings (purge_after);

create or replace function public.location_pings_stamp()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.received_at := clock_timestamp();
  -- 90 days, the period the notice states. A constant rather than a threshold: the rep was told a
  -- number, and a setting that could lengthen it without a new notice would make the notice false.
  new.purge_after := new.received_at + interval '90 days';
  return new;
end;
$$;

create trigger location_pings_stamp
  before insert on public.location_pings
  for each row execute function public.location_pings_stamp();

-- **Append-only, with exactly one exit: expiry.** UPDATE and TRUNCATE are refused by statement-level
-- trigger, as everywhere else (`BE-W2`). DELETE is allowed only of rows whose `purge_after` has
-- passed -- checked AFTER the statement over its transition table, so it holds for every role,
-- including `postgres`, and a zero-row delete reports nothing because there is nothing to report.
create or replace function public.location_pings_delete_only_expired()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if exists (select 1 from gone where gone.purge_after > clock_timestamp()) then
    raise exception 'location_pings are deleted only after purge_after: % is not permitted', tg_op
      using errcode = 'restrict_violation',
            hint = 'Positions leave this table through purge_expired_location_pings, and only once expired.';
  end if;
  return null;
end;
$$;

create trigger location_pings_reject_mutation
  before update or truncate on public.location_pings
  for each statement execute function public.reject_mutation();

create trigger location_pings_delete_only_expired
  after delete on public.location_pings
  referencing old table as gone
  for each statement execute function public.location_pings_delete_only_expired();

create trigger live_tracking_notice_versions_reject_mutation
  before update or delete or truncate on public.live_tracking_notice_versions
  for each statement execute function public.reject_mutation();
create trigger live_tracking_notice_approvals_reject_mutation
  before update or delete or truncate on public.live_tracking_notice_approvals
  for each statement execute function public.reject_mutation();
create trigger live_tracking_acceptances_reject_mutation
  before update or delete or truncate on public.live_tracking_acceptances
  for each statement execute function public.reject_mutation();

-- Who loaded, approved, accepted and withdrew is an audit fact. A POSITION is not audited row by row:
-- it is itself a server-stamped record, and twelve audit rows an hour per rep would bury the log.
create trigger live_tracking_notice_versions_audit after insert on public.live_tracking_notice_versions
  for each row execute function public.write_audit_row();
create trigger live_tracking_notice_approvals_audit after insert on public.live_tracking_notice_approvals
  for each row execute function public.write_audit_row();
create trigger live_tracking_acceptances_audit after insert on public.live_tracking_acceptances
  for each row execute function public.write_audit_row();

-- ---------------------------------------------------------------------------
-- 4. A refused position is counted, like a refused sync item
-- ---------------------------------------------------------------------------

alter table public.write_rejections drop constraint write_rejections_entry_point_known;
alter table public.write_rejections
  add constraint write_rejections_entry_point_known
  check (entry_point in ('sync_push', 'complete_upload', 'record_location_ping'));

-- ---------------------------------------------------------------------------
-- 5. The engineering draft of the notice
-- ---------------------------------------------------------------------------
--
-- The text of `docs/operator/live-tracking-notice-DRAFT.md`, with three of its blanks filled by the
-- owner's choices of 13 October (who sees it, how often, how long it is kept) and two sentences
-- corrected to what was BUILT: there is no phone notification and no background collection, because
-- background location stays blocked (`apps/field/plugins/android-release.cjs`). The company's legal
-- name, the choice question (decision 4) and the contact stay BLANK: those are not engineering's.

insert into public.live_tracking_notice_versions (organisation_id, version_label, body, authored_by_user_id)
values (null, 'DRAFT 2026-10-13 (not approved)', $notice$DRAFT - NOT APPROVED. This notice has not been approved by your company. It is shown so the feature can be tried; your company must load and approve its own version.

Location sharing during working hours - notice to medical representatives

From: [[ BLANK: registered legal name of the company ]] ("the Company")

What this is
This is a separate notice from any other you have agreed to in this app. It is only about sharing your phone's location during your working hours. Saying no to it does not change your check-in and check-out, which record your location at those two moments as they do today.

When your location is shared
- Only during your working hours, as set for your territory by the Company. The Company's system refuses to store any location recorded outside them.
- Only after you start it for the day from the app, and only while the app is open on your screen. The app shows a line saying whether your location is being shared at that moment.
- It stops when your working hours end, when you stop it for the day, when you leave the app, or when you withdraw.

What is recorded
Your phone's position (latitude and longitude), how accurate it was, and the time - about every 5 minutes. Nothing else: not your contacts, messages, photos, calls or browsing.

Who can see it
You; your manager, and managers above them for your territory or reporting line; and the Company's administrators. No one else at the Company, and no one outside it except the Company's service providers who host the system.

How long it is kept
90 days from when the Company's system received it, after which it is deleted.

Your choice
[[ BLANK: whether sharing your location is optional or a condition of your role, and what happens if you decline or later withdraw. This must be answered truthfully; it is an HR and legal decision. ]]

You can withdraw at any time from the app's Me screen. Withdrawing stops location sharing from that moment; locations already recorded are kept for the period above.

Questions
[[ BLANK: who to contact about this notice - a named role and contact ]]$notice$, null);

-- ---------------------------------------------------------------------------
-- 6. Helpers -- not granted to clients
-- ---------------------------------------------------------------------------

-- The notice a company's reps must accept now: its latest APPROVED version, else the engineering draft.
create or replace function public.current_live_tracking_notice(p_organisation_id uuid)
returns public.live_tracking_notice_versions
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_notice public.live_tracking_notice_versions%rowtype;
begin
  select v.* into v_notice
    from public.live_tracking_notice_versions v
    join public.live_tracking_notice_approvals a on a.notice_version_id = v.id
   where v.organisation_id = p_organisation_id
   order by a.created_at desc
   limit 1;
  if v_notice.id is null then
    select v.* into v_notice
      from public.live_tracking_notice_versions v
     where v.organisation_id is null
     order by v.created_at desc
     limit 1;
  end if;
  return v_notice;
end;
$$;

-- The version a rep has accepted and not withdrawn, or null. The LATEST row decides.
create or replace function public.live_tracking_accepted_version(p_mr_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select case when a.action = 'accepted' then a.notice_version_id end
    from public.live_tracking_acceptances a
   where a.mr_id = p_mr_id
   order by a.occurred_at desc, a.id desc
   limit 1;
$$;

-- Inside the territory's working hours at an instant. No window configured is NOT an error here:
-- it is simply "not within", which keeps tracking off -- the safe reading of missing data.
create or replace function public.live_tracking_within_hours(p_territory_id uuid, p_at timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if p_territory_id is null or p_at is null then
    return false;
  end if;
  return public.is_within_shift(p_territory_id, p_at);
exception
  when sqlstate '45002' then
    return false;
end;
$$;

-- The company switch, for the CALLER's company (`threshold` resolves the organisation itself).
-- Only the JSON value `true` is on; no row, `false`, or anything else is off.
create or replace function public.live_tracking_company_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(public.threshold('live_tracking_enabled', null) = 'true'::jsonb, false);
$$;

-- Seconds between positions, for the caller's company: `live_tracking_interval_seconds`, default 300
-- (5 minutes, the owner's choice and the notice's words), held between 60 and 3600 whatever is set.
create or replace function public.live_tracking_interval_seconds()
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select least(3600, greatest(60,
    coalesce(public.threshold_number('live_tracking_interval_seconds', null, 300), 300)))::integer;
$$;

-- The caller as a rep, or a refusal.
create or replace function public.live_tracking_rep()
returns public.user_profiles
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_caller  record;
  v_profile public.user_profiles%rowtype;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'mr' then
    raise exception 'only a rep shares their own location' using errcode = '42501';
  end if;
  select * into v_profile from public.user_profiles p where p.id = v_caller.user_id;
  return v_profile;
end;
$$;

-- What the phone needs to decide, all of it the server's: the switch, the interval, the notice and
-- whether it is accepted, whether NOW is inside working hours, and the rep's territory date.
create or replace function public.live_tracking_status_for(p_rep public.user_profiles)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_notice   public.live_tracking_notice_versions%rowtype;
  v_accepted uuid;
  v_window   record;
begin
  v_notice := public.current_live_tracking_notice(p_rep.organisation_id);
  v_accepted := public.live_tracking_accepted_version(p_rep.id);
  if p_rep.territory_id is not null then
    select * into v_window from public.resolve_shift_window(p_rep.territory_id);
  end if;

  return jsonb_build_object(
    'companyEnabled', public.live_tracking_company_enabled(),
    'intervalSeconds', public.live_tracking_interval_seconds(),
    'notice', case when v_notice.id is null then null else jsonb_build_object(
      'id', v_notice.id,
      'versionLabel', v_notice.version_label,
      'body', v_notice.body,
      'isDraft', v_notice.organisation_id is null) end,
    'accepted', v_accepted is not null and v_accepted = v_notice.id,
    -- Set while the rep's acceptance is of an OLDER version: the phone says "the notice changed".
    'acceptedNoticeVersionId', v_accepted,
    'withinWorkingHours', public.live_tracking_within_hours(p_rep.territory_id, now()),
    'shiftEnd', v_window.shift_end::text,
    'timeZone', v_window.timezone,
    'today', public.rep_today(p_rep.id),
    'serverTime', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The rep's RPCs
-- ---------------------------------------------------------------------------

create or replace function public.my_live_tracking()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  return public.live_tracking_status_for(public.live_tracking_rep());
end;
$$;

-- Accept the notice the rep READ. FIX-02: the version is the one the handset showed, recorded as
-- sent -- and refused if it is no longer the current one, because an acceptance of text the company
-- has since replaced cannot be reconciled. `45001` is the existing "notice superseded" refusal: the
-- remedy is the same, read the current notice. Accepting the same version twice is one acceptance.
create or replace function public.accept_live_tracking_notice(p_notice_version_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_rep    public.user_profiles%rowtype;
  v_notice public.live_tracking_notice_versions%rowtype;
begin
  v_rep := public.live_tracking_rep();
  if p_notice_version_id is null then
    raise exception 'an acceptance names the notice version that was read' using errcode = '22023';
  end if;
  v_notice := public.current_live_tracking_notice(v_rep.organisation_id);
  if v_notice.id is distinct from p_notice_version_id then
    raise exception 'live_tracking_notice_superseded: version % is not the current notice', p_notice_version_id
      using errcode = '45001',
            hint = 'Read the current notice and accept that one.';
  end if;

  if public.live_tracking_accepted_version(v_rep.id) is distinct from v_notice.id then
    insert into public.live_tracking_acceptances (organisation_id, mr_id, notice_version_id, action)
    values (v_rep.organisation_id, v_rep.id, v_notice.id, 'accepted');
  end if;

  return public.live_tracking_status_for(v_rep);
end;
$$;

-- Withdraw. Stops tracking at once: the next position is refused `no_acceptance`. Withdrawing when
-- nothing is accepted writes nothing -- there is nothing to withdraw, and no row is invented.
create or replace function public.withdraw_live_tracking()
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_rep      public.user_profiles%rowtype;
  v_accepted uuid;
begin
  v_rep := public.live_tracking_rep();
  v_accepted := public.live_tracking_accepted_version(v_rep.id);
  if v_accepted is not null then
    insert into public.live_tracking_acceptances (organisation_id, mr_id, notice_version_id, action)
    values (v_rep.organisation_id, v_rep.id, v_accepted, 'withdrawn');
  end if;
  return public.live_tracking_status_for(v_rep);
end;
$$;

-- THE write path for a position. Everything the phone decided is decided again here.
--
-- Arguments that cannot be a position raise `22023`, as a malformed request. A position that IS one
-- but must not be kept is answered `{stored: false, reason}` and counted in `write_rejections`; the
-- phone stops on `company_off` and `no_acceptance`, and pauses on `outside_working_hours`.
--
-- The device clock is bounded, never believed: up to the system's existing 120-second tolerance
-- ahead (`consent_future_tolerance_seconds`, as check-ins use it), and no older than ten minutes or
-- two intervals, whichever is longer -- a position that old is not live, and the phone drops rather
-- than queues them (`apps/field/src/tracking`). Working hours are checked at BOTH instants: when the
-- position was taken, and now.
create or replace function public.record_location_ping(
  p_id          uuid,
  p_latitude    double precision,
  p_longitude   double precision,
  p_accuracy_m  double precision,
  p_recorded_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_rep       public.user_profiles%rowtype;
  v_existing  public.location_pings%rowtype;
  v_notice    public.live_tracking_notice_versions%rowtype;
  v_interval  integer;
  v_tolerance numeric;
  v_reason    text;
  v_sqlstate  text;
  v_received  timestamptz;
begin
  v_rep := public.live_tracking_rep();

  if p_id is null or p_recorded_at is null then
    raise exception 'a position carries its own id and the time it was taken' using errcode = '22023';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180 then
    raise exception 'a position has a latitude in [-90, 90] and a longitude in [-180, 180]'
      using errcode = '22023';
  end if;
  if p_accuracy_m is not null and p_accuracy_m < 0 then
    raise exception 'accuracy is a distance and cannot be negative' using errcode = '22023';
  end if;

  -- A resend of a position already kept is that position.
  select * into v_existing from public.location_pings lp where lp.id = p_id;
  if v_existing.id is not null then
    if v_existing.mr_id <> v_rep.id then
      raise exception 'position id % is already used', p_id using errcode = '22023';
    end if;
    return jsonb_build_object('stored', true, 'replayed', true, 'reason', null,
                              'receivedAt', v_existing.received_at);
  end if;

  v_notice := public.current_live_tracking_notice(v_rep.organisation_id);
  v_interval := public.live_tracking_interval_seconds();
  v_tolerance := coalesce(public.threshold_number('consent_future_tolerance_seconds', null, 120), 120);

  if not public.live_tracking_company_enabled() then
    v_reason := 'company_off';           v_sqlstate := '42501';
  elsif v_notice.id is null
        or public.live_tracking_accepted_version(v_rep.id) is distinct from v_notice.id then
    v_reason := 'no_acceptance';         v_sqlstate := '42501';
  elsif p_recorded_at > now() + make_interval(secs => v_tolerance) then
    v_reason := 'recorded_in_future';    v_sqlstate := '45013';
  elsif p_recorded_at < now() - make_interval(secs => greatest(600, 2 * v_interval)) then
    v_reason := 'too_old';               v_sqlstate := '22023';
  elsif not public.live_tracking_within_hours(v_rep.territory_id, p_recorded_at)
        or not public.live_tracking_within_hours(v_rep.territory_id, now()) then
    v_reason := 'outside_working_hours'; v_sqlstate := '45003';
  elsif p_accuracy_m is not null and p_accuracy_m > 5000 then
    -- Five kilometres is a cell-tower guess, not a position anybody should be shown.
    v_reason := 'implausible_accuracy';  v_sqlstate := '22023';
  elsif exists (
    select 1 from public.location_pings lp
     where lp.mr_id = v_rep.id
       and lp.received_at > clock_timestamp() - make_interval(secs => v_interval / 2.0)
  ) then
    -- The interval is the company's, not the phone's: a handset sending faster is refused.
    v_reason := 'too_frequent';          v_sqlstate := '22023';
  end if;

  if v_reason is not null then
    perform public.record_write_rejection(
      'record_location_ping', v_sqlstate, 'location_ping', p_id, null, v_reason);
    return jsonb_build_object('stored', false, 'replayed', false, 'reason', v_reason,
                              'receivedAt', null);
  end if;

  insert into public.location_pings
    (id, organisation_id, mr_id, territory_id, notice_version_id,
     latitude, longitude, accuracy_m, recorded_at, received_at, purge_after)
  values
    (p_id, v_rep.organisation_id, v_rep.id, v_rep.territory_id, v_notice.id,
     p_latitude, p_longitude, p_accuracy_m, p_recorded_at, now(), now())
  returning received_at into v_received;

  return jsonb_build_object('stored', true, 'replayed', false, 'reason', null,
                            'receivedAt', v_received);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The console's RPCs -- managers and admins
-- ---------------------------------------------------------------------------

-- Every rep the caller may see, with their latest position. `visible_user_ids()` is the one rule
-- for "may see": a manager's territory subtree and reporting line, an admin's company.
create or replace function public.live_tracking_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_notice public.live_tracking_notice_versions%rowtype;
  v_reps   jsonb;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role not in ('field_manager', 'admin') then
    raise exception 'only a manager or an admin sees reps'' locations' using errcode = '42501';
  end if;
  v_notice := public.current_live_tracking_notice(v_caller.organisation_id);

  select coalesce(jsonb_agg(r.rep order by r.full_name, r.id), '[]'::jsonb) into v_reps
    from (
      select p.full_name, p.id, jsonb_build_object(
        'mrId', p.id,
        'fullName', p.full_name,
        'territoryName', t.name,
        'accepted', public.live_tracking_accepted_version(p.id) is not distinct from v_notice.id
                    and public.live_tracking_accepted_version(p.id) is not null,
        'today', public.rep_today(p.id),
        -- The zone the rep's day and times are reckoned in, so the console shows the rep's clock.
        'timeZone', (select z.time_zone from public.day_zone_unchecked(p.id) z),
        'pingsToday', (
          select count(*) from public.location_pings lp, public.day_zone_unchecked(p.id) z
           where lp.mr_id = p.id
             and (lp.received_at at time zone z.time_zone)::date = public.rep_today(p.id)),
        'latest', (
          select jsonb_build_object(
                   'latitude', lp.latitude, 'longitude', lp.longitude, 'accuracyM', lp.accuracy_m,
                   'recordedAt', lp.recorded_at, 'receivedAt', lp.received_at,
                   -- `received_at` is `clock_timestamp()`, `now()` is the transaction's start:
                   -- a position received during this very transaction is 0 seconds old, not -1.
                   'ageSeconds', greatest(0, floor(extract(epoch from now() - lp.received_at)))::integer)
            from public.location_pings lp
           where lp.mr_id = p.id
           order by lp.received_at desc
           limit 1)) as rep
        from public.user_profiles p
        left join public.territories t on t.id = p.territory_id
       where p.id in (select public.visible_user_ids())
         and p.role = 'mr'
         and p.is_active
         and p.organisation_id = v_caller.organisation_id
    ) r;

  return jsonb_build_object(
    'companyEnabled', public.live_tracking_company_enabled(),
    'intervalSeconds', public.live_tracking_interval_seconds(),
    'canChangeSwitch', v_caller.role = 'admin',
    'notice', case when v_notice.id is null then null else jsonb_build_object(
      'id', v_notice.id, 'versionLabel', v_notice.version_label,
      'isDraft', v_notice.organisation_id is null) end,
    'serverTime', now(),
    'reps', v_reps);
end;
$$;

-- One rep's positions on one of their territory days (default: their today), oldest first. The rep
-- may read their own; a manager or admin, any rep `visible_user_ids()` gives them.
create or replace function public.live_tracking_trail(p_mr_id uuid, p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_target public.user_profiles%rowtype;
  v_zone   text;
  v_day    date;
  v_points jsonb;
begin
  select * into v_caller from public.lms_caller();
  select * into v_target from public.user_profiles p where p.id = p_mr_id;
  -- One answer for "no such rep" and "not yours": the difference is itself a cross-tenant read.
  if v_target.id is null
     or v_target.role <> 'mr'
     or v_target.organisation_id <> v_caller.organisation_id
     or (v_caller.role = 'mr' and v_target.id <> v_caller.user_id)
     or v_target.id not in (select public.visible_user_ids()) then
    raise exception 'not permitted to see that rep''s locations' using errcode = '42501';
  end if;

  select z.time_zone into v_zone from public.day_zone_unchecked(p_mr_id) z;
  v_day := coalesce(p_day, public.rep_today(p_mr_id));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', lp.id, 'latitude', lp.latitude, 'longitude', lp.longitude,
           'accuracyM', lp.accuracy_m, 'recordedAt', lp.recorded_at, 'receivedAt', lp.received_at)
           order by lp.received_at, lp.id), '[]'::jsonb)
    into v_points
    from public.location_pings lp
   where lp.mr_id = p_mr_id
     and lp.received_at >= (v_day::timestamp at time zone v_zone) - interval '1 day'
     and lp.received_at <  ((v_day + 1)::timestamp at time zone v_zone) + interval '1 day'
     and (lp.received_at at time zone v_zone)::date = v_day;

  return jsonb_build_object(
    'mrId', v_target.id, 'fullName', v_target.full_name,
    'day', v_day, 'timeZone', v_zone, 'points', v_points);
end;
$$;

-- The company switch. Admin only; a new organisation-scoped `app_thresholds` row, which is
-- append-only and audited by `app_thresholds_audit` -- the who and when are in `audit_log`, the why
-- is the row's note. A reason is required, because turning on monitoring of employees is a decision.
create or replace function public.set_live_tracking_enabled(p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_caller record;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin switches live tracking on or off' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'say on or off' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'live_tracking_switch_needs_reason' using errcode = '22023';
  end if;

  insert into public.app_thresholds
    (key, value, scope, organisation_id, note, set_by_user_id, effective_from)
  values
    ('live_tracking_enabled', to_jsonb(p_enabled), 'organisation', v_caller.organisation_id,
     btrim(p_reason), v_caller.user_id, now());

  return jsonb_build_object('enabled', public.live_tracking_company_enabled(), 'setAt', now());
end;
$$;

-- An admin loads the company's own notice text. Not shown to anybody until a second admin approves.
create or replace function public.propose_live_tracking_notice(p_version_label text, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_id     uuid;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin loads a notice' using errcode = '42501';
  end if;
  insert into public.live_tracking_notice_versions (organisation_id, version_label, body, authored_by_user_id)
  values (v_caller.organisation_id, btrim(p_version_label), p_body, v_caller.user_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- A second admin approves it; the trigger holds the four-eyes rule whoever inserts.
create or replace function public.approve_live_tracking_notice(p_notice_version_id uuid, p_attestation text)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_org    uuid;
  v_id     uuid;
begin
  select * into v_caller from public.lms_caller();
  if v_caller.role <> 'admin' then
    raise exception 'only an admin approves a notice' using errcode = '42501';
  end if;
  select v.organisation_id into v_org
    from public.live_tracking_notice_versions v where v.id = p_notice_version_id;
  if v_org is distinct from v_caller.organisation_id then
    raise exception 'notice version % is not your company''s', p_notice_version_id using errcode = '42501';
  end if;
  insert into public.live_tracking_notice_approvals (notice_version_id, approved_by_user_id, attestation)
  values (p_notice_version_id, v_caller.user_id, btrim(coalesce(p_attestation, '')))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Retention -- `BE-W181`
-- ---------------------------------------------------------------------------
--
-- Called by the hourly retention worker (`scripts/purge-expired-audio.mjs`, `retention.yml`), which
-- connects as the database owner. Deletes at most `p_limit` expired positions, oldest first, and
-- answers how many. The arithmetic: 150 reps x 12 an hour x 10 hours is 18,000 a day, 750 an hour;
-- the worker passes 10,000, so a day's backlog drains in one run.
create or replace function public.purge_expired_location_pings(p_limit integer)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'a purge batch is at least one row' using errcode = '22023';
  end if;
  delete from public.location_pings lp
   where lp.id in (
     select e.id from public.location_pings e
      where e.purge_after <= clock_timestamp()
      order by e.purge_after
      limit p_limit);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Row rules and grants
-- ---------------------------------------------------------------------------

alter table public.live_tracking_notice_versions enable row level security;
alter table public.live_tracking_notice_versions force row level security;
alter table public.live_tracking_notice_approvals enable row level security;
alter table public.live_tracking_notice_approvals force row level security;
alter table public.live_tracking_acceptances enable row level security;
alter table public.live_tracking_acceptances force row level security;
alter table public.location_pings enable row level security;
alter table public.location_pings force row level security;

-- Revoke before grant: Supabase hands anon and authenticated TRUNCATE on every new table.
revoke all on table public.live_tracking_notice_versions from anon, authenticated;
revoke all on table public.live_tracking_notice_approvals from anon, authenticated;
revoke all on table public.live_tracking_acceptances from anon, authenticated;
revoke all on table public.location_pings from anon, authenticated;
revoke insert, update, delete, truncate on table public.live_tracking_notice_versions from service_role;
revoke insert, update, delete, truncate on table public.live_tracking_notice_approvals from service_role;
revoke insert, update, delete, truncate on table public.live_tracking_acceptances from service_role;
revoke insert, update, delete, truncate on table public.location_pings from service_role;

-- Notices: the engineering draft and the caller's own company's versions.
create policy live_tracking_notice_versions_select on public.live_tracking_notice_versions
  for select to authenticated
  using (organisation_id is null or organisation_id = public.current_user_organisation_id());
create policy live_tracking_notice_versions_tenant_boundary on public.live_tracking_notice_versions
  as restrictive for all to authenticated
  using (organisation_id is null or organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy live_tracking_notice_approvals_select on public.live_tracking_notice_approvals
  for select to authenticated
  using (notice_version_id in (select v.id from public.live_tracking_notice_versions v));

-- Acceptances and positions: whoever may see the rep.
create policy live_tracking_acceptances_select on public.live_tracking_acceptances
  for select to authenticated
  using (mr_id in (select public.visible_user_ids()));
create policy live_tracking_acceptances_tenant_boundary on public.live_tracking_acceptances
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

create policy location_pings_select on public.location_pings
  for select to authenticated
  using (mr_id in (select public.visible_user_ids()));
create policy location_pings_tenant_boundary on public.location_pings
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

grant select on table public.live_tracking_notice_versions to authenticated;
grant select on table public.live_tracking_notice_approvals to authenticated;
grant select on table public.live_tracking_acceptances to authenticated;
grant select on table public.location_pings to authenticated;

revoke all on function public.live_tracking_notice_approval_valid() from public, anon, authenticated;
revoke all on function public.location_pings_stamp() from public, anon, authenticated;
revoke all on function public.location_pings_delete_only_expired() from public, anon, authenticated;
revoke all on function public.current_live_tracking_notice(uuid) from public, anon, authenticated;
revoke all on function public.live_tracking_accepted_version(uuid) from public, anon, authenticated;
revoke all on function public.live_tracking_within_hours(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.live_tracking_company_enabled() from public, anon, authenticated;
revoke all on function public.live_tracking_interval_seconds() from public, anon, authenticated;
revoke all on function public.live_tracking_rep() from public, anon, authenticated;
revoke all on function public.live_tracking_status_for(public.user_profiles) from public, anon, authenticated;
revoke all on function public.purge_expired_location_pings(integer) from public, anon, authenticated, service_role;

revoke all on function public.my_live_tracking() from public, anon;
revoke all on function public.accept_live_tracking_notice(uuid) from public, anon;
revoke all on function public.withdraw_live_tracking() from public, anon;
revoke all on function public.record_location_ping(uuid, double precision, double precision, double precision, timestamptz)
  from public, anon;
revoke all on function public.live_tracking_overview() from public, anon;
revoke all on function public.live_tracking_trail(uuid, date) from public, anon;
revoke all on function public.set_live_tracking_enabled(boolean, text) from public, anon;
revoke all on function public.propose_live_tracking_notice(text, text) from public, anon;
revoke all on function public.approve_live_tracking_notice(uuid, text) from public, anon;

grant execute on function public.my_live_tracking() to authenticated;
grant execute on function public.accept_live_tracking_notice(uuid) to authenticated;
grant execute on function public.withdraw_live_tracking() to authenticated;
grant execute on function public.record_location_ping(uuid, double precision, double precision, double precision, timestamptz)
  to authenticated;
grant execute on function public.live_tracking_overview() to authenticated;
grant execute on function public.live_tracking_trail(uuid, date) to authenticated;
grant execute on function public.set_live_tracking_enabled(boolean, text) to authenticated;
grant execute on function public.propose_live_tracking_notice(text, text) to authenticated;
grant execute on function public.approve_live_tracking_notice(uuid, text) to authenticated;

comment on table public.location_pings is
  'BE-W180: a rep''s live position, kept only if the company switched live tracking on, the rep had '
  'accepted the current notice, and it was taken and received inside working hours. Written only by '
  'record_location_ping; deleted only after purge_after (90 days from receipt) by '
  'purge_expired_location_pings (BE-W181).';
comment on table public.live_tracking_acceptances is
  'BE-W180: append-only. The latest row per rep decides; a new notice version needs a new acceptance.';
