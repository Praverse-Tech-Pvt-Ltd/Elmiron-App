-- Rollback for 20260908001000_withdrawal_timestamp_bounds.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- **This reopens BE-W77.** After it runs, a consent withdrawal may again be stamped at
-- any moment its author chooses: five years before the consent it supersedes, or a year
-- into the future, both accepted without comment -- while the same future instant is
-- still refused `45007` on a capture.
--
-- A withdrawal is the record that decides whether everything processed since the original
-- consent was lawful. Backdating one manufactures a breach retroactively; forward-dating
-- one delays a right the doctor has already exercised, which is the DPDP s.6(4) violation
-- itself. Neither is bounded once this file has run.
--
-- If the BOUNDS are the problem rather than the mechanism, change the thresholds instead:
-- `consent_future_tolerance_seconds` and `consent_max_sync_lag_hours` are append-only
-- rows in `app_thresholds`, so a new value is a dated, attributable change and does not
-- require removing the checks. Only the third bound -- a withdrawal may not predate its
-- consent -- has no threshold, because there is no value of it that could be right.

create or replace function public.validate_consent_withdrawal()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  v_original public.consent_records%rowtype;
begin
  if new.supersedes_consent_record_id is null then
    return new;
  end if;

  select * into v_original
    from public.consent_records c
   where c.id = new.supersedes_consent_record_id;

  if not found then
    raise exception 'consent record % does not exist', new.supersedes_consent_record_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_original.outcome <> 'consented' then
    raise exception 'consent record % has outcome %; only a granted consent can be withdrawn',
      v_original.id, v_original.outcome
      using errcode = 'check_violation';
  end if;

  if v_original.doctor_id <> new.doctor_id then
    raise exception 'withdrawal is for doctor % but the original consent is for doctor %',
      new.doctor_id, v_original.doctor_id
      using errcode = 'check_violation';
  end if;

  if v_original.is_withdrawal then
    raise exception 'consent record % is itself a withdrawal', v_original.id
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;
