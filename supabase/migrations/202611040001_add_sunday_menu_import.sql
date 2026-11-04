do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'babfull-sunday-menu-import'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  -- pg_cron uses UTC: Sunday 12:00 UTC = Sunday 21:00 Asia/Seoul.
  perform cron.schedule(
    'babfull-sunday-menu-import',
    '0 12 * * 0',
    'select public.invoke_weekly_yeongjun_import();'
  );
end;
$$;

insert into public.app_settings (setting_key, setting_value, is_public, updated_at)
values (
  'import_schedule',
  '{"timezone":"Asia/Seoul","schedules":[{"cron":"0 12 * * 0","local_schedule":"일요일 21:00"},{"cron":"30 23 * * 0","local_schedule":"월요일 08:30"}]}'::jsonb,
  false,
  now()
)
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    is_public = false,
    updated_at = now();
