-- Rollback for BE-W97's second half -- the 45004 sentence naming the doctor.
--
-- This restores `enforce_ucpmp_sample_cap` as 20260907000700_ucpmp_sample_caps.sql created it,
-- with `create function` rewritten to `create or replace` so it can be applied over the
-- version it is undoing. The trigger is not touched: it binds the name, and the name is
-- unchanged.
--
-- WHAT APPLYING THIS MEANS. A rep refused at the UCPMP cap is shown the doctor's UUID again,
-- in front of the doctor. They cannot check it, repeat it to their manager, or tell whether it
-- is even the right doctor.
--
-- The DETAIL and HINT are identical in both versions, so the figures keep reaching the MR
-- provided 20260911000800 is still applied. These two migrations are independent in both
-- directions and either can be rolled back without the other.
--
-- The `comment on trigger` is restored to its BE-W21 wording below, because a comment that
-- describes behaviour the function no longer has is worse than no comment.

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


comment on trigger samples_and_inputs_ucpmp_cap on public.samples_and_inputs is
  'BE-W21. Refuses a distribution that would exceed ucpmp_sample_cap_quantity with '
  'SQLSTATE 45004. Inert while that threshold is null, which it is until somebody with '
  'authority sets it. Never trims the quantity to fit.';
