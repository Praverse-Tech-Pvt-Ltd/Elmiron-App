-- Rollback for AI-B1 -- removes the catalogue.
--
-- What rolling back MEANS: every market, therapy area, product and product-market link is
-- destroyed. Anything built on top (the LMS, `20260924000500`) must be rolled back first, and its
-- foreign keys will refuse this otherwise. The audit_log rows recording catalogue changes are NOT
-- removed and could not be: the table is append-only. The client must be rolled back with this if
-- it has started reading `products`.

drop table if exists public.product_markets;
drop table if exists public.products;
drop table if exists public.therapy_areas;
drop table if exists public.markets;

drop function if exists public.products_same_organisation();
drop function if exists public.product_markets_derive_organisation();
drop function if exists public.reject_organisation_change();
