-- ============================================================================
-- BE-W61 phase 2 · Tombstones and leave-scope, payload-free and scoped
--
-- Phase 1 shipped inserts and updates and said so in a field. `completeness.omits` has
-- carried `['delete','out_of_scope']` since, because both needed answers this repository
-- did not have. `docs/adr-sync-pull.md` §6 supplied them:
--
--   * tombstones are PAYLOAD-FREE -- an id, a type and a reason class. Nothing personal,
--     so the retention-window question does not arise and no legal answer is needed first.
--   * a record leaving the caller's scope is NEVER "deleted". The two are different
--     events, and the client must be able to tell them apart without inferring it.
--
-- ----------------------------------------------------------------------------
-- 1. PAYLOAD-FREE DOES NOT MEAN SCOPE-FREE, AND THAT IS THE WHOLE DESIGN
-- ----------------------------------------------------------------------------
--
-- **The sharp question: how do you stop a tombstone telling somebody that a record they
-- were never allowed to see has been deleted?** A tombstone is an existence claim. "Visit
-- 7f3a… was deleted" tells a reader that visit 7f3a… existed, which is a disclosure if
-- they were never entitled to know that.
--
-- It cannot be solved at read time, because the row is gone: there is nothing left to
-- evaluate a policy against. So the scope is **captured at the moment of the event** and
-- the tombstone is scoped by the scope the record HAD:
--
--     former_mr_id         -- who owned the visit or beat plan
--     former_territory_id  -- which territory the doctor was in
--
-- and RLS on this table admits a row only to a caller for whom that former scope was
-- visible. **A caller who could never see the record can never match its tombstone**, and
-- that is a policy on a stored value rather than an argument about ordering.
--
-- Those two columns are the only thing in a tombstone besides the id, the type and the
-- reason. They are not content: no name, no date, no outcome, no text. What a visit
-- tombstone retains is that an MR once had a visit with that id -- which is precisely the
-- minimum needed to tell that MR, and only that MR, to drop it.
--
-- **Second protection, and it is independent of the first: tombstones are emitted ONLY on
-- an incremental sweep.** A pull with a null cursor is a client rebuilding from nothing;
-- it has no stale rows to correct, so a tombstone can only tell it about records it never
-- held. A full re-sync therefore carries no tombstones at all.
--
-- ----------------------------------------------------------------------------
-- 2. WHY ONE TABLE AND ONE STREAM
-- ----------------------------------------------------------------------------
--
-- Deletes and leave-scope are the same shape -- "this id is no longer yours, and here is
-- why" -- and they must be ordered against each other and against ordinary updates. A
-- client that sees a delete before the update it superseded, or after a later update that
-- resurrected the id, ends up in a state no sequence of events explains.
--
-- So they share a table and are merged into the same `(updated_at, id)` order as rows,
-- and they inherit phase 1's snapshot visibility for free: an event row is written in the
-- same transaction as the delete or the reassignment, so its `xmin` is that transaction's
-- and it becomes visible exactly when the change commits. Nothing extra to reason about.
--
-- ----------------------------------------------------------------------------
-- 3. LIFETIME, TIED TO THE CURSOR BOUND RATHER THAN TO A NUMBER
-- ----------------------------------------------------------------------------
--
-- FIX-12 refuses a cursor older than half of `vacuum_freeze_min_age`, in TRANSACTIONS.
-- A tombstone older than the oldest acceptable cursor cannot be needed by any client that
-- is still allowed to sync -- so its lifetime is the same bound, expressed the same way,
-- rather than a number in days that would drift away from it:
--
--     age(event.xmin) >= (vacuum_freeze_min_age / 2)   ->  expired
--
-- No conversion between transactions and time, and no second constant to keep in step.
-- The pull filters expired events as well as the purge deleting them, so the guarantee
-- holds between purge runs. That filter is safe rather than merely convenient: an event
-- older than the bound is older than any cursor the server will still accept, so every
-- client entitled to it has already been given it.
--
-- **`sync_events` is deliberately NOT append-only**, unlike the ledgers in this schema. It
-- is a derived queue whose entire design is that it gets emptied; a `reject_mutation`
-- trigger would make its own retention impossible.
--
-- Rollback: services/api/rollbacks/20260908000300_sync_pull_phase2.down.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4. The events
-- ----------------------------------------------------------------------------

create table public.sync_events (
  -- A uuid rather than a sequence so the ordering tuple has the same types as a row's
  -- `(updated_at, id)` and the two streams can be merged without a cast.
  id                  uuid        primary key default gen_random_uuid(),
  entity              text        not null,
  entity_id           uuid        not null,
  reason              text        not null,
  -- The scope the record HAD. See section 1: this is what stops a tombstone reaching
  -- somebody who was never entitled to know the record existed.
  former_mr_id        uuid,
  former_territory_id uuid,
  occurred_at         timestamptz not null default clock_timestamp(),

  constraint sync_events_entity_check
    check (entity in ('visit', 'beat_plan', 'doctor')),
  constraint sync_events_reason_check
    check (reason in ('deleted', 'out_of_scope')),
  -- Exactly one scope key, always. A row with neither is invisible to everyone and a row
  -- with both would be ambiguous about which policy admits it.
  constraint sync_events_exactly_one_scope
    check ((former_mr_id is not null)::int + (former_territory_id is not null)::int = 1)
);

comment on table public.sync_events is
  'BE-W61 phase 2. Payload-free change events for things a pull cannot infer from the row '
  'itself, because the row is gone or is no longer the caller''s. Carries an id, a type, a '
  'reason class and the scope the record HAD -- nothing else, and in particular no '
  'content. Not append-only: it is a derived queue with a lifetime tied to the maximum '
  'cursor age, not a ledger.';

comment on column public.sync_events.former_mr_id is
  'The scope the record had at the moment of the event. RLS admits a tombstone only to a '
  'caller for whom this was visible, which is what stops a tombstone disclosing that a '
  'record existed to somebody who was never allowed to see it.';

create index sync_events_scope_mr_idx on public.sync_events (former_mr_id, occurred_at)
  where former_mr_id is not null;
create index sync_events_scope_territory_idx
  on public.sync_events (former_territory_id, occurred_at)
  where former_territory_id is not null;

alter table public.sync_events enable row level security;
alter table public.sync_events force row level security;

-- The whole of section 1, as a policy. There is no INSERT, UPDATE or DELETE policy: rows
-- arrive through SECURITY DEFINER triggers and leave through a SECURITY DEFINER purge, so
-- no client can write one and no client can suppress one.
create policy sync_events_select_former_scope on public.sync_events
  for select to authenticated
  using (
    (former_mr_id is not null
       and former_mr_id in (select public.visible_user_ids()))
    or (former_territory_id is not null
       and former_territory_id in (select public.current_user_visible_territory_ids()))
  );

-- Supabase's default privileges hand `anon`, `authenticated` and `service_role` a full
-- grant -- SELECT, INSERT, UPDATE, DELETE and TRUNCATE -- on every new table in `public`,
-- and no migration can change that default. Every table in this schema revokes for
-- itself, and `rls.spec.ts` and `foundations.spec.ts` fail the build if one forgets.
-- Both of them caught this table the first time it was created, which is what they are
-- for: the same class as the 65 anon-executable functions in FIX-05, wearing tables.
--
-- SELECT only, and only for `authenticated`. The policy above decides which rows;
-- these grants decide that nothing else is even a possibility.
revoke all on table public.sync_events from anon, authenticated;
revoke update, delete, truncate on table public.sync_events from service_role;
grant select on table public.sync_events to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Emitting them
-- ----------------------------------------------------------------------------
--
-- SECURITY DEFINER because `sync_events` has RLS forced with no INSERT policy: a delete
-- performed by an `authenticated` user must still be able to record its own tombstone,
-- and it must not be able to write one by hand.
create function public.emit_sync_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'doctors' then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'deleted', old.territory_id);
    else
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (case tg_table_name when 'visits' then 'visit' else 'beat_plan' end,
              old.id, 'deleted', old.mr_id);
    end if;
    return old;
  end if;

  -- UPDATE. Only a change of the SCOPE key is an event; every other update is already
  -- carried by the ordinary row path, which the new owner sees as an upsert.
  if tg_table_name = 'doctors' then
    if new.territory_id is distinct from old.territory_id then
      insert into public.sync_events (entity, entity_id, reason, former_territory_id)
      values ('doctor', old.id, 'out_of_scope', old.territory_id);
    end if;
  else
    if new.mr_id is distinct from old.mr_id then
      insert into public.sync_events (entity, entity_id, reason, former_mr_id)
      values (case tg_table_name when 'visits' then 'visit' else 'beat_plan' end,
              old.id, 'out_of_scope', old.mr_id);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.emit_sync_event() from public, anon;

create trigger visits_sync_events
  after update or delete on public.visits
  for each row execute function public.emit_sync_event();

create trigger beat_plans_sync_events
  after update or delete on public.beat_plans
  for each row execute function public.emit_sync_event();

create trigger doctors_sync_events
  after update or delete on public.doctors
  for each row execute function public.emit_sync_event();

-- ----------------------------------------------------------------------------
-- 6. Retiring them
-- ----------------------------------------------------------------------------

create function public.purge_expired_sync_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit bigint := (current_setting('vacuum_freeze_min_age')::bigint) / 2;
  v_n     integer;
begin
  delete from public.sync_events e
   where age(e.xmin::text::xid) >= v_limit;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.purge_expired_sync_events() from public, anon;

comment on function public.purge_expired_sync_events() is
  'Deletes sync events older than the maximum cursor age from FIX-12. Expressed in '
  'transactions rather than days so it cannot drift away from the bound it is derived '
  'from: an event older than the oldest cursor the server will still accept has already '
  'been delivered to every client entitled to it.';

-- ----------------------------------------------------------------------------
-- 7. The pull, now carrying both
-- ----------------------------------------------------------------------------

create or replace function public.sync_pull(
  p_cursor   text    default null,
  p_entities text[]  default null,
  p_limit    integer default 200
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_max_cursor_bytes constant integer := 8192;
  c_entities constant text[] := array['visit', 'beat_plan', 'doctor'];
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
           to_jsonb(v) as payload
      from public.visits v
     where 'visit' = any(v_want)
    union all
    select 'beat_plan', b.id, b.updated_at, b.xmin, 'upserted', to_jsonb(b)
      from public.beat_plans b
     where 'beat_plan' = any(v_want)
    union all
    select 'doctor', d.id, d.updated_at, d.xmin, 'upserted', to_jsonb(d)
      from public.doctors d
     where 'doctor' = any(v_want)
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
$$;

comment on function public.sync_pull(text, text[], integer) is
  'BE-W61 phase 2. Inserts, updates, payload-free tombstones and leave-scope events, '
  'scoped by RLS, merged into one (updated_at, id) order, and made loss-free by carrying '
  'two transaction snapshots. A tombstone is scoped by the scope the record HAD, so it '
  'cannot disclose that a record existed to a caller who was never entitled to see it, '
  'and no tombstone is emitted on a full re-sync at all. Bounded: 45006 past half of '
  'vacuum_freeze_min_age, 45005 over 8 KB, and tombstones expire on the same bound.';
