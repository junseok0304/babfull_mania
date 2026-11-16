-- 음식이 아닌 천원의 아침밥 운영시간 안내를 메뉴에서 제거합니다.
-- 안내만 남은 식단은 사용자 화면에 빈 식판이 노출되지 않도록 미제공 처리합니다.
do $$
declare
  affected_meal_ids bigint[];
begin
  select coalesce(array_agg(distinct meal_id), '{}'::bigint[])
  into affected_meal_ids
  from public.meal_items
  where regexp_replace(original_menu_text, '[[:space:]]', '', 'g')
    ~ '^\[?천원의아침밥\]?.*운영시간';

  delete from public.meal_items
  where meal_id = any(affected_meal_ids)
    and regexp_replace(original_menu_text, '[[:space:]]', '', 'g')
      ~ '^\[?천원의아침밥\]?.*운영시간';

  update public.meals m
  set is_operating = false,
      admin_note = '미제공',
      updated_at = now()
  where m.id = any(affected_meal_ids)
    and not exists (select 1 from public.meal_items mi where mi.meal_id = m.id);
end;
$$;
