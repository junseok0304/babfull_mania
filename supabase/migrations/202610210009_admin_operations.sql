create or replace function public.admin_search_profiles(
  search_query text default null,
  active_filter boolean default null
)
returns table (
  id uuid,
  name text,
  affiliation text,
  user_type text,
  role public.user_role,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 사용자를 조회할 수 있습니다.' using errcode = '42501';
  end if;

  return query
  select p.id, p.name, p.affiliation, p.user_type, p.role, p.is_active, p.created_at
  from public.profiles p
  where (active_filter is null or p.is_active = active_filter)
    and (nullif(trim(search_query), '') is null
      or p.name ilike '%' || trim(search_query) || '%'
      or p.affiliation ilike '%' || trim(search_query) || '%')
  order by p.is_active desc, p.created_at desc
  limit 200;
end;
$$;

create or replace function public.admin_update_profile(
  target_user_id uuid,
  target_role public.user_role,
  target_user_type text,
  target_affiliation text,
  target_is_active boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception '관리자만 사용자 정보를 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if target_user_type not in ('student', 'faculty', 'staff', 'other') then
    raise exception '올바른 사용자 유형을 선택해 주세요.' using errcode = '22023';
  end if;
  if target_user_id = auth.uid() and (target_role <> 'admin' or not target_is_active) then
    raise exception '현재 로그인한 관리자 계정은 권한을 해제하거나 비활성화할 수 없습니다.' using errcode = '22023';
  end if;

  update public.profiles
  set role = target_role,
      user_type = target_user_type,
      affiliation = nullif(trim(target_affiliation), ''),
      is_active = target_is_active
  where profiles.id = target_user_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception '사용자를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  return updated_profile;
end;
$$;

create or replace function public.admin_update_operating_settings(
  breakfast_start time,
  breakfast_end time,
  lunch_start time,
  lunch_end time,
  scan_buffer_minutes integer
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
    raise exception '관리자만 운영 설정을 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if breakfast_start >= breakfast_end or lunch_start >= lunch_end then
    raise exception '식사 종료 시간은 시작 시간보다 늦어야 합니다.' using errcode = '22023';
  end if;
  if breakfast_end >= lunch_start then
    raise exception '조식과 중식 제공시간이 겹칠 수 없습니다.' using errcode = '22023';
  end if;
  if scan_buffer_minutes < 0 or scan_buffer_minutes > 120 then
    raise exception 'QR 자동 선택 허용 범위는 0~120분이어야 합니다.' using errcode = '22023';
  end if;

  next_value := jsonb_build_object(
    'breakfast_start', to_char(breakfast_start, 'HH24:MI'),
    'breakfast_end', to_char(breakfast_end, 'HH24:MI'),
    'lunch_start', to_char(lunch_start, 'HH24:MI'),
    'lunch_end', to_char(lunch_end, 'HH24:MI'),
    'scan_buffer_minutes', scan_buffer_minutes,
    'confirmed', true
  );

  insert into public.app_settings (setting_key, setting_value, is_public)
  values ('meal_hours', next_value, true)
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value, is_public = true, updated_at = now();
  return next_value;
end;
$$;

create or replace function public.process_scanned_meal_usage(
  target_qr_token uuid,
  target_scanned_at timestamptz default now()
)
returns public.meal_usages
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user public.profiles;
  created_usage public.meal_usages;
  meal_hours jsonb;
  local_date date := (target_scanned_at at time zone 'Asia/Seoul')::date;
  local_time time := (target_scanned_at at time zone 'Asia/Seoul')::time;
  breakfast_start time;
  breakfast_end time;
  lunch_start time;
  lunch_end time;
  scan_buffer interval;
  selected_type public.meal_type;
  fixed_price integer;
begin
  if not public.is_admin() then
    raise exception '관리자만 식권을 처리할 수 있습니다.' using errcode = '42501';
  end if;

  select setting_value into meal_hours from public.app_settings where setting_key = 'meal_hours';
  breakfast_start := coalesce((meal_hours ->> 'breakfast_start')::time, '08:00'::time);
  breakfast_end := coalesce((meal_hours ->> 'breakfast_end')::time, '09:30'::time);
  lunch_start := coalesce((meal_hours ->> 'lunch_start')::time, '11:30'::time);
  lunch_end := coalesce((meal_hours ->> 'lunch_end')::time, '14:00'::time);
  scan_buffer := make_interval(mins => coalesce((meal_hours ->> 'scan_buffer_minutes')::integer, 30));

  if local_time between breakfast_start - scan_buffer and breakfast_end + scan_buffer then
    selected_type := 'breakfast';
  elsif local_time between lunch_start - scan_buffer and lunch_end + scan_buffer then
    selected_type := 'lunch';
  elsif local_time < lunch_start - scan_buffer then
    selected_type := 'breakfast';
  else
    selected_type := 'lunch';
  end if;

  select * into target_user from public.profiles
  where qr_token = target_qr_token and is_active = true
  for update;
  if target_user.id is null then
    raise exception '유효한 사용자를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  fixed_price := case selected_type when 'breakfast' then 1000 else 5300 end;
  insert into public.meal_usages (user_id, meal_date, meal_type, price, processed_by)
  values (target_user.id, local_date, selected_type, fixed_price, auth.uid())
  returning * into created_usage;
  return created_usage;
exception
  when unique_violation then
    raise exception '이미 사용 처리된 식권입니다.' using errcode = '23505';
end;
$$;

revoke all on function public.admin_search_profiles(text, boolean) from public, anon;
revoke all on function public.admin_update_profile(uuid, public.user_role, text, text, boolean) from public, anon;
revoke all on function public.admin_update_operating_settings(time, time, time, time, integer) from public, anon;
grant execute on function public.admin_search_profiles(text, boolean) to authenticated;
grant execute on function public.admin_update_profile(uuid, public.user_role, text, text, boolean) to authenticated;
grant execute on function public.admin_update_operating_settings(time, time, time, time, integer) to authenticated;
