-- ============================================================
--  PlugBet Affiliation — Notifications, Badges, Classement (Phase 6)
-- ============================================================
--  Idempotent, additif.
-- ============================================================

-- Realtime sur les notifications affiliés.
do $$
begin
  begin
    alter publication supabase_realtime add table public.affiliate_notifications;
  exception when duplicate_object then null; when others then null;
  end;
end $$;

-- ── Notifications : tout marquer lu ──
create or replace function public.affiliate_mark_all_notifications_read()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_aff_id uuid;
begin
  select id into v_aff_id from public.affiliates where user_id = auth.uid();
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  update public.affiliate_notifications set read_at = now() where affiliate_id = v_aff_id and read_at is null;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_mark_all_notifications_read() from public;
grant execute on function public.affiliate_mark_all_notifications_read() to authenticated;

-- ── Paramètres : méthode/compte de paiement préféré ──
create or replace function public.affiliate_update_payout(
  p_method text, p_holder text, p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_aff_id uuid;
begin
  select id into v_aff_id from public.affiliates where user_id = auth.uid();
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  if p_method is not null and p_method not in ('orange_money','mtn_money','wave','crypto') then
    return jsonb_build_object('success', false, 'error', 'INVALID_METHOD'); end if;
  update public.affiliates
    set preferred_method = p_method,
        payout_holder = nullif(trim(p_holder), ''),
        payout_number = nullif(trim(p_number), '')
    where id = v_aff_id;
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_update_payout(text, text, text) from public;
grant execute on function public.affiliate_update_payout(text, text, text) to authenticated;

-- ── Palier (badge) déduit des seuils config ──
create or replace function public._affiliate_compute_tier(p_revenue bigint, p_players int)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select t.tier from (
      select key as tier, (value->>'revenue')::bigint as rev, (value->>'players')::int as pl
      from public.affiliate_config, jsonb_each(tier_thresholds) where id = 1
    ) t
    where p_revenue >= t.rev and p_players >= t.pl
    order by t.rev desc, t.pl desc
    limit 1
  ), 'bronze');
$$;
revoke execute on function public._affiliate_compute_tier(bigint, int) from public;

-- ── Mise à jour des paliers (appelée par le cron) ──
create or replace function public.affiliate_update_tiers()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with upd as (
    update public.affiliates a set tier = public._affiliate_compute_tier(
      coalesce((select sum(amount) from public.affiliate_commissions c where c.affiliate_id = a.id and c.status <> 'reversed'), 0)::bigint,
      coalesce((select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id and r.qualified), 0)::int)
    where a.status = 'active'
    returning 1)
  select count(*) into v_n from upd;
  return coalesce(v_n, 0);
end; $$;
revoke execute on function public.affiliate_update_tiers() from public;

-- Orchestrateur enrichi (réconciliation + CPA + rev + maturation + paliers).
create or replace function public.affiliate_run_accruals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rec int; v_cpa int; v_mat int; v_rev int; v_tiers int;
begin
  v_rec := public.affiliate_reconcile_activity();
  v_cpa := public.affiliate_accrue_cpa();
  v_rev := public.affiliate_accrue_revenue_share();
  v_mat := public.affiliate_mature_commissions();
  v_tiers := public.affiliate_update_tiers();
  return jsonb_build_object('reconciled', v_rec, 'cpa', v_cpa, 'revenue_share', v_rev,
    'matured', v_mat, 'tiers', v_tiers, 'at', now());
end; $$;
revoke execute on function public.affiliate_run_accruals() from public;

-- ── Progression de badge de l'affilié courant ──
create or replace function public.affiliate_badge_progress()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_aff_id uuid; v_rev bigint; v_players int; v_tier text;
  v_order text[] := array['bronze','silver','gold','diamond','vip'];
  v_idx int; v_next text; v_thr jsonb; v_next_rev bigint; v_next_pl int;
begin
  select id into v_aff_id from public.affiliates where user_id = auth.uid();
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  select coalesce(sum(amount), 0) into v_rev from public.affiliate_commissions where affiliate_id = v_aff_id and status <> 'reversed';
  select count(*) into v_players from public.affiliate_referrals where affiliate_id = v_aff_id and qualified;
  v_tier := public._affiliate_compute_tier(v_rev, v_players);
  select tier_thresholds into v_thr from public.affiliate_config where id = 1;
  v_idx := array_position(v_order, v_tier);
  v_next := case when v_idx < 5 then v_order[v_idx + 1] else null end;
  if v_next is not null then
    v_next_rev := (v_thr->v_next->>'revenue')::bigint;
    v_next_pl := (v_thr->v_next->>'players')::int;
  end if;
  return jsonb_build_object('success', true,
    'tier', v_tier, 'revenue', v_rev, 'players', v_players,
    'next_tier', v_next,
    'next_revenue', v_next_rev, 'next_players', v_next_pl,
    'progress_revenue', case when v_next_rev is null or v_next_rev = 0 then 1 else least(1.0, round(v_rev::numeric / v_next_rev, 4)) end,
    'progress_players', case when v_next_pl is null or v_next_pl = 0 then 1 else least(1.0, round(v_players::numeric / v_next_pl, 4)) end);
end; $$;
revoke execute on function public.affiliate_badge_progress() from public;
grant execute on function public.affiliate_badge_progress() to authenticated;

-- ── Classement des affiliés ──
create or replace function public.affiliate_leaderboard(p_type text default 'revenue', p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('rank', rn, 'username', username, 'tier', tier, 'value', val) order by rn)
    from (
      select username, tier, val, row_number() over (order by val desc, username) as rn
      from (
        select up.username, a.tier,
          case p_type
            when 'first_deposits' then coalesce((select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id and r.qualified), 0)::numeric
            when 'signups' then coalesce((select count(*) from public.affiliate_referrals r where r.affiliate_id = a.id), 0)::numeric
            when 'conversion' then (
              select case when count(*) > 0 then round(count(*) filter (where qualified)::numeric / count(*) * 100, 1) else 0 end
              from public.affiliate_referrals r where r.affiliate_id = a.id)
            else coalesce(b.total_earned, 0)::numeric
          end as val
        from public.affiliates a
        join public.user_profiles up on up.id = a.user_id
        left join public.affiliate_balances_view b on b.affiliate_id = a.id
        where a.status = 'active'
      ) s
      where val > 0
    ) ranked
    where rn <= greatest(1, least(p_limit, 100))
  ), '[]'::jsonb);
end; $$;
revoke execute on function public.affiliate_leaderboard(text, int) from public;
grant execute on function public.affiliate_leaderboard(text, int) to authenticated;
