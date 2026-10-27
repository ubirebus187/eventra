-- After migration 003: run once in Supabase SQL Editor with db admin privileges.
-- The installation step may also be done via Dashboard > Integrations > Cron > Enable.
-- Once installed this job schedules itself; no user browser permission or button required.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
-- Every hour, 7 days / tomorrow / today reminders for all accounts, even if dashboard closed.
SELECT cron.schedule(
  'eventra-reminders-hourly',
  '0 * * * *',
  $$ SELECT event.dispatch_event_reminders(); $$
);
-- Remove the OLD daily job if you created it previously (don't run if not needed):
-- SELECT cron.unschedule('eventra-reminders-daily');
-- Verify:
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname = 'eventra-reminders-hourly';
-- Test now (optional): SELECT event.dispatch_event_reminders();
