-- 홈 상단 배너 광고의 노출 여부와 AdSense 광고 단위 ID를 운영 설정으로 관리합니다.
insert into public.app_settings (setting_key, setting_value, is_public, updated_at)
values (
  'adsense_banner',
  '{"enabled":false,"client_id":"ca-pub-9030402652749847","slot_id":null}'::jsonb,
  true,
  now()
)
on conflict (setting_key) do nothing;

create or replace function public.admin_update_adsense_banner_settings(
  adsense_enabled boolean,
  adsense_slot_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_slot_id text := nullif(trim(coalesce(adsense_slot_id, '')), '');
  next_value jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 광고 설정을 수정할 수 있습니다.' using errcode = '42501';
  end if;

  if coalesce(adsense_enabled, false) and normalized_slot_id is null then
    raise exception '광고를 켜려면 AdSense 광고 단위 ID가 필요합니다.' using errcode = '22023';
  end if;
  if normalized_slot_id is not null and normalized_slot_id !~ '^[0-9]{6,20}$' then
    raise exception 'AdSense 광고 단위 ID는 6~20자리 숫자여야 합니다.' using errcode = '22023';
  end if;

  next_value := jsonb_build_object(
    'enabled', coalesce(adsense_enabled, false),
    'client_id', 'ca-pub-9030402652749847',
    'slot_id', normalized_slot_id
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

revoke all on function public.admin_update_adsense_banner_settings(boolean, text) from public, anon;
grant execute on function public.admin_update_adsense_banner_settings(boolean, text) to authenticated;
