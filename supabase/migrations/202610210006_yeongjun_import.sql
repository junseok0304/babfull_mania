create or replace function public.import_yeongjun_meals(
  import_log_id bigint,
  target_source_url text,
  meal_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  target_meal_id bigint;
  target_food_id bigint;
  old_data jsonb;
  old_items jsonb;
  new_items jsonb;
  menu_name text;
  item_order integer;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_protected_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception '서버 수집기만 식단을 가져올 수 있습니다.' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtext('babfull_yeongjun_import')) then
    raise exception '다른 식단 최신화 작업이 진행 중입니다.' using errcode = '55P03';
  end if;
  if jsonb_typeof(meal_payload) <> 'array' or jsonb_array_length(meal_payload) <> 10 then
    raise exception '평일 조식·중식 10개 레코드가 필요합니다.' using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements(meal_payload) loop
    new_items := coalesce(entry -> 'items', '[]'::jsonb);
    if jsonb_typeof(new_items) <> 'array' then
      raise exception '메뉴 목록 형식이 올바르지 않습니다.' using errcode = '22023';
    end if;

    select m.id, to_jsonb(m.*),
      coalesce((select jsonb_agg(mi.original_menu_text order by mi.display_order) from public.meal_items mi where mi.meal_id = m.id), '[]'::jsonb)
    into target_meal_id, old_data, old_items
    from public.meals m
    where m.meal_date = (entry ->> 'date')::date and m.meal_type = (entry ->> 'type')::public.meal_type
    for update;

    if target_meal_id is not null and (old_data ->> 'is_manual_override')::boolean then
      v_protected_count := v_protected_count + 1;
      target_meal_id := null;
      continue;
    end if;

    if target_meal_id is null then
      insert into public.meals (meal_date, meal_type, source_type, source_url, is_operating, is_published, admin_note)
      values ((entry ->> 'date')::date, (entry ->> 'type')::public.meal_type, 'yeongjun', target_source_url,
        coalesce((entry ->> 'operating')::boolean, false), true, nullif(entry ->> 'note', ''))
      returning id into target_meal_id;
      v_inserted_count := v_inserted_count + 1;
    elsif old_items = new_items
      and (old_data ->> 'is_operating')::boolean = coalesce((entry ->> 'operating')::boolean, false)
      and coalesce(old_data ->> 'admin_note', '') = coalesce(entry ->> 'note', '') then
      v_unchanged_count := v_unchanged_count + 1;
      target_meal_id := null;
      continue;
    else
      update public.meals set source_type = 'yeongjun', source_url = target_source_url,
        is_operating = coalesce((entry ->> 'operating')::boolean, false), is_published = true,
        admin_note = nullif(entry ->> 'note', ''), updated_at = now()
      where id = target_meal_id;
      delete from public.meal_items where meal_id = target_meal_id;
      v_updated_count := v_updated_count + 1;
    end if;

    item_order := 0;
    for menu_name in select value #>> '{}' from jsonb_array_elements(new_items) loop
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

    insert into public.meal_change_logs (meal_id, previous_data, new_data, change_source)
    values (target_meal_id, old_data, entry, 'yeongjun-import');
    target_meal_id := null;
  end loop;

  update public.meal_import_logs set status = 'success', completed_at = now(),
    inserted_count = v_inserted_count, updated_count = v_updated_count, error_message = null
  where id = import_log_id;

  return jsonb_build_object('insertedCount', v_inserted_count, 'updatedCount', v_updated_count,
    'unchangedCount', v_unchanged_count, 'protectedCount', v_protected_count);
end;
$$;

revoke all on function public.import_yeongjun_meals(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_yeongjun_meals(bigint, text, jsonb) to service_role;
