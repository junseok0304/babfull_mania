drop function if exists public.admin_update_meal_usage(bigint, public.meal_type, public.usage_status, text);

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

grant execute on function public.admin_update_meal_usage(bigint, date, public.meal_type, public.usage_status, text) to authenticated;
