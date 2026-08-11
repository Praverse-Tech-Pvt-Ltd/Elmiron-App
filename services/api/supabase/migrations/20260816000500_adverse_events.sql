-- ============================================================================
-- BE-W7 (5 of 5) · Adverse-event ingest — the mechanical half only
--
-- WHAT IS DELIBERATELY MISSING FROM THIS FILE
--
-- The PV and privacy sign-off that governs the legal design of this path has been
-- outstanding since week 1. Plan §0.4 sets out why it cannot be guessed: IPC
-- Pharmacovigilance Guidance §2.6 requires an IDENTIFIABLE PATIENT for a valid case
-- report, and DPDP minimisation requires that this app never retain one. Those pull
-- in opposite directions and the resolution is an organisational decision in
-- writing, not an engineering one.
--
-- So this file builds only what the plan already settles and no answer can change:
--
--   * the ingest record, and the fact that it is append-only;
--   * the statutory clock, started by the server at receipt;
--   * that routing goes to a human, always.
--
-- It does NOT build: who the PV officer is, the notification channel, what happens
-- at day thirteen, or any escalation ladder. Those assume an org structure this
-- project has not been told. Guessing them would produce a compliance artifact built
-- on an invention, which is worse than an obviously incomplete one.
--
-- THE PART THAT IS NOT MECHANICAL AND IS HERE ANYWAY
--
-- `reported_text` exists. An MR who witnesses an adverse event must be able to say
-- what happened, and a report with no description discharges no duty. It is also the
-- one field in this table that can carry patient information, which is precisely the
-- §2.6-versus-DPDP tension nobody has ruled on. It is flagged rather than omitted,
-- because omitting it would silently decide the question by making the feature
-- useless. See PROJECT-OVERVIEW.md, BE-W7.
--
-- Rollback: services/api/rollbacks/20260816000500_adverse_events.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Housekeeping from the BE-W6 review — the voice_notes retention reasoning
-- ----------------------------------------------------------------------------

-- BE-W6 justified the ninety-day purge on voice notes by symmetry: they are audio,
-- so treat them like audio. That reasoning is the weaker one and it is replaced
-- here, because if somebody later argues for a longer retention to improve
-- performance assessment, that argument should have to beat a privacy position
-- rather than a consistency preference.
comment on table public.voice_notes is
  'The MR''s own post-visit note, purged at ninety days like a recording — but for '
  'a stronger reason than symmetry. A voice note summarising a consultation can name '
  'a patient the doctor discussed, which is the same DPDP exposure as the recording '
  'itself. Unlike the recording, NOBODY CONSENTED TO IT AT ALL: the doctor agreed to '
  'the conversation being recorded, not to the MR''s subsequent commentary about it. '
  'And it is an employee''s voice held by their employer, so holding it longer than '
  'needed makes the worker-monitoring position worse and never better.';

-- ----------------------------------------------------------------------------
-- 2. The ingest record
-- ----------------------------------------------------------------------------

create type public.adverse_event_source as enum (
  -- An MR typed it. They witnessed something and said so.
  'mr_reported',
  -- The transcript pipeline flagged a passage. The pipeline flags; it never judges.
  'transcript_detected'
);

create table public.adverse_event_reports (
  id                     uuid primary key,
  visit_id               uuid not null references public.visits (id) on delete restrict,
  source                 public.adverse_event_source not null,
  reported_by_mr_id      uuid references public.user_profiles (id) on delete restrict,

  -- A pointer into the REDACTED transcript, never the raw one, and never a copy of
  -- the text. The redaction gate is the only reason an automated detector is allowed
  -- to look at a consultation at all, and a table that copied the passage out would
  -- route around it.
  --
  -- DELIBERATELY NOT A FOREIGN KEY, and this was found by a test rather than by
  -- reasoning. Written as `references ... on delete set null`, the withdrawal cascade
  -- deleting a redacted transcript makes Postgres issue an UPDATE against this table
  -- — which the append-only trigger refuses, so a consent withdrawal fails outright
  -- the moment any adverse event references the visit. An append-only table cannot
  -- carry a nullifying foreign key.
  --
  -- `on delete restrict` would be worse: it lets an adverse-event report veto a
  -- doctor's withdrawal. So the column is a plain uuid, and after the transcript is
  -- destroyed the pointer dangles — which is the honest state of affairs. The report
  -- survives the withdrawal because a pharmacovigilance duty is a separate legal
  -- basis from consent, and destroying a statutory record to satisfy a privacy
  -- request is not a trade this system should make on its own. FLAGGED FOR THE
  -- SIGN-OFF: whether the report survives is exactly the kind of question the PV and
  -- privacy review exists to answer, and this is the safe default until it does.
  redacted_transcript_id uuid,
  transcript_segment_id  uuid,

  -- The MR's own words. See the header: this is the field the sign-off must rule on.
  reported_text          text,

  -- What the device claimed. Kept because it is evidence about the MR's experience,
  -- and pointedly NOT the clock.
  client_reported_at     timestamptz,

  -- The clock. Both stamped by trigger from the server, never from the request.
  received_at            timestamptz not null default clock_timestamp(),
  statutory_due_at       timestamptz not null default clock_timestamp(),

  created_at             timestamptz not null default now(),

  constraint adverse_event_mr_reported_shape
    check (
      case source
        when 'mr_reported' then
          reported_by_mr_id is not null and length(btrim(coalesce(reported_text, ''))) > 0
        when 'transcript_detected' then
          redacted_transcript_id is not null and reported_text is null
      end
    )
);

create index adverse_event_reports_due_idx   on public.adverse_event_reports (statutory_due_at);
create index adverse_event_reports_visit_idx on public.adverse_event_reports (visit_id);

-- THE ABSENCE IS THE DESIGN.
--
-- There is no severity column, no priority column, no triage state, no confidence
-- score, no category and no assessment. Not because they were forgotten — because
-- if a column existed that a model could write a judgement into, a model would
-- eventually write a judgement into it, and every adverse event this system ever
-- sees would then have been pre-sorted by software before a human read it.
--
-- Plan §1 is explicit: the MR app hands adverse events to the same human PV queue
-- the patient diary feeds, and it never handles one itself. A test asserts these
-- column names are absent, so the next person to want one has to delete the test.
comment on table public.adverse_event_reports is
  'Append-only ingest for possible adverse events. Routed to a human queue, always. '
  'There is deliberately no severity, priority, triage or score column: a column a '
  'model could write a judgement into is a column a model will write a judgement '
  'into, and this is not a decision software may make.';

comment on column public.adverse_event_reports.statutory_due_at is
  'Fifteen calendar days from the server''s receipt. IPC Pharmacovigilance Guidance '
  'for MAHs v2.0 §2.8. This is a legal deadline, so it is stamped by trigger from '
  'clock_timestamp() and computed in a pinned timezone.';

-- ----------------------------------------------------------------------------
-- 3. The clock, which the device does not get to set
-- ----------------------------------------------------------------------------

-- Pinned to Asia/Kolkata rather than left to the session.
--
-- "Fifteen calendar days" is a calendar statement, and calendar arithmetic on a
-- timestamptz uses the session's TimeZone — so the same insert could produce two
-- different deadlines on two different connections. India observes no DST, so today
-- the pinned answer and the session answer agree; pinning it means they cannot stop
-- agreeing because somebody changed a server setting. A statutory deadline that can
-- be wrong by a timezone will eventually be wrong by a timezone.
create or replace function public.stamp_adverse_event_clock()
returns trigger
language plpgsql
set search_path = ''
set timezone = 'Asia/Kolkata'
as $$
begin
  new.received_at      := clock_timestamp();
  new.statutory_due_at := new.received_at + make_interval(days => 15);
  return new;
end;
$$;

create trigger adverse_event_reports_stamp_clock
  before insert on public.adverse_event_reports
  for each row execute function public.stamp_adverse_event_clock();

-- Append-only against every role including service_role and the table owner, by
-- statement-level trigger — the same construction as consent_records and audit_log,
-- and for the same reason: postgres and service_role hold BYPASSRLS, so an absent
-- UPDATE policy stops neither of them.
create trigger adverse_event_reports_reject_mutation
  before update or delete or truncate on public.adverse_event_reports
  for each statement execute function public.reject_mutation();

create trigger adverse_event_reports_audit
  after insert on public.adverse_event_reports
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 4. Ingest
-- ----------------------------------------------------------------------------

create or replace function public.report_adverse_event(
  p_id                 uuid,
  p_visit_id           uuid,
  p_reported_text      text,
  p_client_reported_at timestamptz default null
)
returns public.adverse_event_reports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_visit    public.visits%rowtype;
  v_existing public.adverse_event_reports%rowtype;
  v_row      public.adverse_event_reports%rowtype;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Idempotent on the device-generated id, so this is safe to put in the offline
  -- queue and safe to retry. A duplicate adverse event is a duplicate statutory
  -- deadline and a duplicate report to the regulator.
  select * into v_existing from public.adverse_event_reports a where a.id = p_id;
  if found then
    return v_existing;
  end if;

  select * into v_visit from public.visits v where v.id = p_visit_id and v.mr_id = v_uid;
  if not found then
    raise exception 'visit % is not yours', p_visit_id using errcode = '42501';
  end if;

  if coalesce(btrim(p_reported_text), '') = '' then
    raise exception 'an adverse event report needs a description of what happened'
      using errcode = '22023';
  end if;

  insert into public.adverse_event_reports
    (id, visit_id, source, reported_by_mr_id, reported_text, client_reported_at)
  values
    (p_id, p_visit_id, 'mr_reported', v_uid, btrim(p_reported_text), p_client_reported_at)
  returning * into v_row;

  return v_row;
end;
$$;

-- The pipeline's entry point. It passes a POINTER to a redacted segment and nothing
-- else — no text, no judgement about what the segment means, and no opinion about
-- whether it is really an adverse event. Deciding that is the human queue's job.
create or replace function public.ingest_detected_adverse_event(
  p_id                     uuid,
  p_visit_id               uuid,
  p_redacted_transcript_id uuid,
  p_transcript_segment_id  uuid default null
)
returns public.adverse_event_reports
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing public.adverse_event_reports%rowtype;
  v_row      public.adverse_event_reports%rowtype;
begin
  select * into v_existing from public.adverse_event_reports a where a.id = p_id;
  if found then
    return v_existing;
  end if;

  insert into public.adverse_event_reports
    (id, visit_id, source, redacted_transcript_id, transcript_segment_id)
  values
    (p_id, p_visit_id, 'transcript_detected', p_redacted_transcript_id, p_transcript_segment_id)
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. The clock is countable from day one
-- ----------------------------------------------------------------------------

-- Because the thing that gets missed is a deadline nobody was counting. Built now
-- rather than when somebody asks, for the same reason sync_queue_status was: asking
-- this question later means asking it of a table that already has real deadlines in
-- it and no index for the question.
create view public.adverse_event_clock
with (security_invoker = true) as
  select a.id,
         a.visit_id,
         a.source,
         a.reported_by_mr_id,
         a.received_at,
         a.statutory_due_at,
         floor(extract(epoch from (a.statutory_due_at - now())) / 3600)::integer as hours_remaining,
         a.statutory_due_at <= now() as overdue
    from public.adverse_event_reports a;

comment on view public.adverse_event_clock is
  'Every ingested adverse event with its statutory deadline and the time left on it. '
  'No filtering by state, because there is no state: routing is to a human and this '
  'system does not model what the human then does.';

create or replace function public.adverse_event_clock_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',            (select count(*) from public.adverse_event_reports),
    'overdueCount',     (select count(*) from public.adverse_event_reports
                          where statutory_due_at <= now()),
    'dueWithin24Hours', (select count(*) from public.adverse_event_reports
                          where statutory_due_at > now()
                            and statutory_due_at <= now() + interval '24 hours'),
    'nextDueAt',        (select min(statutory_due_at) from public.adverse_event_reports
                          where statutory_due_at > now()),
    'oldestOverdueAt',  (select min(statutory_due_at) from public.adverse_event_reports
                          where statutory_due_at <= now()));
$$;

-- ----------------------------------------------------------------------------
-- 6. Boundary
-- ----------------------------------------------------------------------------

alter table public.adverse_event_reports enable row level security;
alter table public.adverse_event_reports force row level security;

revoke all on table public.adverse_event_reports from anon, authenticated;
-- Append-only against the service key too. The trigger already refuses, and the
-- revoked privilege means the attempt does not even reach it.
revoke update, delete, truncate on table public.adverse_event_reports from service_role;

-- The LLM gateway holds nothing here. A model may flag a transcript passage through
-- the pipeline's service-role path; it has no read of what was reported, no write of
-- any kind, and no way to see the queue it fed.
revoke all on table public.adverse_event_reports from llm_gateway;
revoke all on public.adverse_event_clock          from llm_gateway;

-- An MR sees the reports they filed. They do not see the pipeline's detections:
-- being shown that software flagged your consultation, with no human having looked
-- yet, is an accusation the system is not in a position to make.
create policy adverse_event_reports_select_own
  on public.adverse_event_reports for select to authenticated
  using (source = 'mr_reported' and reported_by_mr_id = (select auth.uid()));

grant select on table public.adverse_event_reports to authenticated;

revoke all on public.adverse_event_clock from anon, authenticated;
grant select on public.adverse_event_clock to authenticated;

grant execute on function public.report_adverse_event(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.adverse_event_clock_summary()                       to authenticated;

-- The pipeline runs as service_role. Nothing in the field may file a detection,
-- because a detection carries no MR's name and would be an unattributable report.
revoke execute on function
  public.ingest_detected_adverse_event(uuid, uuid, uuid, uuid) from public, anon, authenticated;
