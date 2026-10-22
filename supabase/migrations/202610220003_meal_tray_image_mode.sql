create table if not exists public.meal_tray_images (
  id bigint generated always as identity primary key,
  meal_id bigint not null unique references public.meals(id) on delete cascade,
  storage_path text not null,
  image_url text not null,
  alt_text text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meal_tray_images enable row level security;

drop policy if exists "published meal tray images are public" on public.meal_tray_images;
create policy "published meal tray images are public" on public.meal_tray_images for select
  using (exists (
    select 1 from public.meals
    where meals.id = meal_tray_images.meal_id
      and (meals.is_published or public.is_admin())
  ));

drop policy if exists "admins manage meal tray images" on public.meal_tray_images;
create policy "admins manage meal tray images" on public.meal_tray_images for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.meal_tray_images to anon, authenticated;
grant insert, update, delete on public.meal_tray_images to authenticated;
grant usage, select on sequence public.meal_tray_images_id_seq to authenticated;

insert into public.app_settings (setting_key, setting_value, is_public)
values ('tray_display_mode', '{"mode":"search"}'::jsonb, true)
on conflict (setting_key) do nothing;

create or replace function public.admin_update_tray_display_mode(target_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 식판 이미지 제공 방식을 변경할 수 있습니다.' using errcode = '42501';
  end if;
  if target_mode not in ('search', 'ai') then
    raise exception '지원하지 않는 식판 이미지 제공 방식입니다.' using errcode = '22023';
  end if;

  insert into public.app_settings (setting_key, setting_value, is_public, updated_at)
  values ('tray_display_mode', jsonb_build_object('mode', target_mode), true, now())
  on conflict (setting_key) do update
    set setting_value = excluded.setting_value,
        is_public = true,
        updated_at = now();
end;
$$;

revoke all on function public.admin_update_tray_display_mode(text) from public, anon;
grant execute on function public.admin_update_tray_display_mode(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-tray-images',
  'meal-tray-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public reads meal tray images" on storage.objects;
create policy "public reads meal tray images" on storage.objects for select
  using (bucket_id = 'meal-tray-images');

drop policy if exists "admins upload meal tray images" on storage.objects;
create policy "admins upload meal tray images" on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-tray-images' and public.is_admin());

drop policy if exists "admins replace meal tray images" on storage.objects;
create policy "admins replace meal tray images" on storage.objects for update to authenticated
  using (bucket_id = 'meal-tray-images' and public.is_admin())
  with check (bucket_id = 'meal-tray-images' and public.is_admin());

drop policy if exists "admins delete meal tray images" on storage.objects;
create policy "admins delete meal tray images" on storage.objects for delete to authenticated
  using (bucket_id = 'meal-tray-images' and public.is_admin());
