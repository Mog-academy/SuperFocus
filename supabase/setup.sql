-- ============================================================
-- SuperFocus Push Notifications Setup — Single-user edition
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Drop old multi-user table if it exists
drop table if exists push_subscriptions;

-- 2. Single-row config table (id is always 1)
create table if not exists superfocus_config (
  id           integer     primary key default 1 check (id = 1),
  subscription jsonb,
  user_text    text        default '',
  notify_times text[]      default '{"06:00","12:00","18:00"}',
  start_date   text        default '',
  end_date     text        default '',
  entries      jsonb       default '{}',
  categories   text[]      default '{}',
  last_send_log text       default '',
  updated_at   timestamptz default now()
);

-- Ensure the single row exists
insert into superfocus_config (id) values (1) on conflict do nothing;

-- If table already exists, add new columns safely:
alter table superfocus_config add column if not exists start_date text default '';
alter table superfocus_config add column if not exists end_date text default '';
alter table superfocus_config add column if not exists entries jsonb default '{}';
alter table superfocus_config add column if not exists last_send_log text default '';
alter table superfocus_config add column if not exists categories text[] default '{}';

-- 3. RLS (service role bypasses this)
alter table superfocus_config enable row level security;

-- 4. Enable pg_cron and pg_net extensions
create extension if not exists pg_net   schema extensions;
create extension if not exists pg_cron  schema cron;

-- 5. Replace cron job (remove old ones first)
select cron.unschedule('superfocus-6am')     where exists (select 1 from cron.job where jobname = 'superfocus-6am');
select cron.unschedule('superfocus-12pm')    where exists (select 1 from cron.job where jobname = 'superfocus-12pm');
select cron.unschedule('superfocus-6pm')     where exists (select 1 from cron.job where jobname = 'superfocus-6pm');
select cron.unschedule('superfocus-hourly')  where exists (select 1 from cron.job where jobname = 'superfocus-hourly');
select cron.unschedule('superfocus-5min')    where exists (select 1 from cron.job where jobname = 'superfocus-5min');

select cron.schedule(
  'superfocus-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://ccwydkzvjkbguzvajyyk.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjd3lka3p2amtiZ3V6dmFqeXlrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDM2MzEyOCwiZXhwIjoyMDg5OTM5MTI4fQ.tPsP65ovwh_kL2Z2cZPxHwaqW0ijWV6DRVhqwkPXrag'
    ),
    body    := '{"type":"send"}'::jsonb
  );
  $$
);

-- To verify:
-- select * from cron.job;
-- select * from superfocus_config;
