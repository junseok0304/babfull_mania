create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_weekly_yeongjun_import()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  cron_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'babfull_project_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'babfull_cron_secret' limit 1;
  if project_url is null or cron_secret is null then
    raise warning '밥풀매니아 Cron Vault 설정이 없어 주간 수집을 건너뜁니다.';
    return;
  end if;
  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/import-yeongjun-menu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'babfull-weekly-menu-import' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('babfull-weekly-menu-import', '0 21 * * 0', 'select public.invoke_weekly_yeongjun_import();');
end;
$$;

revoke all on function public.invoke_weekly_yeongjun_import() from public, anon, authenticated;
