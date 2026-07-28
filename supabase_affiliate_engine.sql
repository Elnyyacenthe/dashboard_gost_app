-- ============================================================
--  PlugBet Affiliation — Moteur de commissions (Phase 3)
-- ============================================================
--  ADDITIF & MONEY-SAFE : ne modifie AUCUN flux d'argent existant
--  (place_bet, dépôts, wallet). Un reconciler (cron) accumule les
--  commissions dans le grand livre affiliate_commissions, sans jamais
--  toucher au solde des joueurs ni à la trésorerie.
--
--  * CPA : montant fixe au 1er dépôt qualifié (déterministe, idempotent).
--  * Maturation : pending -> available après la rétention.
--  * Revenue-share (SPORTS) : % du NGR sports des filleuls
--        NGR = Σ mises - Σ gains payés (paris réels réglés).
--    DÉSACTIVÉ par défaut (affiliate_config.revenue_share_enabled = false)
--    tant que la définition du NGR n'est pas validée. Le NGR casino
--    (treasury_movements) sera ajouté après validation.
-- ============================================================

alter table public.affiliate_config
  add column if not exists revenue_share_enabled boolean not null default false;

-- ── CPA : 1er dépôt qualifié -> commission fixe (pending) ──
create or replace function public.affiliate_accrue_cpa()
returns int language plpgsql security definer set search_path = public as $$
declare v_cpa bigint; v_hold int; v_n int := 0; r record;
begin
  select cpa_amount, holding_days into v_cpa, v_hold from public.affiliate_config where id = 1;
  for r in
    select rf.id, rf.affiliate_id, rf.first_deposit_at
    from public.affiliate_referrals rf
    where rf.qualified and rf.first_deposit_at is not null
      and not exists (select 1 from public.affiliate_commissions c
                      where c.referral_id = rf.id and c.type = 'cpa')
  loop
    insert into public.affiliate_commissions(
      affiliate_id, referral_id, type, amount, status, available_at, note)
    values (r.affiliate_id, r.id, 'cpa', v_cpa, 'pending',
            r.first_deposit_at + make_interval(days => v_hold), 'CPA — 1er dépôt qualifié');
    perform public._affiliate_notify(r.affiliate_id, 'commission_cpa',
      'Commission de parrainage 🎉',
      'Un filleul a effectué son 1er dépôt : +' || v_cpa || ' FCFA (disponible après validation).',
      jsonb_build_object('referral_id', r.id, 'amount', v_cpa));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke execute on function public.affiliate_accrue_cpa() from public;

-- ── Maturation : pending -> available une fois la rétention écoulée ──
create or replace function public.affiliate_mature_commissions()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  with upd as (
    update public.affiliate_commissions
      set status = 'available'
      where status = 'pending' and available_at is not null and available_at <= now()
      returning 1)
  select count(*) into v_n from upd;
  return coalesce(v_n, 0);
end; $$;
revoke execute on function public.affiliate_mature_commissions() from public;

-- ── Revenue-share SPORTS pour la semaine complète précédente ──
--    Gated par affiliate_config.revenue_share_enabled.
create or replace function public.affiliate_accrue_revenue_share()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean; v_pct numeric; v_hold int;
  v_ws date; v_we date; v_n int := 0; a record; v_ngr bigint; v_comm bigint;
begin
  select revenue_share_enabled, revenue_share_percent, holding_days
    into v_enabled, v_pct, v_hold from public.affiliate_config where id = 1;
  if not v_enabled then return 0; end if;

  v_ws := (date_trunc('week', now())::date - 7);  -- lundi de la semaine passée
  v_we := v_ws + 7;                                -- lundi suivant (exclu)

  for a in select id from public.affiliates where status = 'active' loop
    -- NGR sports = Σ mises - Σ gains payés (paris réels réglés) des filleuls.
    select coalesce(sum(b.stake), 0) - coalesce(sum(coalesce(b.actual_payout, 0)), 0)
      into v_ngr
      from public.bets b
      join public.affiliate_referrals rf
        on rf.player_id = b.user_id and rf.affiliate_id = a.id
      where b.is_virtual = false
        and b.settled_at is not null
        and b.settled_at >= v_ws and b.settled_at < v_we;

    v_comm := floor(greatest(v_ngr, 0) * v_pct / 100.0)::bigint;
    if v_comm > 0 then
      insert into public.affiliate_commissions(
        affiliate_id, type, amount, status, period_start, period_end, available_at, note)
      values (a.id, 'revenue_share', v_comm, 'pending', v_ws, v_we - 1,
              (v_we + make_interval(days => v_hold)), 'Revenue-share sports (semaine)')
      on conflict (affiliate_id, period_start, period_end) where type = 'revenue_share' do nothing;
      if found then
        perform public._affiliate_notify(a.id, 'commission_revenue',
          'Commission hebdomadaire 💰',
          'Revenue-share de la semaine : +' || v_comm || ' FCFA.',
          jsonb_build_object('period_start', v_ws, 'amount', v_comm));
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end; $$;
revoke execute on function public.affiliate_accrue_revenue_share() from public;

-- ── Orchestrateur appelé par le cron ──
create or replace function public.affiliate_run_accruals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cpa int; v_mat int; v_rev int;
begin
  v_cpa := public.affiliate_accrue_cpa();
  v_rev := public.affiliate_accrue_revenue_share();
  v_mat := public.affiliate_mature_commissions();
  return jsonb_build_object('cpa', v_cpa, 'revenue_share', v_rev, 'matured', v_mat, 'at', now());
end; $$;
revoke execute on function public.affiliate_run_accruals() from public;

-- Déclencheur manuel (admin) depuis le dashboard.
create or replace function public.admin_run_affiliate_accruals()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  end if;
  return jsonb_build_object('success', true) || public.affiliate_run_accruals();
end; $$;
revoke execute on function public.admin_run_affiliate_accruals() from public;
grant execute on function public.admin_run_affiliate_accruals() to authenticated;

-- ── Ajustement manuel d'une commission (admin) ──
create or replace function public.admin_adjust_commission(
  p_affiliate_id uuid, p_delta bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_id uuid;
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  end if;
  if p_delta = 0 then return jsonb_build_object('success', false, 'error', 'ZERO_DELTA'); end if;
  if coalesce(trim(p_reason), '') = '' then return jsonb_build_object('success', false, 'error', 'REASON_REQUIRED'); end if;
  select user_id into v_user from public.affiliates where id = p_affiliate_id;
  if v_user is null then return jsonb_build_object('success', false, 'error', 'AFFILIATE_NOT_FOUND'); end if;

  insert into public.affiliate_commissions(affiliate_id, type, amount, status, available_at, created_by, note)
  values (p_affiliate_id, 'adjustment', p_delta, 'available', now(), auth.uid(), trim(p_reason))
  returning id into v_id;

  perform public._affiliate_notify(p_affiliate_id, 'commission_adjustment',
    case when p_delta > 0 then 'Ajustement de commission (+)' else 'Ajustement de commission (−)' end,
    (case when p_delta > 0 then '+' else '' end) || p_delta || ' FCFA : ' || trim(p_reason),
    jsonb_build_object('amount', p_delta));

  begin
    perform public._log_admin_action('affiliate_commission_adjust', v_user, v_id, null,
      jsonb_build_object('delta', p_delta), trim(p_reason), p_delta);
  exception when undefined_function then null; end;

  return jsonb_build_object('success', true, 'id', v_id);
end; $$;
revoke execute on function public.admin_adjust_commission(uuid, bigint, text) from public;
grant execute on function public.admin_adjust_commission(uuid, bigint, text) to authenticated;

-- ── Cron quotidien (pg_cron) : accruals + maturation ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'affiliate-accruals') then
      perform cron.unschedule('affiliate-accruals');
    end if;
    perform cron.schedule('affiliate-accruals', '15 2 * * *',
      $cmd$ select public.affiliate_run_accruals(); $cmd$);
  end if;
end $$;
