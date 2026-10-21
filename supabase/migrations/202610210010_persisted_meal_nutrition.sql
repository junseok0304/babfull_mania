alter table public.meal_items
  add column if not exists estimated_calories numeric check (estimated_calories >= 0),
  add column if not exists nutrition_matched_name text,
  add column if not exists nutrition_source text,
  add column if not exists nutrition_updated_at timestamptz;

create index if not exists meal_items_missing_nutrition_idx
  on public.meal_items (meal_id)
  where estimated_calories is null;

comment on column public.meal_items.estimated_calories is
  '기본 배식량과 식약처 식품영양성분 DB를 기준으로 계산한 메뉴별 예상 열량(kcal).';
comment on column public.meal_items.nutrition_matched_name is
  '열량 계산에 사용한 식품영양성분 DB의 식품명.';
comment on column public.meal_items.nutrition_source is
  '열량 원천. mfds-data-go-kr 또는 mfds-foodsafetykorea.';
comment on column public.meal_items.nutrition_updated_at is
  '열량 정보를 마지막으로 조회·저장한 시각.';
