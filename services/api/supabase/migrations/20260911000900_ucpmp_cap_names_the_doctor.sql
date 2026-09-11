-- ============================================================================
-- BE-W97 (second half) - the 45004 sentence names the doctor, not their UUID
--
-- What an MR read on the samples screen in MR-27 C2:
--
--     this would put MR27 UCPMP c over the UCPMP cap for
--     83aa5660-470b-4c82-aa90-000b5347cb1c this month
--
-- The product name was already there. The second `%` was `new.doctor_id`, and a UUID in
-- front of a rep standing in a clinic is not information -- it is the shape of
-- information. The MR cannot check it, cannot repeat it to their manager, and cannot
-- tell whether it is even the doctor they are with.
--
-- ----------------------------------------------------------------------------
-- WHY THE NAME IS SAFE TO PUT IN A REFUSAL
-- ----------------------------------------------------------------------------
--
-- The refusal is raised while inserting a row the MR themselves is writing, against a
-- `doctor_id` the MR themselves supplied, and it is returned only to that MR's own sync
-- verdict. The name leaks nothing they did not already have on screen.
--
-- `coalesce(..., new.doctor_id::text)` keeps the old behaviour when there is no row to
-- read -- a doctor deleted between the screen and the flush. A refusal that says nothing
-- because a lookup missed would be worse than a UUID.
--
-- ----------------------------------------------------------------------------
-- THE DETAIL AND HINT ARE UNCHANGED, DELIBERATELY
-- ----------------------------------------------------------------------------
--
-- They were always correct. What was wrong is that `sync_push` discarded them, which the
-- migration beside this one fixes. Rewriting them here as well would make it impossible
-- to tell which of the two changes put the figures on the screen -- and "the fix worked"
-- is not evidence the diagnosis was right.
--
-- Rollback: services/api/rollbacks/20260911000900_ucpmp_cap_names_the_doctor.down.sql
-- ============================================================================

create or replace function public.enforce_ucpmp_sample_cap()
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
  v_doctor       text;
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
    -- Read only in the branch that refuses. The cap is unconfigured everywhere today
    -- (5.9), so the common path is the early return above and this trigger must stay
    -- free of a per-insert lookup it does not need.
    select d.full_name into v_doctor
      from public.doctors d where d.id = new.doctor_id;

    raise exception
      'this would put % over the UCPMP cap for % this month',
      new.item_name, coalesce(v_doctor, new.doctor_id::text)
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
-- Re-applied because `create or replace` does not reset an ACL, but Supabase's default
-- privileges are applied to a function the first time it is CREATED -- and this file is
-- also run against a database that has never seen the original. FIX-06 D2.
revoke execute on function public.enforce_ucpmp_sample_cap() from public, anon;

comment on trigger samples_and_inputs_ucpmp_cap on public.samples_and_inputs is
  'BE-W21/BE-W97. Refuses a distribution that would exceed ucpmp_sample_cap_quantity with '
  'SQLSTATE 45004, naming the doctor rather than their id, and carrying the cap, the '
  'month-to-date total, this entry and the period in DETAIL. Inert while that threshold '
  'is null, which it is until somebody with authority sets it. Never trims to fit.';
