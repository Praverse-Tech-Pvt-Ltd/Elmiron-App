-- Rollback for W1-V C (`BE-W138`): the rejection log stops being append-only. No row changes;
-- the owner can once again UPDATE, DELETE or TRUNCATE it. `reject_mutation()` is shared and stays.

drop trigger if exists write_rejections_reject_mutation on public.write_rejections;
