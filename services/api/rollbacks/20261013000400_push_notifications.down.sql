-- Rollback for 20261013000400_push_notifications.sql (`BE-W195`)
-- Apply by hand: psql "$SUPABASE_DB_URL" -f <this file>  (after 20261013000410's rollback)
--
-- WHAT ROLLING BACK MEANS:
--   * Every registered device token and the whole notification ledger -- what was to be sent, to
--     whom, why, and whether it arrived -- are DROPPED with their tables. Export
--     `notification_outbox` first if anybody may need to show that a rep was told something.
--   * Audit rows written for token registrations and manual sender runs stay (`audit_log` is
--     append-only); they name a table that no longer exists.
--   * The CLIENTS must roll back with this: the field app's push registration (`EXPO_PUBLIC_PUSH`)
--     calls `register_push_token` / `unregister_push_token`, and the `push-sender` Edge Function
--     calls `push_claim_batch`, `push_record_results` and `push_sender_authorise`. Undeploy the
--     function and disable `.github/workflows/push-sender.yml` in the same change.

drop function if exists public.push_sender_authorise();
drop function if exists public.push_record_results(jsonb);
drop function if exists public.push_claim_batch(integer);
drop function if exists public.unregister_push_token(text);
drop function if exists public.register_push_token(text);
drop function if exists public.enqueue_notification(uuid, text, text, text, text, text, uuid, text);

drop table if exists public.notification_outbox;
drop table if exists public.device_push_tokens;

drop function if exists public.notification_outbox_guard();
drop function if exists public.device_push_tokens_stamp();
