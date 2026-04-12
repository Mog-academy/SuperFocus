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
  notify_hours integer[]   default '{6,12,18}',
  updated_at   timestamptz default now()
);

-- If the table already exists, add the column (safe to run twice):
alter table push_subscriptions
  add column if not exists notify_hours integer[] default '{6,12,18}';

-- 2. RLS (service role bypasses this, anon cannot read subscriptions)
alter table push_subscriptions enable row level security;

-- 3. Enable pg_cron and pg_net extensions
--    (or enable them via Dashboard > Database > Extensions)
create extension if not exists pg_net   schema extensions;
create extension if not exists pg_cron  schema cron;

-- 4. ONE hourly cron job — the edge function checks each subscription's
--    notify_hours against the current Dubai hour (UTC+4) at runtime.
--
--    Remove old jobs first if you ran the previous version of this SQL:
select cron.unschedule('superfocus-6am')  where exists (select 1 from cron.job where jobname = 'superfocus-6am');
select cron.unschedule('superfocus-12pm') where exists (select 1 from cron.job where jobname = 'superfocus-12pm');
select cron.unschedule('superfocus-6pm')  where exists (select 1 from cron.job where jobname = 'superfocus-6pm');
select cron.unschedule('superfocus-hourly') where exists (select 1 from cron.job where jobname = 'superfocus-hourly');

--    REPLACE <YOUR_SERVICE_ROLE_KEY> before running
select cron.schedule(
  'superfocus-hourly',
  '0 * * * *',
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

-- To verify:
-- select * from cron.job;
