create or replace function public.admin_upsert_meal(
  target_date date,
  target_type public.meal_type,
  menu_names text[],
  operating boolean default true,
  published boolean default true,
  note text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target_meal_id bigint;
  menu_name text;
  target_food_id bigint;
  item_order integer := 0;
  old_data jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 식단을 저장할 수 있습니다.' using errcode = '42501';
  end if;
  if target_date is null or target_type is null or (operating and coalesce(array_length(menu_names, 1), 0) = 0) then
    raise exception '제공 식단은 날짜, 식사 구분, 메뉴를 모두 입력해 주세요.' using errcode = '22023';
  end if;

  select to_jsonb(meals.*) into old_data from public.meals
  where meal_date = target_date and meal_type = target_type;

  insert into public.meals (meal_date, meal_type, source_type, is_manual_override, is_operating, is_published, admin_note)
  values (target_date, target_type, 'manual', true, operating, published, note)
  on conflict (meal_date, meal_type) do update set
    source_type = 'manual', is_manual_override = true, is_operating = excluded.is_operating,
    is_published = excluded.is_published, admin_note = excluded.admin_note, updated_at = now()
  returning id into target_meal_id;

  delete from public.meal_items where meal_id = target_meal_id;
  foreach menu_name in array coalesce(menu_names, array[]::text[]) loop
    menu_name := trim(menu_name);
    if menu_name = '' then continue; end if;
    insert into public.foods (original_name, normalized_name)
    values (menu_name, public.normalize_food_name(menu_name))
    on conflict (normalized_name) do nothing;
    select id into target_food_id from public.foods where normalized_name = public.normalize_food_name(menu_name);
    insert into public.meal_items (meal_id, food_id, original_menu_text, display_order)
    values (target_meal_id, target_food_id, menu_name, item_order);
    item_order := item_order + 1;
  end loop;

  insert into public.meal_change_logs (meal_id, previous_data, new_data, changed_by, change_source)
  values (target_meal_id, old_data, jsonb_build_object('meal_date', target_date, 'meal_type', target_type, 'menu_names', menu_names, 'is_operating', operating, 'is_published', published, 'admin_note', note), auth.uid(), 'manual');
  return target_meal_id;
end;
$$;

grant execute on function public.admin_upsert_meal(date, public.meal_type, text[], boolean, boolean, text) to authenticated;
