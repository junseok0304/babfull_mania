create extension if not exists pgcrypto;

create type public.meal_type as enum ('breakfast', 'lunch');
create type public.user_role as enum ('user', 'admin');
create type public.usage_status as enum ('active', 'cancelled', 'corrected');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.payment_status as enum ('unbilled', 'billed', 'unpaid', 'paid');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  auth_provider text not null default 'kakao',
  provider_user_id text,
  profile_image_url text,
  affiliation text,
  user_type text not null default 'student',
  role public.user_role not null default 'user',
  qr_token uuid not null default gen_random_uuid() unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.foods (
  id bigint generated always as identity primary key,
  original_name text not null,
  normalized_name text not null,
  category text check (category in ('rice', 'soup', 'main', 'side', 'sauce', 'kimchi')),
  created_at timestamptz not null default now(),
  unique (normalized_name)
);

create table public.food_aliases (
  id bigint generated always as identity primary key,
  food_id bigint not null references public.foods(id) on delete cascade,
  alias_name text not null unique
);

create table public.meals (
  id bigint generated always as identity primary key,
  meal_date date not null,
  meal_type public.meal_type not null,
  source_type text not null default 'manual' check (source_type in ('manual', 'yeongjun', 'sample')),
  source_url text,
  is_manual_override boolean not null default false,
  is_operating boolean not null default true,
  is_published boolean not null default false,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meal_date, meal_type)
);

create table public.meal_items (
  id bigint generated always as identity primary key,
  meal_id bigint not null references public.meals(id) on delete cascade,
  food_id bigint references public.foods(id) on delete set null,
  original_menu_text text not null,
  display_order integer not null default 0,
  unique (meal_id, display_order)
);

create table public.food_images (
  id bigint generated always as identity primary key,
  food_id bigint not null references public.foods(id) on delete cascade,
  storage_path text not null,
  source_url text,
  source_document_url text,
  source_name text,
  license_note text,
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.meal_usages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  meal_date date not null,
  meal_type public.meal_type not null,
  price integer not null check (price >= 0),
  status public.usage_status not null default 'active',
  processed_by uuid not null references public.profiles(id) on delete restrict,
  correction_note text,
  created_at timestamptz not null default now()
);

create unique index meal_usages_one_active_use
  on public.meal_usages (user_id, meal_date, meal_type)
  where status = 'active';

create table public.billings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  breakfast_count integer not null default 0 check (breakfast_count >= 0),
  lunch_count integer not null default 0 check (lunch_count >= 0),
  total_amount integer not null default 0 check (total_amount >= 0),
  payment_status public.payment_status not null default 'unbilled',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, billing_month)
);

create table public.meal_import_logs (
  id bigint generated always as identity primary key,
  source_url text not null,
  trigger_type text not null check (trigger_type in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  error_message text
);

create table public.meal_change_logs (
  id bigint generated always as identity primary key,
  meal_id bigint references public.meals(id) on delete set null,
  previous_data jsonb,
  new_data jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  change_source text not null,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  setting_key text primary key,
  setting_value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (setting_key, setting_value, is_public) values
  ('meal_hours', '{"breakfast_start":"08:00","breakfast_end":"09:30","lunch_start":"11:30","lunch_end":"14:00","confirmed":false}'::jsonb, true),
  ('meal_prices', '{"breakfast":1000,"lunch":5300}'::jsonb, true),
  ('import_schedule', '{"cron":"0 21 * * 0","timezone":"Asia/Seoul"}'::jsonb, false);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

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
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger meals_updated_at before update on public.meals
  for each row execute function public.set_updated_at();
create trigger billings_updated_at before update on public.billings
  for each row execute function public.set_updated_at();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
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

create trigger protect_profile_fields_before_update
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.process_meal_usage(
  target_qr_token uuid,
  target_meal_type public.meal_type,
  target_meal_date date default (timezone('Asia/Seoul', now()))::date
)
returns public.meal_usages
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user public.profiles;
  created_usage public.meal_usages;
  fixed_price integer;
begin
  if not public.is_admin() then
    raise exception '관리자만 식권을 처리할 수 있습니다.' using errcode = '42501';
  end if;

  select * into target_user from public.profiles
  where qr_token = target_qr_token and is_active = true
  for update;

  if target_user.id is null then
    raise exception '유효한 사용자를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  fixed_price := case target_meal_type when 'breakfast' then 1000 when 'lunch' then 5300 end;

  insert into public.meal_usages (user_id, meal_date, meal_type, price, processed_by)
  values (target_user.id, target_meal_date, target_meal_type, fixed_price, auth.uid())
  returning * into created_usage;

  return created_usage;
exception
  when unique_violation then
    raise exception '이미 사용 처리된 식권입니다.' using errcode = '23505';
end;
$$;

alter table public.profiles enable row level security;
alter table public.foods enable row level security;
alter table public.food_aliases enable row level security;
alter table public.meals enable row level security;
alter table public.meal_items enable row level security;
alter table public.food_images enable row level security;
alter table public.meal_usages enable row level security;
alter table public.billings enable row level security;
alter table public.meal_import_logs enable row level security;
alter table public.meal_change_logs enable row level security;
alter table public.app_settings enable row level security;

create policy "published meals are public" on public.meals for select
  using (is_published = true or public.is_admin());
create policy "meal items follow published meals" on public.meal_items for select
  using (exists (select 1 from public.meals where meals.id = meal_items.meal_id and (meals.is_published or public.is_admin())));
create policy "foods used by menus are public" on public.foods for select using (true);
create policy "food aliases are readable" on public.food_aliases for select using (true);
create policy "approved images are public" on public.food_images for select
  using (review_status = 'approved' or public.is_admin());
create policy "public settings are readable" on public.app_settings for select
  using (is_public = true or public.is_admin());

create policy "users read own profile" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "users update own profile" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
create policy "users read own usages" on public.meal_usages for select
  using (user_id = auth.uid() or public.is_admin());
create policy "users read own billings" on public.billings for select
  using (user_id = auth.uid() or public.is_admin());

create policy "admins manage meals" on public.meals for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage meal items" on public.meal_items for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage foods" on public.foods for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage aliases" on public.food_aliases for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage images" on public.food_images for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage usages" on public.meal_usages for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage billings" on public.billings for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read import logs" on public.meal_import_logs for select using (public.is_admin());
create policy "admins read change logs" on public.meal_change_logs for select using (public.is_admin());
create policy "admins manage settings" on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.meals, public.meal_items, public.foods, public.food_aliases, public.food_images, public.app_settings to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.meal_usages to authenticated;
grant select on public.billings to authenticated;
grant all on public.meals, public.meal_items, public.foods, public.food_aliases, public.food_images, public.billings to authenticated;
grant select on public.meal_import_logs, public.meal_change_logs to authenticated;
grant execute on function public.process_meal_usage(uuid, public.meal_type, date) to authenticated;
grant usage, select on all sequences in schema public to authenticated;
