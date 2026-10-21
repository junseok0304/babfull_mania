alter table public.meal_items
  add column if not exists serving_grams numeric check (serving_grams > 0);

create table public.food_nutrition_cache (
  normalized_query text primary key,
  mfds_food_code text,
  matched_name text,
  serving_amount numeric,
  serving_unit text,
  calories_per_serving numeric,
  match_status text not null check (match_status in ('matched', 'no_match', 'error')),
  raw_data jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index food_nutrition_cache_fetched_at_idx
  on public.food_nutrition_cache (fetched_at);

create trigger food_nutrition_cache_updated_at
  before update on public.food_nutrition_cache
  for each row execute function public.set_updated_at();

alter table public.food_nutrition_cache enable row level security;

create policy "admins read nutrition cache" on public.food_nutrition_cache for select
  using (public.is_admin());

grant select on public.food_nutrition_cache to authenticated;

comment on column public.meal_items.serving_grams is
  '배식 기준량(g). 비어 있으면 식약처 영양성분함량기준량 1회분을 사용한다.';

comment on table public.food_nutrition_cache is
  '공공데이터포털 식약처 식품영양성분 DB 조회 결과 캐시. API 키와 원격 호출은 Edge Function에서만 처리한다.';
