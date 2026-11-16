-- 카카오가 과거에 제공한 HTTP 프로필 이미지 주소를 HTTPS로 정규화합니다.
update public.profiles
set profile_image_url = regexp_replace(profile_image_url, '^http://', 'https://', 'i'),
    updated_at = now()
where profile_image_url ~* '^http://';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, auth_provider, provider_user_id, profile_image_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'),
    coalesce(new.raw_app_meta_data ->> 'provider', 'kakao'),
    new.raw_user_meta_data ->> 'provider_id',
    regexp_replace(new.raw_user_meta_data ->> 'avatar_url', '^http://', 'https://', 'i')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
