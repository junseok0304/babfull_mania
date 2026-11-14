-- 과거 BOT 자료에서 음식으로 잘못 적재된 칠석 안내를 제거한다.
-- 자동 수집되는 새 식단은 yeongjun-parser.js에서 24절기·칠석 안내를 제외한다.
delete from public.meal_items
where meal_id in (
  select id
  from public.meals
  where meal_date = date '2026-08-19'
    and meal_type = 'lunch'::public.meal_type
)
and regexp_replace(original_menu_text, '[[:space:]()\[\]{}·:：-]', '', 'g') in ('七夕칠석', '칠석七夕', '七夕', '칠석');

-- 삭제 후 표시 순서를 0부터 다시 맞춰 관리자·사용자 화면의 정렬을 유지한다.
with ordered_items as (
  select
    item.id,
    row_number() over (partition by item.meal_id order by item.display_order, item.id) - 1 as next_order
  from public.meal_items item
  join public.meals meal on meal.id = item.meal_id
  where meal.meal_date = date '2026-08-19'
    and meal.meal_type = 'lunch'::public.meal_type
)
update public.meal_items item
set display_order = ordered_items.next_order
from ordered_items
where item.id = ordered_items.id;
