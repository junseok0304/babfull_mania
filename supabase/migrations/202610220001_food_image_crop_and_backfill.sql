alter table public.food_images
  add column if not exists crop_zoom numeric(4, 2) not null default 1.08
    check (crop_zoom between 1 and 2.5),
  add column if not exists focal_x smallint not null default 50
    check (focal_x between 0 and 100),
  add column if not exists focal_y smallint not null default 50
    check (focal_y between 0 and 100);

insert into public.foods (original_name, normalized_name)
select distinct trim(item.original_menu_text), public.normalize_food_name(item.original_menu_text)
from public.meal_items item
where item.food_id is null
  and trim(item.original_menu_text) <> ''
on conflict (normalized_name) do nothing;

update public.meal_items item
set food_id = food.id
from public.foods food
where item.food_id is null
  and food.normalized_name = public.normalize_food_name(item.original_menu_text);
