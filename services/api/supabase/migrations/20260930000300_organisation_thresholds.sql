-- ---------------------------------------------------------------------------
-- W1-L Part C -- `BE-W106` ANSWERED AND BUILT: settings belong to a company.
--
-- Operator decision `BE-C10`, 30 September 2026: *"thresholds, AI controls and
-- compliance settings belong to each company, not shared."*
--
-- ## Why this is the largest unblock on the list
--
-- `app_thresholds` had two scopes, `global` and `territory`, and a `global` row is
-- shared by every tenant. Three consequences followed from that one fact:
--
--   * the AI feature flag could only be switched on for EVERYBODY or NOBODY, so the
--     operator's own checklist carried a step reading *"an engineer runs SQL"*;
--   * `BE-C11`'s UCPMP cap could not be entered per company;
--   * and a per-company console screen was impossible to build honestly -- a screen
--     saying "AI is ON for your company" would have been reporting a global fact in
--     per-company words.
--
-- ## C1 -- the resolution order, and what wins
--
-- **territory > organisation > global.** Most specific wins, and among rows of equal
-- specificity the latest `effective_from` wins.
--
-- A territory belongs to an organisation, so a territory row IS more specific than an
-- organisation row -- that ordering is not a preference, it follows from the data
-- model. `global` stays the floor: the value a company gets when nobody has said
-- anything about them.
--
-- ## C2 -- what happens to the rows that exist today, and why it is the safe reading
--
-- **Nothing. Every existing row stays `global`, and that is deliberate.**
--
-- A `global` row is, today, *the value every company actually gets*. Leaving them
-- global therefore preserves current behaviour exactly: no company's resolved value
-- changes on the day this migration runs. An organisation row is now an OVERRIDE on
-- top of that floor.
--
-- The alternative -- copying every global row to every organisation -- was rejected:
-- it would freeze today's defaults as per-company decisions nobody made, and the next
-- change to a global default would silently stop reaching anyone. **A migration that
-- turns an unmade decision into recorded data is worse than one that changes nothing.**
--
-- ## C3 -- the resolver is scoped by the CALLER, never by an argument
--
-- `threshold()` keeps its signature -- `(p_key text, p_territory_id uuid)` -- and
-- resolves the organisation ITSELF, from `auth.uid()`, inside the body. **There is no
-- organisation parameter and there must never be one**: a client-supplied
-- organisation id is a cross-tenant read with extra steps.
--
-- Keeping the signature is also what makes this migration small enough to trust:
-- `threshold` and `threshold_number` have **52 call sites across 23 migrations**
-- (`grep -o 'public\.threshold' services/api/supabase/migrations/*.sql | wc -l`), and
-- `threshold_number` delegates to `threshold`, so changing one body gives all of them
-- organisation scoping without touching a single caller.
--
-- **The body below was generated from `pg_proc.prosrc` on the running database**, not
-- retyped from a migration file -- the rule W1-C A2 earned after three defects were
-- introduced by hand-copying a function that a later migration had redefined.
--
-- ## A caller with no organisation still works
--
-- Background jobs (the purge worker, the watchdog) connect with no JWT, so `auth.uid()`
-- is null and no organisation resolves. They fall through to `global`, which is what
-- they read today. **That path is asserted in the tests, not assumed.**
-- ---------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The column and the scope
-- ----------------------------------------------------------------------------

alter table public.app_thresholds
  add column organisation_id uuid references public.organisations (id) on delete restrict;

-- The scope vocabulary grows by one. `global` and `territory` keep their meaning.
alter table public.app_thresholds drop constraint if exists app_thresholds_scope_check;
alter table public.app_thresholds
  add constraint app_thresholds_scope_check
  check (scope in ('global', 'organisation', 'territory'));

-- Scope and the id columns must agree, in both directions, for all three scopes.
-- Without this a row could claim `organisation` scope and carry no organisation, which
-- would resolve as global for everybody -- the widest possible failure from the
-- narrowest possible typo.
alter table public.app_thresholds
  drop constraint if exists app_thresholds_scope_matches_territory;
alter table public.app_thresholds
  add constraint app_thresholds_scope_matches_ids
  check (
    (scope = 'global'          and organisation_id is null     and territory_id is null)
    or (scope = 'organisation' and organisation_id is not null and territory_id is null)
    -- A territory already belongs to exactly one organisation, so a territory row
    -- carries no organisation of its own. Allowing both would create a row that could
    -- name a territory in one company and an organisation in another.
    or (scope = 'territory'    and organisation_id is null     and territory_id is not null)
  );

-- The uniqueness key gains the organisation. Postgres treats NULLs as distinct here,
-- which is what allows one global row and one row per organisation to coexist for the
-- same key and instant.
alter table public.app_thresholds drop constraint if exists app_thresholds_unique_version;
alter table public.app_thresholds
  add constraint app_thresholds_unique_version
  unique (key, organisation_id, territory_id, effective_from);

create index if not exists app_thresholds_org_lookup_idx
  on public.app_thresholds (key, organisation_id, effective_from desc);

comment on column public.app_thresholds.organisation_id is
  'W1-L / BE-C10: the company a setting belongs to. NULL for a global default, which is the floor '
  'every company gets until they override it.';

-- ----------------------------------------------------------------------------
-- 2. The resolver
-- ----------------------------------------------------------------------------

create or replace function public.threshold(p_key text, p_territory_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- territory > organisation > global. Among equals, the latest effective_from.
  --
  -- The organisation is resolved from the CALLER inside this query and is never a
  -- parameter (C3). A caller with no identity -- a background job -- matches only the
  -- `organisation_id is null` rows, which is the global floor it reads today.
  select t.value
    from public.app_thresholds t
   where t.key = p_key
     and t.effective_from <= now()
     and (t.territory_id is null or t.territory_id = p_territory_id)
     and (
       t.organisation_id is null
       or t.organisation_id = (
         select up.organisation_id from public.user_profiles up
          where up.id = (select auth.uid())
       )
     )
   order by (t.territory_id is not null) desc,
            (t.organisation_id is not null) desc,
            t.effective_from desc
   limit 1;
$$;

comment on function public.threshold(text, uuid) is
  'W1-L / BE-C10: resolves territory > organisation > global for the CALLER''s organisation. '
  'The organisation is never an argument -- a client-supplied one would be a cross-tenant read.';

-- ----------------------------------------------------------------------------
-- 3. Writing and reading a company's own settings
-- ----------------------------------------------------------------------------
--
-- The table is not directly readable (`20260923000300`) and is append-only, so both
-- directions go through functions. An "update" is a new row with a later
-- `effective_from`, exactly as a global change already is.

create or replace function public.set_organisation_threshold(
  p_key   text,
  p_value jsonb,
  p_note  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller record;
  v_id     uuid;
begin
  select * into v_caller from public.lms_caller();

  if v_caller.role <> 'admin' then
    raise exception 'only an admin may change a company setting' using errcode = '42501';
  end if;
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'a key is required' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'a value is required' using errcode = '22023';
  end if;

  -- `organisation_id` comes from the caller, never from an argument.
  insert into public.app_thresholds
    (key, value, scope, organisation_id, note, set_by_user_id, effective_from)
  values
    (p_key, p_value, 'organisation', v_caller.organisation_id,
     coalesce(p_note, 'Set from the admin console.'), v_caller.user_id, now())
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'key', p_key,
    'scope', 'organisation',
    'organisationId', v_caller.organisation_id);
end;
$$;

create or replace function public.organisation_threshold(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller  record;
  v_value   jsonb;
  v_set_at  timestamptz;
  v_note    text;
  v_found   boolean := false;
begin
  select * into v_caller from public.lms_caller();

  if v_caller.role <> 'admin' then
    raise exception 'only an admin may read a company setting' using errcode = '42501';
  end if;

  -- What this company's own row says, and whether it has one at all. Deliberately does
  -- NOT fall back to the global value: a console showing a global default as though the
  -- company had chosen it is the per-company confusion BE-W106 existed to remove.
  select t.value, t.effective_from, t.note, true
    into v_value, v_set_at, v_note, v_found
    from public.app_thresholds t
   where t.key = p_key
     and t.scope = 'organisation'
     and t.organisation_id = v_caller.organisation_id
     and t.effective_from <= now()
   order by t.effective_from desc
   limit 1;

  return jsonb_build_object(
    'key', p_key,
    -- `hasOwnValue` is whether a ROW exists, tracked separately from the value, because
    -- a stored JSON `null` is a value a company chose and must not read as "unset".
    'hasOwnValue', coalesce(v_found, false),
    'value', v_value,
    -- The value actually in force for this caller, resolved through the same function
    -- every feature uses, so the console cannot disagree with the database.
    'effectiveValue', public.threshold(p_key, null),
    'setAt', v_set_at,
    'note', v_note);
end;
$$;

revoke all on function public.set_organisation_threshold(text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.organisation_threshold(text) from public, anon, authenticated;
grant execute on function public.set_organisation_threshold(text, jsonb, text) to authenticated;
grant execute on function public.organisation_threshold(text) to authenticated;
