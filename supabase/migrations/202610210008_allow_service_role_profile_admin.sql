create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    new.id := old.id;
    new.role := old.role;
    new.qr_token := old.qr_token;
    new.is_active := old.is_active;
    new.auth_provider := old.auth_provider;
    new.provider_user_id := old.provider_user_id;
    new.user_type := old.user_type;
  end if;
  return new;
end;
$$;

comment on function public.protect_profile_fields() is
  '사용자 본인의 보호 필드 수정을 차단하되 관리자와 service_role 운영 작업은 허용한다.';
