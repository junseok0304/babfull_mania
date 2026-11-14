-- 식판 제공 방식을 AI 사전 생성 이미지로 단일화합니다.
-- 식단에 이미지가 아직 연결되지 않은 경우 프론트엔드의 텍스트 식판 대체 UI가 유지됩니다.
insert into public.app_settings (setting_key, setting_value, is_public, updated_at)
values ('tray_display_mode', '{"mode":"ai"}'::jsonb, true, now())
on conflict (setting_key) do update
set setting_value = excluded.setting_value,
    is_public = excluded.is_public,
    updated_at = now();
