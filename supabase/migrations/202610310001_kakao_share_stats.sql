create table if not exists public.kakao_share_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  meal_date date not null,
  meal_type public.meal_type not null,
  created_at timestamptz not null default now()
);

create index if not exists kakao_share_events_user_created_idx
  on public.kakao_share_events (user_id, created_at desc);

create index if not exists kakao_share_events_created_idx
  on public.kakao_share_events (created_at desc);

alter table public.kakao_share_events enable row level security;

drop policy if exists "admins read kakao share events" on public.kakao_share_events;
create policy "admins read kakao share events"
  on public.kakao_share_events for select
  using (public.is_admin());

create or replace function public.record_kakao_share(
  target_meal_date date,
  target_meal_type public.meal_type
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  created_id bigint;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  ) then
    raise exception '활성 사용자만 공유 기록을 저장할 수 있습니다.';
  end if;

  insert into public.kakao_share_events (user_id, meal_date, meal_type)
  values (auth.uid(), target_meal_date, target_meal_type)
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.admin_kakao_share_stats(
  target_month date default current_date
)
returns table (
  user_id uuid,
  user_name text,
  affiliation text,
  share_count bigint,
  last_shared_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month_start timestamptz := date_trunc('month', coalesce(target_month, current_date)::timestamp) at time zone 'Asia/Seoul';
  month_end timestamptz := (date_trunc('month', coalesce(target_month, current_date)::timestamp) + interval '1 month') at time zone 'Asia/Seoul';
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(trim(p.name), ''), '이름 미등록'),
    coalesce(nullif(trim(p.affiliation), ''), '소속 미등록'),
    count(e.id)::bigint,
    max(e.created_at)
  from public.kakao_share_events e
  join public.profiles p on p.id = e.user_id
  where e.created_at >= month_start and e.created_at < month_end
  group by p.id, p.name, p.affiliation
  order by count(e.id) desc, max(e.created_at) desc;
end;
$$;

revoke all on table public.kakao_share_events from public, anon, authenticated;
grant select on table public.kakao_share_events to authenticated;
revoke all on function public.record_kakao_share(date, public.meal_type) from public, anon;
grant execute on function public.record_kakao_share(date, public.meal_type) to authenticated;
revoke all on function public.admin_kakao_share_stats(date) from public, anon;
grant execute on function public.admin_kakao_share_stats(date) to authenticated;
