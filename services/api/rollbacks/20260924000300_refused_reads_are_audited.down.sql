-- Rollback for MR-54 `BE-W102` -- stops recording refused reads.
--
-- The audit_log ROWS already written stay, and must: the table is append-only by trigger,
-- and a trail that can be rewound is not a trail. Rolling this back means "record no more
-- refusals", never "unrecord the ones taken". The `refused` column therefore also stays --
-- dropping it would destroy the only thing distinguishing those rows from ordinary reads,
-- which is the opposite of what an audit rollback should do.

drop function if exists public.list_audit_log(integer, bigint, text, boolean);
drop function if exists public.refuse_read(text, text, text, text);
