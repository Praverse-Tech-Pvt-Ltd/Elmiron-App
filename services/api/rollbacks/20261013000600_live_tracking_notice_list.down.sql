-- Rollback for `BE-W201` (20261013000600_live_tracking_notice_list): an admin can no longer list the
-- company's live-tracking notice versions in one read. Proposing and approving
-- (`propose_live_tracking_notice`, `approve_live_tracking_notice`) and every row are untouched.
-- Roll the console (`/tracking/notice`) back with this.
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>

drop function if exists public.live_tracking_notices();
