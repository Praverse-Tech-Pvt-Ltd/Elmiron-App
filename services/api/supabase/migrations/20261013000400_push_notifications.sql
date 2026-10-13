-- `BE-W195` -- PUSH NOTIFICATIONS, the database half: which phones may be told something, and a ledger
-- of what was to be told, to whom, why, and what became of it. Operator item Q-3 (`BE-C47`).
--
-- **What existed.** A notification EVENT MODEL on the phone (`apps/field/src/integrations/
-- notifications.ts`, four types the onboarding screen names) and nothing on the server: no device
-- token, no record of anything to send, no sender.
--
-- **The rules, and what holds each one:**
--   1. A phone's push token belongs to ONE signed-in person. `register_push_token` is the only way a
--      token enters, as the caller; a token already live for somebody else is RETIRED ('replaced'),
--      because the phone has changed hands and must not keep receiving the previous person's news.
--      `unregister_push_token` retires the caller's own token on sign-out. Nobody reads another
--      person's tokens: the one select policy is `user_id = auth.uid()`, under the tenant boundary.
--   2. A token is never deleted, only RETIRED with a reason -- signed out, replaced, or reported
--      invalid by the push service (`push_record_results`). Registration and retirement are audited
--      (`write_audit_row`), so "which phone was this rep's on the 14th" has an answer.
--   3. The outbox is filled by TRIGGERS on facts that already exist (`20261013000410`), never by a
--      client: nobody holds an insert grant, and `enqueue_notification` is executable by no client
--      role. What a notification SAYS is fixed server-side text: counts and dates, never a doctor,
--      clinic, product or anything clinical.
--   4. The outbox is APPEND-ONLY apart from its delivery columns. DELETE and TRUNCATE are refused by
--      statement trigger for every role; an UPDATE may move a row along `pending -> sending ->
--      sent|failed|pending` (and `pending -> no_device|expired`), may refresh the text of a row still
--      `pending` (a re-planned day replaces the unsent "your plan changed" rather than sending two),
--      and may change nothing else. A terminal row never moves again.
--   5. Only the sender drains it: `push_claim_batch` and `push_record_results` are executable by
--      `service_role` alone, reached from ONE place (`_shared/practice-writer.ts`,
--      `pushOutboxFromEnv`). A notification older than its `expires_at` (24 hours) is never sent --
--      "your plan for tomorrow changed" three days late is wrong, not late.
--   6. An admin may RUN the sender by hand (`push_sender_authorise`); that names the caller and
--      writes an audit row, and drains nothing by itself.
--
-- **Off without Firebase.** Nothing here needs a credential. With no sender configured the rows
-- wait `pending` and then expire; the phone app registers no token unless its build has
-- `EXPO_PUBLIC_PUSH=true`.
--
-- No enum types: a new type is born `USAGE`-able by `anon` (`privilege-posture.spec.ts`), and a text
-- column with a CHECK says the same thing.
--
-- Rollback: services/api/rollbacks/20261013000400_push_notifications.down.sql

-- ---------------------------------------------------------------------------
-- 1. Device push tokens
-- ---------------------------------------------------------------------------

create table public.device_push_tokens (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  user_id         uuid not null references public.user_profiles (id) on delete restrict,
  -- The FCM registration token the phone was given. Opaque; identifies an app install, not a person.
  token           text not null check (char_length(token) between 20 and 4096),
  platform        text not null default 'android' check (platform = 'android'),
  registered_at   timestamptz not null default clock_timestamp(),
  last_seen_at    timestamptz not null default clock_timestamp(),
  retired_at      timestamptz,
  retired_reason  text check (retired_reason in ('signed_out', 'replaced', 'invalid_token', 'too_many')),
  constraint device_push_tokens_retired_with_reason
    check ((retired_at is null) = (retired_reason is null))
);

-- One LIVE row per token, whoever holds it.
create unique index device_push_tokens_one_live_token
  on public.device_push_tokens (token) where retired_at is null;
create index device_push_tokens_live_user_idx
  on public.device_push_tokens (user_id) where retired_at is null;

-- Server clocks only: the phone says nothing about when it registered.
create or replace function public.device_push_tokens_stamp()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.registered_at := clock_timestamp();
    new.last_seen_at := new.registered_at;
    new.retired_at := null;
    new.retired_reason := null;
    return new;
  end if;
  -- UPDATE: who, which token and when it was registered never change; a retired row stays retired.
  if new.organisation_id is distinct from old.organisation_id
     or new.user_id is distinct from old.user_id
     or new.token is distinct from old.token
     or new.platform is distinct from old.platform
     or new.registered_at is distinct from old.registered_at then
    raise exception 'device_push_tokens: only last_seen_at and retirement may change'
      using errcode = 'restrict_violation';
  end if;
  if old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at
          or new.retired_reason is distinct from old.retired_reason
          or new.last_seen_at is distinct from old.last_seen_at) then
    raise exception 'device_push_tokens: a retired token stays retired'
      using errcode = 'restrict_violation';
  end if;
  if old.retired_at is null and new.retired_at is not null then
    new.retired_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger device_push_tokens_stamp
  before insert or update on public.device_push_tokens
  for each row execute function public.device_push_tokens_stamp();

create trigger device_push_tokens_reject_delete
  before delete or truncate on public.device_push_tokens
  for each statement execute function public.reject_mutation();

create trigger device_push_tokens_audit
  after insert or update on public.device_push_tokens
  for each row execute function public.write_audit_row();

-- ---------------------------------------------------------------------------
-- 2. The notification outbox
-- ---------------------------------------------------------------------------

create table public.notification_outbox (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  recipient_user_id uuid not null references public.user_profiles (id) on delete restrict,
  -- Why. Each kind is one trigger in `20261013000410`.
  kind              text not null
                      check (kind in ('day_plan', 'day_reopened', 'course_assigned', 'coaching_note')),
  title             text not null check (char_length(title) between 1 and 80),
  body              text not null check (char_length(body) between 1 and 240),
  -- Where tapping it opens, INSIDE the app: a path, never a URL.
  link              text not null check (link ~ '^/[A-Za-z0-9/_-]*$' and char_length(link) <= 200),
  -- The fact that caused it.
  source_table      text not null check (char_length(source_table) between 1 and 63),
  source_id         uuid not null,
  -- Rows with the same key for the same person, still unsent, are ONE notification (the latest text).
  dedupe_key        text check (dedupe_key is null or char_length(dedupe_key) between 1 and 200),
  status            text not null default 'pending'
                      check (status in ('pending', 'sending', 'sent', 'failed', 'no_device', 'expired')),
  attempts          integer not null default 0 check (attempts between 0 and 10),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  expires_at        timestamptz not null default clock_timestamp() + interval '24 hours',
  claimed_at        timestamptz,
  sent_at           timestamptz,
  last_error        text check (last_error is null or char_length(last_error) <= 500),
  constraint notification_outbox_sent_is_stamped check ((status = 'sent') = (sent_at is not null))
);

create unique index notification_outbox_one_pending_per_key
  on public.notification_outbox (recipient_user_id, dedupe_key)
  where status = 'pending' and dedupe_key is not null;
create index notification_outbox_due_idx
  on public.notification_outbox (created_at) where status in ('pending', 'sending');
create index notification_outbox_recipient_idx
  on public.notification_outbox (recipient_user_id, created_at desc);

-- The delivery columns move; nothing else does, and a terminal row never moves again.
create or replace function public.notification_outbox_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.attempts := 0;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    new.claimed_at := null;
    new.sent_at := null;
    new.last_error := null;
    if new.expires_at is null or new.expires_at > new.created_at + interval '7 days' then
      new.expires_at := new.created_at + interval '24 hours';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organisation_id is distinct from old.organisation_id
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.kind is distinct from old.kind
     or new.source_table is distinct from old.source_table
     or new.dedupe_key is distinct from old.dedupe_key
     or new.created_at is distinct from old.created_at then
    raise exception 'notification_outbox: who, why and when a notification was raised never change'
      using errcode = 'restrict_violation';
  end if;
  if old.status in ('sent', 'failed', 'no_device', 'expired') then
    raise exception 'notification_outbox: a % notification is final', old.status
      using errcode = 'restrict_violation';
  end if;
  if (new.title, new.body, new.link, new.source_id, new.expires_at)
       is distinct from (old.title, old.body, old.link, old.source_id, old.expires_at)
     and not (old.status = 'pending' and new.status = 'pending') then
    raise exception 'notification_outbox: only an unsent notification''s text may be replaced'
      using errcode = 'restrict_violation';
  end if;
  if not (
       (old.status = 'pending' and new.status in ('pending', 'sending', 'no_device', 'expired'))
    or (old.status = 'sending' and new.status in ('sending', 'sent', 'failed', 'pending', 'expired'))
  ) then
    raise exception 'notification_outbox: % -> % is not a delivery step', old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := clock_timestamp();
  if new.status = 'sent' and old.status <> 'sent' then
    new.sent_at := clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger notification_outbox_guard
  before insert or update on public.notification_outbox
  for each row execute function public.notification_outbox_guard();

create trigger notification_outbox_reject_delete
  before delete or truncate on public.notification_outbox
  for each statement execute function public.reject_mutation();

-- ---------------------------------------------------------------------------
-- 3. Filling it -- called by the event triggers only
-- ---------------------------------------------------------------------------

-- One notification for one person. Skips a recipient who is inactive or has no company, and folds
-- into an unsent row with the same `dedupe_key`. Returns the row's id, or null when skipped.
create or replace function public.enqueue_notification(
  p_recipient    uuid,
  p_kind         text,
  p_title        text,
  p_body         text,
  p_link         text,
  p_source_table text,
  p_source_id    uuid,
  p_dedupe_key   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  select p.organisation_id into v_org
    from public.user_profiles p
   where p.id = p_recipient and p.is_active and p.organisation_id is not null;
  if v_org is null then
    return null;
  end if;

  if p_dedupe_key is not null then
    update public.notification_outbox o
       set title = left(p_title, 80), body = left(p_body, 240), link = p_link,
           source_id = p_source_id, expires_at = clock_timestamp() + interval '24 hours'
     where o.recipient_user_id = p_recipient and o.dedupe_key = p_dedupe_key and o.status = 'pending'
    returning o.id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.notification_outbox
    (organisation_id, recipient_user_id, kind, title, body, link, source_table, source_id, dedupe_key)
  values
    (v_org, p_recipient, p_kind, left(p_title, 80), left(p_body, 240), p_link, p_source_table,
     p_source_id, p_dedupe_key)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The phone's two calls
-- ---------------------------------------------------------------------------

-- Register this phone's token for the CALLER. Idempotent for the same person; a token live for
-- somebody else is retired first (the phone changed hands). At most five live tokens a person: the
-- oldest beyond that is retired, so an old phone nobody signed out of stops receiving.
create or replace function public.register_push_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_token  text := btrim(coalesce(p_token, ''));
  v_row    public.device_push_tokens%rowtype;
begin
  select * into v_caller from public.lms_caller();
  if char_length(v_token) < 20 or char_length(v_token) > 4096 or v_token ~ '\s' then
    raise exception 'push_token_malformed: that is not a device push token' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('push-token:' || v_token, 0));

  select * into v_row from public.device_push_tokens t
   where t.token = v_token and t.retired_at is null
   for update;

  if v_row.id is not null and v_row.user_id = v_caller.user_id then
    update public.device_push_tokens t set last_seen_at = clock_timestamp()
     where t.id = v_row.id
    returning * into v_row;
    return jsonb_build_object('id', v_row.id, 'registeredAt', v_row.registered_at, 'replaced', false);
  end if;

  if v_row.id is not null then
    update public.device_push_tokens t
       set retired_at = clock_timestamp(), retired_reason = 'replaced'
     where t.id = v_row.id;
  end if;

  insert into public.device_push_tokens (organisation_id, user_id, token)
  values (v_caller.organisation_id, v_caller.user_id, v_token)
  returning * into v_row;

  update public.device_push_tokens t
     set retired_at = clock_timestamp(), retired_reason = 'too_many'
   where t.id in (
     select x.id from public.device_push_tokens x
      where x.user_id = v_caller.user_id and x.retired_at is null
      order by x.last_seen_at desc, x.registered_at desc
      offset 5);

  return jsonb_build_object('id', v_row.id, 'registeredAt', v_row.registered_at,
                            'replaced', false);
end;
$$;

-- Retire the caller's own live row for this token (sign-out). Another person's token is not
-- touched and not reported: the answer is the same count either way.
create or replace function public.unregister_push_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_caller record;
  v_count  integer;
begin
  select * into v_caller from public.lms_caller();
  update public.device_push_tokens t
     set retired_at = clock_timestamp(), retired_reason = 'signed_out'
   where t.token = btrim(coalesce(p_token, ''))
     and t.user_id = v_caller.user_id
     and t.retired_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('retired', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The sender's two calls -- service_role only
-- ---------------------------------------------------------------------------

-- Claim up to `p_limit` notifications to send now, with each recipient's live tokens. First settles
-- what cannot be sent: past `expires_at` -> `expired`; nobody's phone registered -> `no_device`.
-- A row claimed more than ten minutes ago and never reported (a sender that died) is claimable again.
create or replace function public.push_claim_batch(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_out    jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'a push batch is 1 to 500 notifications' using errcode = '22023';
  end if;

  update public.notification_outbox o
     set status = 'expired', last_error = 'not sent before it expired'
   where o.status in ('pending', 'sending')
     and o.expires_at <= v_now
     and (o.status = 'pending' or o.claimed_at < v_now - interval '10 minutes');

  update public.notification_outbox o
     set status = 'no_device'
   where o.status = 'pending'
     and not exists (select 1 from public.device_push_tokens t
                      where t.user_id = o.recipient_user_id and t.retired_at is null);

  with due as (
    select o.id from public.notification_outbox o
     where (o.status = 'pending' or (o.status = 'sending' and o.claimed_at < v_now - interval '10 minutes'))
       and o.attempts < 5
     order by o.created_at
     limit p_limit
     for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set status = 'sending', claimed_at = v_now, attempts = o.attempts + 1
      from due
     where o.id = due.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'kind', c.kind,
           'title', c.title,
           'body', c.body,
           'link', c.link,
           'attempts', c.attempts,
           'tokens', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'token', t.token)
                                                order by t.last_seen_at desc)
                                 from public.device_push_tokens t
                                where t.user_id = c.recipient_user_id and t.retired_at is null),
                              '[]'::jsonb))
           order by c.created_at), '[]'::jsonb)
    into v_out
    from claimed c;

  return v_out;
end;
$$;

-- Record what the sender did with each claimed notification:
--   [{ "id": uuid, "outcome": "sent"|"retry"|"failed", "error": text|null, "retireTokenIds": [uuid] }]
-- Only rows still `sending` move. `retry` puts a row back to `pending` until its fifth attempt, then
-- `failed`. A token the push service called invalid is retired whatever the row's outcome.
create or replace function public.push_record_results(p_results jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_item    jsonb;
  v_id      uuid;
  v_outcome text;
  v_error   text;
  v_sent    integer := 0;
  v_retry   integer := 0;
  v_failed  integer := 0;
  v_retired integer := 0;
  v_n       integer;
begin
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'results are an array' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_results) loop
    v_id := nullif(v_item ->> 'id', '')::uuid;
    v_outcome := v_item ->> 'outcome';
    v_error := left(nullif(v_item ->> 'error', ''), 500);
    if v_id is null or v_outcome not in ('sent', 'retry', 'failed') then
      raise exception 'a result names a notification and an outcome of sent, retry or failed'
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_item -> 'retireTokenIds') = 'array' then
      update public.device_push_tokens t
         set retired_at = clock_timestamp(), retired_reason = 'invalid_token'
       where t.retired_at is null
         and t.id in (select (x.value #>> '{}')::uuid
                        from jsonb_array_elements(v_item -> 'retireTokenIds') x);
      get diagnostics v_n = row_count;
      v_retired := v_retired + v_n;
    end if;

    update public.notification_outbox o
       set status = case
                      when v_outcome = 'sent' then 'sent'
                      when v_outcome = 'retry' and o.attempts < 5 then 'pending'
                      else 'failed' end,
           last_error = case when v_outcome = 'sent' then null else v_error end
     where o.id = v_id and o.status = 'sending'
    returning case o.status when 'sent' then 1 else 0 end into v_n;
    if found then
      if v_outcome = 'sent' then v_sent := v_sent + 1;
      elsif v_outcome = 'retry' then v_retry := v_retry + 1;
      else v_failed := v_failed + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('sent', v_sent, 'retry', v_retry, 'failed', v_failed,
                            'tokensRetired', v_retired);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. An admin runs the sender by hand
-- ---------------------------------------------------------------------------

-- The `push-sender` function calls this AS the person asking, before draining anything. An active
-- admin is answered, and the request is audited; anyone else is refused 42501.
create or replace function public.push_sender_authorise()
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
    raise exception 'only an admin sends pending notifications by hand' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, request_id,
                                ip_address, occurred_at)
  values (v_caller.user_id, v_caller.role, 'update', 'notification_outbox', null,
          public.current_request_id(), public.current_client_ip(), clock_timestamp());
  return jsonb_build_object('userId', v_caller.user_id, 'organisationId', v_caller.organisation_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Row rules and grants
-- ---------------------------------------------------------------------------

alter table public.device_push_tokens enable row level security;
alter table public.device_push_tokens force row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_outbox force row level security;

-- Revoke before grant: Supabase hands anon and authenticated TRUNCATE on every new table. The sender
-- works through its two functions, never the table, so service_role loses its writes too.
revoke all on table public.device_push_tokens from anon, authenticated;
revoke all on table public.notification_outbox from anon, authenticated;
revoke insert, update, delete, truncate on table public.device_push_tokens from service_role;
revoke insert, update, delete, truncate on table public.notification_outbox from service_role;

-- A person sees their own tokens and nobody else's.
create policy device_push_tokens_select_own on public.device_push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy device_push_tokens_tenant_boundary on public.device_push_tokens
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- A person sees what was sent to them; an admin sees their company's ledger (what was sent, to
-- whom, why, and whether it arrived -- the text holds no clinical detail by construction).
create policy notification_outbox_select on public.notification_outbox
  for select to authenticated
  using (recipient_user_id = (select auth.uid()) or public.is_admin());
create policy notification_outbox_tenant_boundary on public.notification_outbox
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

grant select on table public.device_push_tokens to authenticated;
grant select on table public.notification_outbox to authenticated;

revoke all on function public.device_push_tokens_stamp() from public, anon, authenticated;
revoke all on function public.notification_outbox_guard() from public, anon, authenticated;
revoke all on function public.enqueue_notification(uuid, text, text, text, text, text, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.register_push_token(text) from public, anon;
revoke all on function public.unregister_push_token(text) from public, anon;
revoke all on function public.push_sender_authorise() from public, anon;
grant execute on function public.register_push_token(text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.push_sender_authorise() to authenticated;

revoke all on function public.push_claim_batch(integer) from public, anon, authenticated;
revoke all on function public.push_record_results(jsonb) from public, anon, authenticated;
grant execute on function public.push_claim_batch(integer) to service_role;
grant execute on function public.push_record_results(jsonb) to service_role;

comment on table public.device_push_tokens is
  'BE-W195: a phone''s push token, owned by the person signed in on it. Written only by '
  'register_push_token / unregister_push_token / push_record_results; never deleted, only retired '
  'with a reason; audited.';
comment on table public.notification_outbox is
  'BE-W195: what was to be pushed, to whom, why (kind + source) and what became of it. Filled by '
  'triggers (20261013000410), drained by the push-sender Edge Function through push_claim_batch / '
  'push_record_results. Append-only apart from the delivery columns; text never carries clinical detail.';
