create or replace function public.admin_dashboard_stats(target_month date default (timezone('Asia/Seoul', now()))::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  seoul_today date := (timezone('Asia/Seoul', now()))::date;
  month_start date := date_trunc('month', coalesce(target_month, (timezone('Asia/Seoul', now()))::date))::date;
  month_end date := (date_trunc('month', coalesce(target_month, (timezone('Asia/Seoul', now()))::date)) + interval '1 month')::date;
  affiliation_stats jsonb;
begin
  if not public.is_admin() then raise exception '관리자 권한이 필요합니다.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('affiliation', grouped.affiliation, 'count', grouped.user_count) order by grouped.user_count desc), '[]'::jsonb)
    into affiliation_stats
  from (
    select coalesce(nullif(trim(p.affiliation), ''), '소속 미등록') as affiliation,
           count(distinct u.user_id)::integer as user_count
    from public.meal_usages u
    left join public.profiles p on p.id = u.user_id
    where u.status = 'active' and u.meal_date >= month_start and u.meal_date < month_end
    group by 1
  ) grouped;

  return jsonb_build_object(
    'total_members', (select count(*)::integer from public.profiles),
    'today_usage_count', (select count(*)::integer from public.meal_usages where status = 'active' and meal_date = seoul_today),
    'month_usage_count', (select count(*)::integer from public.meal_usages where status = 'active' and meal_date >= month_start and meal_date < month_end),
    'month_revenue', (select coalesce(sum(price), 0)::bigint from public.meal_usages where status = 'active' and meal_date >= month_start and meal_date < month_end),
    'breakfast_count', (select count(*)::integer from public.meal_usages where status = 'active' and meal_type = 'breakfast' and meal_date >= month_start and meal_date < month_end),
    'lunch_count', (select count(*)::integer from public.meal_usages where status = 'active' and meal_type = 'lunch' and meal_date >= month_start and meal_date < month_end),
    'affiliations', affiliation_stats
  );
end;
$$;

revoke all on function public.admin_dashboard_stats(date) from public;
grant execute on function public.admin_dashboard_stats(date) to authenticated;
