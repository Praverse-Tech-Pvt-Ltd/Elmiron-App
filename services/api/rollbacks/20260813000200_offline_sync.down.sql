-- Rollback for 20260813000200_offline_sync.sql
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>
--
-- Note: dropping sync_items destroys the record of what was refused and why. An MR
-- with unresolved rejections loses the only evidence that the work happened.
-- Export before running this anywhere real.

drop function if exists public.my_shift_window();
drop function if exists public.list_sync_rejections(uuid, integer);
drop function if exists public.sync_queue_status(uuid);
drop function if exists public.sync_push(uuid, jsonb);
drop function if exists public.apply_sync_item(public.sync_entity_kind, uuid, jsonb);

drop policy if exists sync_items_select_scope   on public.sync_items;
drop policy if exists sync_batches_select_scope on public.sync_batches;

drop table if exists public.sync_items;

drop trigger if exists sync_batches_stamp_received_at on public.sync_batches;
drop table if exists public.sync_batches;

drop type if exists public.sync_rejection_code;
drop type if exists public.sync_item_status;
drop type if exists public.sync_entity_kind;

-- Restore the BE-W2 visit insert policy, which checked ownership only.
drop policy if exists visits_insert_own on public.visits;
create policy visits_insert_own
  on public.visits for insert to authenticated
  with check (mr_id = (select auth.uid()));
