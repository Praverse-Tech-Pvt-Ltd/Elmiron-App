-- BE-W21 — UCPMP sample caps, enforced server-side.
--
-- `SampleAndInputSchema` has claimed since BE-W1 that "UCPMP caps are enforced
-- server-side". Nothing enforced them: `samples_and_inputs` has no limit column, no check
-- constraint, `20260811000400_rls_policies.sql` grants a plain insert with no cap
-- predicate, and nothing computes a month to date. `docs/fe-w3-spec.md` §C5 says so in as
-- many words -- the comment "describes an intention, not the schema as it stands". That
-- comment is corrected in `packages/core` in the same change as this migration.
--
-- ----------------------------------------------------------------------------
-- THE NUMBER IS NOT IN THIS MIGRATION, ON PURPOSE.
-- ----------------------------------------------------------------------------
--
-- `docs/fe-w3-spec.md` §C5 refuses to draw the cap meter from an invented ceiling, and
-- the reasoning applies with more force to a constraint than to a meter:
--
--   "A meter drawn from an invented number is the worst thing this screen could contain
--    -- an MR who believes the app is holding the compliance line stops holding it
--    themselves, and hears otherwise as a finding with their name on it."
--
-- A constraint built on an invented number is worse still: it looks enforced, it produces
-- refusals an MR cannot argue with, and it would be wrong in a direction nobody could see.
-- **Nothing in this repository states what the cap is.** So this migration builds the
-- mechanism and leaves the ceiling `null`, exactly as `org_default_shift_window` does.
--
-- With no cap configured, a sample write behaves precisely as it does today: accepted,
-- uncounted, and the samples screen keeps telling the MR the app is not counting. The
-- moment somebody with authority sets `ucpmp_sample_cap_quantity`, the cap is enforced by
-- the database and the screen's meter has something true to draw.
--
-- **UNVERIFIED, and each needs a human:**
--   * the ceiling itself
--   * the dimension -- this implements per doctor, per item, per calendar month, which is
--     the narrowest defensible reading of UCPMP's limit on samples supplied to a medical
--     practitioner. Per MR, per product family or per quarter are all arguable.
--   * the VALUE limit is deliberately out of scope. UCPMP 2024 expresses one ceiling as a
--     percentage of the company's domestic sales for the year -- a company-level annual
--     figure this application does not hold and should not guess at.

-- ----------------------------------------------------------------------------
-- 1. The configurable ceiling, unset
-- ----------------------------------------------------------------------------
insert into public.app_thresholds (key, value, unit, scope, note)
values (
  'ucpmp_sample_cap_quantity',
  'null'::jsonb,
  'packs per doctor per item per calendar month',
  'global',
  'UNSET on purpose. Nothing in this repository states the UCPMP ceiling, and a '
  'constraint built on an invented number looks enforced while being wrong invisibly. '
  'Set this only from an authoritative source, and record the source in this note. '
  'While null, samples are accepted and uncounted and the app says so. See BE-W21.'
);

-- ----------------------------------------------------------------------------
-- 2. The meter read the frontend has been blocked on
-- ----------------------------------------------------------------------------
--
-- `fe-w3-spec.md` §C5: "BLOCKED ON BACKEND. A monthly-cap read -- the limit and the MR's
-- month to date." This is that read. It returns `cap: null` when unconfigured so the
-- screen can keep showing its note rather than a meter; a client must not draw a ceiling
-- from a null.
create function public.sample_cap_status(
  p_doctor_id uuid,
  p_item_name text,
  p_at        timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid          uuid;
  v_territory    uuid;
  v_cap          numeric;
  v_used         integer;
  v_period_start timestamptz;
  v_period_end   timestamptz;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.territory_id into v_territory from public.user_profiles p where p.id = v_uid;

  v_period_start := date_trunc('month', p_at);
  v_period_end   := v_period_start + interval '1 month';
  v_cap := public.threshold_number('ucpmp_sample_cap_quantity', v_territory, null);

  select coalesce(sum(s.quantity), 0) into v_used
    from public.samples_and_inputs s
   where s.doctor_id = p_doctor_id
     and s.item_name = p_item_name
     and s.occurred_at >= v_period_start
     and s.occurred_at <  v_period_end;

  return jsonb_build_object(
    'cap', case when v_cap is null then null else v_cap::integer end,
    'used', v_used,
    'remaining', case when v_cap is null then null else greatest(v_cap::integer - v_used, 0) end,
    'periodStart', v_period_start,
    'periodEnd', v_period_end,
    'itemName', p_item_name,
    'doctorId', p_doctor_id
  );
end;
$$;

revoke execute on function public.sample_cap_status(uuid, text, timestamptz) from public, anon;
grant execute on function public.sample_cap_status(uuid, text, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Enforcement
-- ----------------------------------------------------------------------------
--
-- A trigger rather than a check constraint: the rule spans rows -- it is a sum over a
-- month for one doctor and item -- and a check constraint sees only the row in front of
-- it. A trigger also fires for `service_role` and the table owner, which a policy would
-- not.
--
-- SQLSTATE 45004, its own code in the range 45001-45003 established. This refusal has a
-- remedy the MR can act on -- stop, and take it to their manager -- so it must be
-- distinguishable from every other failure. `detail` carries the numbers because "you
-- have exceeded the cap" without the cap, the count and the period is not actionable.
create function public.enforce_ucpmp_sample_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_territory    uuid;
  v_cap          numeric;
  v_used         integer;
  v_period_start timestamptz;
begin
  select p.territory_id into v_territory
    from public.user_profiles p where p.id = new.mr_id;

  v_cap := public.threshold_number('ucpmp_sample_cap_quantity', v_territory, null);

  -- Unconfigured means unenforced, and the app says as much to the MR. This is the
  -- branch taken today.
  if v_cap is null then
    return new;
  end if;

  v_period_start := date_trunc('month', new.occurred_at);

  select coalesce(sum(s.quantity), 0) into v_used
    from public.samples_and_inputs s
   where s.doctor_id = new.doctor_id
     and s.item_name = new.item_name
     and s.occurred_at >= v_period_start
     and s.occurred_at <  v_period_start + interval '1 month'
     and s.id <> new.id;

  if v_used + new.quantity > v_cap then
    raise exception
      'this would put % over the UCPMP cap for % this month', new.item_name, new.doctor_id
      using errcode = '45004',
            detail  = format(
              'cap %s, already given %s, this entry %s, period starting %s',
              v_cap::integer, v_used, new.quantity, v_period_start::date),
            hint    = 'Stop and speak to your manager. The quantity is never trimmed to fit.';
  end if;

  return new;
end;
$$;

-- A trigger function needs no EXECUTE grant to fire, so revoking costs nothing and keeps
-- the posture the `rls.spec.ts` guard enforces: nothing in `public` is anon-executable.
-- That guard caught this function the first time this migration ran, which is what it is
-- for -- Supabase's default ACL grants `anon` on every new function and no migration can
-- change that default (FIX-06 D2).
revoke execute on function public.enforce_ucpmp_sample_cap() from public, anon;

create trigger samples_and_inputs_ucpmp_cap
  before insert on public.samples_and_inputs
  for each row execute function public.enforce_ucpmp_sample_cap();

comment on trigger samples_and_inputs_ucpmp_cap on public.samples_and_inputs is
  'BE-W21. Refuses a distribution that would exceed ucpmp_sample_cap_quantity with '
  'SQLSTATE 45004. Inert while that threshold is null, which it is until somebody with '
  'authority sets it. Never trims the quantity to fit.';
