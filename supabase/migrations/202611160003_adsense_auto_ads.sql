-- 개별 광고 단위가 아닌 사이트 전체 AdSense 자동 광고 토글로 단순화합니다.
update public.app_settings
set setting_value = jsonb_build_object(
      'enabled', coalesce((setting_value ->> 'enabled')::boolean, false),
      'client_id', 'ca-pub-9030402652749847'
    ),
    is_public = true,
    updated_at = now()
where setting_key = 'adsense_banner';

drop function if exists public.admin_update_adsense_banner_settings(boolean, text);

create or replace function public.admin_update_adsense_banner_settings(
  adsense_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 광고 설정을 수정할 수 있습니다.' using errcode = '42501';
  end if;

  next_value := jsonb_build_object(
    'enabled', coalesce(adsense_enabled, false),
    'client_id', 'ca-pub-9030402652749847'
  );

  insert into public.app_settings (setting_key, setting_value, is_public, updated_at)
  values ('adsense_banner', next_value, true, now())
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value,
        is_public = true,
        updated_at = now();
  return next_value;
end;
$$;

revoke all on function public.admin_update_adsense_banner_settings(boolean) from public, anon;
grant execute on function public.admin_update_adsense_banner_settings(boolean) to authenticated;
