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

  if local_time between breakfast_start - interval '30 minutes' and breakfast_end + interval '30 minutes' then
    selected_type := 'breakfast';
  elsif local_time between lunch_start - interval '30 minutes' and lunch_end + interval '30 minutes' then
    selected_type := 'lunch';
  elsif local_time < lunch_start - interval '30 minutes' then
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

create or replace function public.admin_update_meal_usage(
  target_usage_id bigint,
  target_meal_type public.meal_type,
  target_status public.usage_status,
  note text default null
)
returns public.meal_usages
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_usage public.meal_usages;
begin
  if not public.is_admin() then
    raise exception '관리자만 이용 기록을 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if target_status = 'corrected' then
    raise exception '수정 완료 상태는 직접 선택할 수 없습니다.' using errcode = '22023';
  end if;

  update public.meal_usages
  set meal_type = target_meal_type,
      price = case target_meal_type when 'breakfast' then 1000 else 5300 end,
      status = target_status,
      correction_note = nullif(trim(note), '')
  where id = target_usage_id
  returning * into updated_usage;

  if updated_usage.id is null then
    raise exception '이용 기록을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  return updated_usage;
exception
  when unique_violation then
    raise exception '해당 사용자의 같은 날짜·식사 이용 기록이 이미 있습니다.' using errcode = '23505';
end;
$$;

grant execute on function public.process_scanned_meal_usage(uuid, timestamptz) to authenticated;
grant execute on function public.admin_update_meal_usage(bigint, public.meal_type, public.usage_status, text) to authenticated;
