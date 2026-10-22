insert into public.meal_tray_images (meal_id, storage_path, image_url, alt_text)
select
  id,
  '2026-10-19/lunch-generated-v1.png',
  'https://uupatosmuueifsssdkev.supabase.co/storage/v1/object/public/meal-tray-images/2026-10-19/lunch-generated-v1.png',
  '2026-10-19 중식: 백미밥, 콩나물국, 돈육감자조림, 들깨무나물볶음, 오이양파무침, 깍두기'
from public.meals
where meal_date = date '2026-10-19' and meal_type = 'lunch'
on conflict (meal_id) do update set
  storage_path = excluded.storage_path,
  image_url = excluded.image_url,
  alt_text = excluded.alt_text,
  updated_at = now();
