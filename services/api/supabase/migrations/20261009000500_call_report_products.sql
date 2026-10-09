-- `BE-W175` -- the products on a call report are real products of the rep's company.
--
-- **The defect.** `call_reports.product_ids_discussed uuid[]` accepted any uuids: no existence
-- check (it is an array, so no foreign key), no company check, no active check. The phone sent `[]`
-- on purpose because it had no catalogue (`app/report/[visitId].tsx`). Now the catalogue exists
-- (`20260924000400`) and the phone offers it, so the server must not trust the ids it receives.
--
-- **The rules, on every insert (a report is append-only; a revision is a new row):**
--   * no id twice                                        -> 22023 `call_report_product_duplicate`
--   * each id is a product of the rep's organisation     -> 23503 `call_report_product_unknown`
--     (unknown and another company's are ONE answer: a separate one would tell a rep that a
--     product id exists in another tenant)
--   * a product NEWLY selected is active                 -> 22023 `call_report_product_inactive`
--     "Newly" = not on the version this row supersedes. A product retired after the report was
--     written stays on it and on its revisions: history is readable and revisable, never rewritten.
--
-- **Not a rule here: at least one product.** Nothing in the repository requires one, and a call
-- where no product came up is a real call. Zero stays valid.
--
-- **Not a rule here: market.** No rep or territory has a market yet (the catalogue's open question
-- D6), so "a product sold in the rep's market" cannot be expressed. Company and active can.
--
-- Rollback: services/api/rollbacks/20261009000500_call_report_products.down.sql

create or replace function public.validate_call_report_products()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_org       uuid;
  v_previous  uuid[] := '{}';
  v_unknown   uuid;
  v_inactive  uuid;
begin
  if new.product_ids_discussed is null or cardinality(new.product_ids_discussed) = 0 then
    return new;
  end if;

  if array_position(new.product_ids_discussed, null) is not null then
    raise exception 'call_report_product_unknown: a product id is empty' using errcode = '23503';
  end if;
  if cardinality(new.product_ids_discussed)
     <> (select count(distinct p) from unnest(new.product_ids_discussed) p) then
    raise exception 'call_report_product_duplicate: a product is listed twice'
      using errcode = '22023';
  end if;

  select p.organisation_id into v_org from public.user_profiles p where p.id = new.mr_id;

  select p into v_unknown
    from unnest(new.product_ids_discussed) p
   where not exists (select 1 from public.products x where x.id = p and x.organisation_id = v_org)
   limit 1;
  if v_unknown is not null then
    raise exception 'call_report_product_unknown: % is not a product of your company', v_unknown
      using errcode = '23503',
            hint = 'Choose products from the list the app shows; it is your company''s catalogue.';
  end if;

  if new.supersedes_call_report_id is not null then
    select coalesce(c.product_ids_discussed, '{}') into v_previous
      from public.call_reports c where c.id = new.supersedes_call_report_id;
  end if;

  select p into v_inactive
    from unnest(new.product_ids_discussed) p
    join public.products x on x.id = p
   where not x.is_active
     and not (p = any (coalesce(v_previous, '{}')))
   limit 1;
  if v_inactive is not null then
    raise exception 'call_report_product_inactive: % is no longer offered', v_inactive
      using errcode = '22023',
            hint = 'A retired product cannot be newly added to a report. Refresh the product list.';
  end if;

  return new;
end
$$;

revoke execute on function public.validate_call_report_products() from public;

create trigger call_reports_validate_products
  before insert on public.call_reports
  for each row execute function public.validate_call_report_products();
