-- ============================================================
-- SuperFocus Push Notifications Setup
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Table to store push subscriptions
create table if not exists push_subscriptions (
  id           uuid        default gen_random_uuid() primary key,
  endpoint     text        unique not null,
  subscription jsonb       not null,
  user_text    text        default '',
  updated_at   timestamptz default now()
);

-- 2. RLS (service role bypasses this, anon cannot read subscriptions)
alter table push_subscriptions enable row level security;

-- 3. Enable pg_cron and pg_net extensions
--    (or enable them via Dashboard > Database > Extensions)
create extension if not exists pg_net   schema extensions;
create extension if not exists pg_cron  schema cron;

-- 4. Scheduled jobs — cron runs in UTC
--    Asia/Dubai is UTC+4 (no DST), so:
--      6am   Dubai = 02:00 UTC
--      12pm  Dubai = 08:00 UTC
--      6pm   Dubai = 14:00 UTC
--
--    REPLACE <YOUR_SERVICE_ROLE_KEY> with your actual key from
--    Supabase Dashboard > Project Settings > API > service_role key

select cron.schedule(
  'superfocus-6am',
  '0 2 * * *',
  $$
  select extensions.http_post(
    url     := 'https://ccwydkzvjkbguzvajyyk.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body    := '{"type":"send"}'::jsonb
  );
  $$
);

select cron.schedule(
  'superfocus-12pm',
  '0 8 * * *',
  $$
  select extensions.http_post(
    url     := 'https://ccwydkzvjkbguzvajyyk.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body    := '{"type":"send"}'::jsonb
  );
  $$
);

select cron.schedule(
  'superfocus-6pm',
  '0 14 * * *',
  $$
  select extensions.http_post(
    url     := 'https://ccwydkzvjkbguzvajyyk.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>'
    ),
    body    := '{"type":"send"}'::jsonb
  );
  $$
);

-- To verify cron jobs were created:
-- select * from cron.job;
