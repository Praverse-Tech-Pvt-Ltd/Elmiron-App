-- ============================================================================
-- AI-B1 -- the catalogue: markets, therapy areas, products, and where each product is sold.
-- ============================================================================
--
-- `docs/ai-platform/phase-a-recon.md` §1.1: nothing in this schema names a product. The only trace
-- is `call_reports.product_ids_discussed uuid[]`, which has no foreign key because there has never
-- been anything for it to point at. The LMS, approved knowledge and the AI Doctor all need to say
-- "about this product, in this market", so this is their foundation.
--
-- **What this migration deliberately does NOT hold.** Identity only: a brand name, a generic name,
-- a therapy area, the markets it is sold in. **No indication, no dose, no claim, no label text.**
-- Every one of those is promotional or regulatory content with a version, an approver and a
-- market, and it belongs in approved, versioned knowledge -- not in a column an admin can edit in
-- place with no approval step. A product row saying something about a drug would be the one
-- unversioned, unapproved statement in the system.
--
-- **What is NOT decided here, and stays open.**
-- * D5 -- the product list itself. No rows are inserted. ELMIRON is a third-party trademark
--   (`docs/brand-identifier-decision.md`) and the client's real catalogue has never been given.
-- * D6 -- whether an ORGANISATION has a market. This migration puts market on the CONTENT side
--   (a product is sold in markets), which is the shape that serves "different markets need
--   different course/content versions" without deciding anything about the organisation.
--
-- **A market is one country** (ISO 3166-1 alpha-2). "Global" is not a market: global content is
-- content that names no market, which is a property of the content, not a row here.
--
-- **Access.** Everyone signed in reads their own organisation's catalogue -- an MR needs the
-- product list. Only an admin writes it, and only in their own organisation. Nothing is deleted
-- except a product-market link: a product or market that stops being used is retired with
-- `is_active = false`, because history (courses taken, sessions run) will point at it.
-- Same shape as `doctors`: a permissive scope policy, an admin write policy, and the RESTRICTIVE
-- tenant boundary (`20260908001300`) AND-ed over both.

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table public.markets (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.current_user_organisation_id()
                  references public.organisations (id) on delete restrict,
  country_code    text not null,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint markets_country_code_iso check (country_code ~ '^[A-Z]{2}$'),
  constraint markets_name_present check (length(btrim(name)) > 0),
  constraint markets_one_per_country unique (organisation_id, country_code)
);

create table public.therapy_areas (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.current_user_organisation_id()
                  references public.organisations (id) on delete restrict,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint therapy_areas_name_present check (length(btrim(name)) > 0)
);

create unique index therapy_areas_name_unique
  on public.therapy_areas (organisation_id, lower(btrim(name)));

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.current_user_organisation_id()
                  references public.organisations (id) on delete restrict,
  therapy_area_id uuid references public.therapy_areas (id) on delete restrict,
  brand_name      text not null,
  -- The non-proprietary name. Nullable: a device or a kit may not have one.
  generic_name    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_brand_name_present check (length(btrim(brand_name)) > 0),
  constraint products_generic_name_present
    check (generic_name is null or length(btrim(generic_name)) > 0)
);

create unique index products_brand_name_unique
  on public.products (organisation_id, lower(btrim(brand_name)));
create index products_therapy_area_idx on public.products (therapy_area_id);

create table public.product_markets (
  id              uuid primary key default gen_random_uuid(),
  -- Derived from the product by trigger; carried so the tenant boundary is one column, like
  -- every other boundary in this schema, rather than a join inside a policy.
  organisation_id uuid not null,
  product_id      uuid not null references public.products (id) on delete restrict,
  market_id       uuid not null references public.markets (id) on delete restrict,
  created_at      timestamptz not null default now(),
  constraint product_markets_organisation_fk
    foreign key (organisation_id) references public.organisations (id) on delete restrict,
  constraint product_markets_once unique (product_id, market_id)
);

create index product_markets_market_idx on public.product_markets (market_id);

-- ----------------------------------------------------------------------------
-- 2. Cross-row validity -- a reference never crosses an organisation
-- ----------------------------------------------------------------------------
--
-- RLS decides which rows a caller may touch; it cannot say that the therapy area a product points
-- at belongs to the same company. A foreign key checks existence, not tenancy. So a trigger does,
-- as `territories` does for its parent (`20260908000900`). SECURITY DEFINER so it can see the
-- referenced row whatever the caller's policies allow -- it reads, it never returns data.

create or replace function public.products_same_organisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.therapy_area_id is not null and not exists (
    select 1 from public.therapy_areas t
     where t.id = new.therapy_area_id and t.organisation_id = new.organisation_id
  ) then
    raise exception 'products: therapy area % is not in organisation %',
      new.therapy_area_id, new.organisation_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger products_same_organisation
  before insert or update of therapy_area_id, organisation_id on public.products
  for each row execute function public.products_same_organisation();

create or replace function public.product_markets_derive_organisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_org uuid;
  v_market_org  uuid;
begin
  select p.organisation_id into v_product_org from public.products p where p.id = new.product_id;
  select m.organisation_id into v_market_org from public.markets m where m.id = new.market_id;

  -- The caller does not choose the tenant of a link; the product does.
  new.organisation_id := v_product_org;

  if v_product_org is distinct from v_market_org then
    raise exception 'product_markets: product and market belong to different organisations'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger product_markets_derive_organisation
  before insert or update on public.product_markets
  for each row execute function public.product_markets_derive_organisation();

-- A therapy area cannot move to another organisation underneath its products, and neither can a
-- market underneath its links. Simplest statement of that: the column does not change.
create or replace function public.reject_organisation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id then
    raise exception '%: organisation_id cannot change', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger markets_organisation_fixed
  before update of organisation_id on public.markets
  for each row execute function public.reject_organisation_change();
create trigger therapy_areas_organisation_fixed
  before update of organisation_id on public.therapy_areas
  for each row execute function public.reject_organisation_change();
create trigger products_organisation_fixed
  before update of organisation_id on public.products
  for each row execute function public.reject_organisation_change();

-- ----------------------------------------------------------------------------
-- 3. updated_at and audit
-- ----------------------------------------------------------------------------

create trigger markets_set_updated_at before update on public.markets
  for each row execute function public.set_updated_at();
create trigger therapy_areas_set_updated_at before update on public.therapy_areas
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create trigger markets_audit after insert or update or delete on public.markets
  for each row execute function public.write_audit_row();
create trigger therapy_areas_audit after insert or update or delete on public.therapy_areas
  for each row execute function public.write_audit_row();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.write_audit_row();
create trigger product_markets_audit after insert or update or delete on public.product_markets
  for each row execute function public.write_audit_row();

-- ----------------------------------------------------------------------------
-- 4. Privileges -- revoke before grant (constraints.md, "Always")
-- ----------------------------------------------------------------------------

revoke all on table public.markets, public.therapy_areas, public.products, public.product_markets
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.markets, public.therapy_areas, public.products
  to authenticated;
-- A link is the one thing that is deleted: a product withdrawn from a market. The audit row is
-- the record that it was ever sold there.
grant select, insert, delete on table public.product_markets to authenticated;

revoke all on function public.products_same_organisation() from public, anon, authenticated;
revoke all on function public.product_markets_derive_organisation() from public, anon, authenticated;
revoke all on function public.reject_organisation_change() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Row-level security
-- ----------------------------------------------------------------------------

alter table public.markets enable row level security;
alter table public.markets force row level security;
alter table public.therapy_areas enable row level security;
alter table public.therapy_areas force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.product_markets enable row level security;
alter table public.product_markets force row level security;

-- Read: everyone in the organisation.
create policy markets_select_own_organisation on public.markets
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());
create policy therapy_areas_select_own_organisation on public.therapy_areas
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());
create policy products_select_own_organisation on public.products
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());
create policy product_markets_select_own_organisation on public.product_markets
  for select to authenticated
  using (organisation_id = public.current_user_organisation_id());

-- Write: an admin, in their own organisation. `is_admin()` reads `user_profiles`, not the token.
create policy markets_admin_insert on public.markets
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy markets_admin_update on public.markets
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy therapy_areas_admin_insert on public.therapy_areas
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy therapy_areas_admin_update on public.therapy_areas
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy products_admin_insert on public.products
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy products_admin_update on public.products
  for update to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id())
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());

create policy product_markets_admin_insert on public.product_markets
  for insert to authenticated
  with check (public.is_admin() and organisation_id = public.current_user_organisation_id());
create policy product_markets_admin_delete on public.product_markets
  for delete to authenticated
  using (public.is_admin() and organisation_id = public.current_user_organisation_id());

-- The boundary, RESTRICTIVE, expression copied from `20260908001300`.
create policy markets_tenant_boundary on public.markets
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy therapy_areas_tenant_boundary on public.therapy_areas
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy products_tenant_boundary on public.products
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());
create policy product_markets_tenant_boundary on public.product_markets
  as restrictive for all to authenticated
  using (organisation_id = public.current_user_organisation_id())
  with check (organisation_id = public.current_user_organisation_id());

-- ----------------------------------------------------------------------------
-- 6. Self-checks -- the migration refuses to apply if its own posture is wrong
-- ----------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array['markets', 'therapy_areas', 'products', 'product_markets'] loop
    if not (select c.relforcerowsecurity from pg_class c
             where c.oid = format('public.%I', v_table)::regclass) then
      raise exception 'AI-B1: RLS is not forced on %', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'select')
       or has_table_privilege('anon', format('public.%I', v_table), 'truncate')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'truncate') then
      raise exception 'AI-B1: % is reachable by anon, or truncatable', v_table;
    end if;
    if not exists (select 1 from pg_policy p
                    where p.polrelid = format('public.%I', v_table)::regclass
                      and not p.polpermissive
                      and p.polname = v_table || '_tenant_boundary') then
      raise exception 'AI-B1: % has no restrictive tenant boundary', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.products', 'delete') then
    raise exception 'AI-B1: products must be retired, never deleted';
  end if;
end;
$$;
