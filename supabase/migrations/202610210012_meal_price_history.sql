create table if not exists public.meal_price_history (
  id bigint generated always as identity primary key,
  breakfast_price integer not null check (breakfast_price >= 0),
  lunch_price integer not null check (lunch_price >= 0),
  effective_from timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null
);

create index if not exists meal_price_history_effective_from_idx
  on public.meal_price_history (effective_from desc);

insert into public.meal_price_history (breakfast_price, lunch_price, effective_from)
select 1000, 5300, '-infinity'::timestamptz
where not exists (select 1 from public.meal_price_history);

alter table public.meal_price_history enable row level security;
create policy "admins read meal price history" on public.meal_price_history for select
  using (public.is_admin());
grant select on public.meal_price_history to authenticated;

create or replace function public.meal_price_at(
  target_meal_type public.meal_type,
  target_time timestamptz default now()
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case target_meal_type
    when 'breakfast' then h.breakfast_price
    when 'lunch' then h.lunch_price
  end
  from public.meal_price_history h
  where h.effective_from <= target_time
  order by h.effective_from desc
  limit 1;
$$;

create or replace function public.admin_update_pricing_settings(
  breakfast_price integer,
  lunch_price integer
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
    raise exception '관리자만 식권 가격을 수정할 수 있습니다.' using errcode = '42501';
  end if;
  if breakfast_price < 0 or breakfast_price > 100000 or lunch_price < 0 or lunch_price > 100000 then
    raise exception '식권 가격은 0원 이상 100,000원 이하여야 합니다.' using errcode = '22023';
  end if;

  next_value := jsonb_build_object('breakfast', breakfast_price, 'lunch', lunch_price);
  insert into public.meal_price_history (breakfast_price, lunch_price, changed_by)
  values (breakfast_price, lunch_price, auth.uid());
  insert into public.app_settings (setting_key, setting_value, is_public)
  values ('meal_prices', next_value, true)
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value, is_public = true, updated_at = now();
  return next_value;
end;
$$;

create or replace function public.process_meal_usage(
  target_qr_token uuid,
  target_meal_type public.meal_type,
  target_meal_date date default (timezone('Asia/Seoul', now()))::date
)
returns public.meal_usages
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user public.profiles;
  created_usage public.meal_usages;
begin
  if not public.is_admin() then
    raise exception '관리자만 식권을 처리할 수 있습니다.' using errcode = '42501';
  end if;
  select * into target_user from public.profiles
  where qr_token = target_qr_token and is_active = true for update;
  if target_user.id is null then
    raise exception '유효한 사용자를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  insert into public.meal_usages (user_id, meal_date, meal_type, price, processed_by)
  values (target_user.id, target_meal_date, target_meal_type, public.meal_price_at(target_meal_type, now()), auth.uid())
  returning * into created_usage;
  return created_usage;
exception when unique_violation then
  raise exception '이미 사용 처리된 식권입니다.' using errcode = '23505';
end;
$$;

create or replace function public.admin_update_meal_usage(
  target_usage_id bigint,
  target_meal_date date,
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
  if target_meal_date is null then
    raise exception '이용 날짜를 입력해 주세요.' using errcode = '22023';
  end if;
  if target_status = 'corrected' then
    raise exception '수정 완료 상태는 직접 선택할 수 없습니다.' using errcode = '22023';
  end if;
  update public.meal_usages
  set meal_date = target_meal_date,
      meal_type = target_meal_type,
      price = public.meal_price_at(target_meal_type, meal_usages.created_at),
      status = target_status,
      correction_note = nullif(trim(note), '')
  where id = target_usage_id
  returning * into updated_usage;
  if updated_usage.id is null then
    raise exception '이용 기록을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  return updated_usage;
exception when unique_violation then
  raise exception '해당 사용자의 같은 날짜·식사 이용 기록이 이미 있습니다.' using errcode = '23505';
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
  if local_time between breakfast_start - scan_buffer and breakfast_end + scan_buffer then selected_type := 'breakfast';
  elsif local_time between lunch_start - scan_buffer and lunch_end + scan_buffer then selected_type := 'lunch';
  elsif local_time < lunch_start - scan_buffer then selected_type := 'breakfast';
  else selected_type := 'lunch';
  end if;
  select * into target_user from public.profiles
  where qr_token = target_qr_token and is_active = true for update;
  if target_user.id is null then
    raise exception '유효한 사용자를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  insert into public.meal_usages (user_id, meal_date, meal_type, price, processed_by)
  values (target_user.id, local_date, selected_type, public.meal_price_at(selected_type, target_scanned_at), auth.uid())
  returning * into created_usage;
  return created_usage;
exception when unique_violation then
  raise exception '이미 사용 처리된 식권입니다.' using errcode = '23505';
end;
$$;

revoke all on function public.admin_update_pricing_settings(integer, integer) from public, anon;
grant execute on function public.admin_update_pricing_settings(integer, integer) to authenticated;
grant execute on function public.meal_price_at(public.meal_type, timestamptz) to authenticated;

comment on table public.meal_price_history is
  '가격 변경 전 이용 금액을 보존하면서 변경 이후 새 이용 기록에 적용할 식권 가격 이력.';
