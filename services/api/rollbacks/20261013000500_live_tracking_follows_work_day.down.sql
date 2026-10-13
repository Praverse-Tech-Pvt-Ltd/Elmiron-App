-- Rollback for 20261013000500_live_tracking_follows_work_day.sql (`BE-W200`)
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Restores both functions exactly as `20261013000100` defined them, then drops the helper.

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

drop function public.live_tracking_day_ended(uuid);
