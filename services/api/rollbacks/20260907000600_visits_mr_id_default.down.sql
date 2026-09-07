-- Rollback for 20260907000600_visits_mr_id_default.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Removes the default. After this, any client creating a visit must send `mr_id`
-- itself, and `CreateVisitRequestSchema` -- which does not declare it -- can no longer
-- describe a request the insert policy will accept.

alter table public.visits alter column mr_id drop default;

comment on column public.visits.mr_id is null;
