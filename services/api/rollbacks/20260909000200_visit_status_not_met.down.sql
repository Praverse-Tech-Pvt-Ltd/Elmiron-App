-- Rollback for MR-12 Part D1, first of two.
--
-- **PostgreSQL cannot remove a value from an enum.** There is no `alter type ... drop
-- value`, and the only way to be rid of it is to create a replacement type, migrate every
-- column that uses `visit_status`, and drop the original -- which rewrites `visits` and
-- every view over it.
--
-- That is not done here, and pretending otherwise with an empty file would be worse. A
-- label that no constraint requires and no function writes is inert: after
-- 20260909000300.down.sql runs, nothing can produce a `not_met` visit. The label remains
-- readable in `pg_enum` and means nothing.
--
-- This file exists so that the rollback COUNT matches the migration count and
-- verify:rollbacks has something to execute, and so that the reason is written down where
-- somebody looking for it will find it.

do $$
begin
  raise notice
    'visit_status.not_met is left in place: PostgreSQL cannot drop an enum label. '
    'It is inert once 20260909000300.down.sql has removed the column and constraints.';
end $$;
