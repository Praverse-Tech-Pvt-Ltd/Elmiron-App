-- Rollback for `BE-W175` (20261009000500_call_report_products): call reports accept any product
-- ids again. No row changes.

drop trigger if exists call_reports_validate_products on public.call_reports;
drop function if exists public.validate_call_report_products();
