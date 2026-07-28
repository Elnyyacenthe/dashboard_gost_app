-- ============================================================
--  PlugBet Affiliation — RPC Statistiques (Phase 1)
-- ============================================================
--  Alimente le dashboard affilié (courbes) et la page Statistiques
--  (répartitions pays/appareils/OS, CTR, conversion). Idempotent.
--  Portée : l'affilié courant (auth.uid()). SECURITY DEFINER + garde.
-- ============================================================

-- Séries temporelles multi-granularité (jour/semaine/mois/année).
create or replace function public.affiliate_stats_timeseries(
  p_granularity text default 'day',
  p_points int default 30
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_aff_id uuid;
  v_unit text;
  v_step interval;
  v_points int;
  v_start timestamptz;
  v_fmt text;
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select id into v_aff_id from public.affiliates where user_id = auth.uid();
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;

  v_unit := case p_granularity when 'week' then 'week' when 'month' then 'month' when 'year' then 'year' else 'day' end;
  v_step := case v_unit when 'week' then interval '1 week' when 'month' then interval '1 month' when 'year' then interval '1 year' else interval '1 day' end;
  v_fmt  := case v_unit when 'month' then 'MM/YYYY' when 'year' then 'YYYY' else 'DD/MM' end;
  v_points := greatest(1, least(coalesce(p_points, 30), 366));
  v_start := date_trunc(v_unit, now()) - (v_points - 1) * v_step;

  return (
    with buckets as (
      select generate_series(v_start, date_trunc(v_unit, now()), v_step) as b
    ),
    su as (
      select date_trunc(v_unit, registered_at) d, count(*) c
      from public.affiliate_referrals
      where affiliate_id = v_aff_id and registered_at >= v_start group by 1
    ),
    fd as (
      select date_trunc(v_unit, first_deposit_at) d, count(*) c
      from public.affiliate_referrals
      where affiliate_id = v_aff_id and qualified and first_deposit_at >= v_start group by 1
    ),
    cm as (
      select date_trunc(v_unit, created_at) d, sum(amount) c
      from public.affiliate_commissions
      where affiliate_id = v_aff_id and status <> 'reversed' and created_at >= v_start group by 1
    ),
    ck as (
      select date_trunc(v_unit, created_at) d, count(*) c
      from public.affiliate_link_clicks
      where affiliate_id = v_aff_id and created_at >= v_start group by 1
    )
    select jsonb_build_object(
      'success', true,
      'granularity', v_unit,
      'labels',         coalesce(jsonb_agg(to_char(b.b, v_fmt) order by b.b), '[]'::jsonb),
      'signups',        coalesce(jsonb_agg(coalesce(su.c, 0) order by b.b), '[]'::jsonb),
      'first_deposits', coalesce(jsonb_agg(coalesce(fd.c, 0) order by b.b), '[]'::jsonb),
      'commissions',    coalesce(jsonb_agg(coalesce(cm.c, 0) order by b.b), '[]'::jsonb),
      'clicks',         coalesce(jsonb_agg(coalesce(ck.c, 0) order by b.b), '[]'::jsonb)
    )
    from buckets b
    left join su on su.d = b.b
    left join fd on fd.d = b.b
    left join cm on cm.d = b.b
    left join ck on ck.d = b.b
  );
end; $$;
revoke execute on function public.affiliate_stats_timeseries(text, int) from public;
grant execute on function public.affiliate_stats_timeseries(text, int) to authenticated;

-- Agrégats + répartitions (pays / appareils / OS) + CTR + conversion.
create or replace function public.affiliate_stats_overview(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_aff_id uuid;
  v_since timestamptz;
  v_clicks int; v_signups int; v_fdeps int;
  v_commissions bigint; v_revenue bigint;
begin
  if auth.uid() is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select id into v_aff_id from public.affiliates where user_id = auth.uid();
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  v_since := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));

  select count(*) into v_clicks from public.affiliate_link_clicks
    where affiliate_id = v_aff_id and created_at >= v_since;
  select count(*) into v_signups from public.affiliate_referrals
    where affiliate_id = v_aff_id and registered_at >= v_since;
  select count(*) into v_fdeps from public.affiliate_referrals
    where affiliate_id = v_aff_id and qualified and first_deposit_at >= v_since;
  select coalesce(sum(amount), 0) into v_commissions from public.affiliate_commissions
    where affiliate_id = v_aff_id and status <> 'reversed' and created_at >= v_since;
  select coalesce(sum(amount), 0) into v_revenue from public.affiliate_commissions
    where affiliate_id = v_aff_id and type = 'revenue_share' and status <> 'reversed' and created_at >= v_since;

  return jsonb_build_object(
    'success', true,
    'days', greatest(coalesce(p_days, 30), 1),
    'clicks', v_clicks,
    'signups', v_signups,
    'first_deposits', v_fdeps,
    'commissions', v_commissions,
    'revenue', v_revenue,
    'ctr', case when v_clicks > 0 then round(v_signups::numeric / v_clicks, 4) else 0 end,
    'conversion', case when v_signups > 0 then round(v_fdeps::numeric / v_signups, 4) else 0 end,
    'by_country', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(country, ''), 'Inconnu') as label, count(*) as value
        from public.affiliate_referrals where affiliate_id = v_aff_id and registered_at >= v_since
        group by 1 order by value desc limit 8) x), '[]'::jsonb),
    'by_device', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(device, ''), 'Inconnu') as label, count(*) as value
        from public.affiliate_referrals where affiliate_id = v_aff_id and registered_at >= v_since
        group by 1 order by value desc limit 6) x), '[]'::jsonb),
    'by_os', coalesce((select jsonb_agg(x) from (
        select coalesce(nullif(os, ''), 'Inconnu') as label, count(*) as value
        from public.affiliate_referrals where affiliate_id = v_aff_id and registered_at >= v_since
        group by 1 order by value desc limit 6) x), '[]'::jsonb)
  );
end; $$;
revoke execute on function public.affiliate_stats_overview(int) from public;
grant execute on function public.affiliate_stats_overview(int) to authenticated;
