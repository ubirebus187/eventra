-- Run via Supabase SQL Editor with database admin privileges.
-- All app tables must be located in schema 'event'.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'event' AND table_name IN ('profiles','events','notifications')
ORDER BY table_name;

-- Every auth.users account should have a matching event.profiles record.
SELECT u.email, u.id, p.full_name, p.role,
       CASE WHEN p.id IS NULL THEN 'PROFIL BELUM ADA' ELSE 'OK' END AS profile_status
FROM auth.users u LEFT JOIN event.profiles p ON p.id = u.id
ORDER BY u.email;

-- Show permissions for authenticated role. Exposed schemas in Supabase dashboard
-- cannot be checked via this SQL: configure separately in Data API settings.
SELECT has_schema_privilege('authenticated', 'event', 'USAGE') AS can_use_event_schema,
       has_table_privilege('authenticated', 'event.profiles', 'SELECT') AS can_read_profiles,
       has_table_privilege('authenticated', 'event.events', 'SELECT') AS can_read_events,
       has_function_privilege('authenticated', 'event.sync_my_reminders()', 'EXECUTE') AS can_sync_reminders;

-- Cron availability. Returns false until pg_cron extension is enabled.
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS pg_cron_enabled;
