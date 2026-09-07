-- ============================================================================
-- BE-W21 (2 of 2) · The UCPMP cap decision acquires a deadline
--
-- `20260907000700_ucpmp_sample_caps.sql` built the cap mechanism and left
-- `ucpmp_sample_cap_quantity` null on purpose, because nothing in this repository
-- states what the UCPMP ceiling is and a constraint built on an invented number looks
-- enforced while being wrong invisibly.
--
-- That is the right call and it has a hole in it: **nothing forces anybody to answer.**
-- The precedent it followed does not have that hole. `org_default_shift_window` must
-- carry an `expiresAt` no more than 60 days out (`20260816000200_shift_window_expiry.sql`),
-- and when it lapses the system goes back to refusing. Its own header says why:
--
--   "That converts 'we will fix this before the pilot' from an intention into a
--    deadline the system enforces. It also means that if the client never sends the
--    real working hours, the system tells them by failing, which is the only message
--    anyone reliably reads."
--
-- The cap has the same shape and none of the enforcement. Left alone the failure mode
-- is: months pass, `samples_and_inputs` accepts everything, `packages/core` no longer
-- lies because FIX-09 corrected the comment, and the only thing between the product and
-- the original claim is that nobody deleted the samples screen's apology.
--
-- ----------------------------------------------------------------------------
-- WHY A DEADLINE AND A CHECK, AND NOT AN EXPIRY THAT STARTS REFUSING
-- ----------------------------------------------------------------------------
--
-- The shift-window mechanism expires a PERMISSIVE VALUE back to a strict default. There
-- is nothing to expire back to here: the permissive state is the ABSENCE of a value, and
-- the only "strict" reading would be to start refusing every sample write on a date. That
-- would punish an MR for a decision nobody has asked them to make, on a write path that
-- still goes to `services/mock` and would land on real MRs the day it is converted.
--
-- So the deadline binds the people who own the decision rather than the people using the
-- app: it fails CI, loudly, with the question and the owner in the failure message.
-- Rejected alternatives, and why:
--
--   * refuse sample writes after the date -- punishes the wrong party (above)
--   * a startup warning -- a log line nobody reads is what this project calls a flag
--     that is "real and invisible"
--   * a calendar-dependent unit test -- would break `pnpm test` for a developer who
--     owns none of this, at which point it gets skipped and stops being a control
--   * pick a default cap so the problem goes away -- explicitly forbidden, and it is
--     the exact failure `20260907000700` was written to avoid
--
-- The check therefore lives in a SCRIPT (`check:decision-debt`) wired into CI, and the
-- test suite tests the MECHANISM on a backdated row rather than the calendar. Local
-- development and `pnpm test` are never blocked by a date.
--
-- Escaping it is possible and is meant to be: set the cap, or file a NEW migration
-- moving the date with a reason in the note. `app_thresholds` is append-only, so a
-- deferral is a dated, attributable row rather than a quiet edit.
--
-- Rollback: services/api/rollbacks/20260907000900_ucpmp_cap_decision_deadline.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The deadline
-- ----------------------------------------------------------------------------
--
-- Sixty days from this migration, which is the ceiling `validate_app_threshold()`
-- already imposes on the org default shift window. The number is borrowed rather than
-- invented, and it is the one number in this area that does NOT need a human: it is a
-- property of how long this project has already decided a stopgap may live.
insert into public.app_thresholds (key, value, unit, scope, note)
values (
  'ucpmp_sample_cap_decision_due',
  '"2026-11-06T00:00:00Z"'::jsonb,
  'ISO timestamp',
  'global',
  'Deadline for answering: what is the UCPMP sample cap, on what dimension, and who '
  'at the client owns that number? Until ucpmp_sample_cap_quantity is set, the cap '
  'trigger from BE-W21 is inert and samples are accepted uncounted. After this date '
  'check:decision-debt fails CI. To defer, insert a NEW row with a later '
  'effective_from and a reason in this note -- this table is append-only, so a '
  'deferral is on the record. 60 days is the same ceiling '
  'validate_app_threshold() puts on org_default_shift_window.'
);

-- ----------------------------------------------------------------------------
-- 2. The status, readable before it bites
-- ----------------------------------------------------------------------------
--
-- Same shape and same reasoning as `org_default_shift_window_status()`: a deadline whose
-- arrival is only discoverable by something breaking is a worse deadline than one with a
-- visible date.
--
-- FAIL CLOSED. A missing or null deadline reads as overdue, not as "no deadline". The
-- alarm must not be silenceable by removing the row that carries it -- that is the
-- failure mode of the inert `ALTER DEFAULT PRIVILEGES` in FIX-05, which looked like a
-- control and enforced nothing.
create function public.ucpmp_cap_decision_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (
    select public.threshold('ucpmp_sample_cap_quantity') as cap,
           public.threshold('ucpmp_sample_cap_decision_due') as due
  ),
  parsed as (
    select
      (v.cap is not null and jsonb_typeof(v.cap) <> 'null') as cap_configured,
      case
        when v.due is null or jsonb_typeof(v.due) <> 'string' then null
        else (v.due #>> '{}')::timestamptz
      end as due_at
    from v
  )
  select jsonb_build_object(
    'capConfigured', p.cap_configured,
    'dueAt', p.due_at,
    'overdue', not p.cap_configured and (p.due_at is null or p.due_at <= now()),
    'daysRemaining', case
      when p.cap_configured then null
      when p.due_at is null then 0
      else greatest(0, ceil(extract(epoch from (p.due_at - now())) / 86400)::integer)
    end,
    'question', 'What is the UCPMP sample cap, on what dimension, and who at the '
                'client owns that number?'
  )
  from parsed p;
$$;

revoke execute on function public.ucpmp_cap_decision_status() from public, anon;
grant execute on function public.ucpmp_cap_decision_status() to authenticated;

comment on function public.ucpmp_cap_decision_status() is
  'BE-W21. Whether the UCPMP cap decision is still outstanding and whether its '
  'deadline has passed. Fails closed: a missing deadline reads as overdue, so the '
  'alarm cannot be silenced by deleting the row that carries it. check:decision-debt '
  'turns this into a CI failure; nothing here blocks a sample write or a test run.';
