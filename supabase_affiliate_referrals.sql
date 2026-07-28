-- ============================================================
--  PlugBet Affiliation — Capture parrainages & clics (Phase 5b)
-- ============================================================
--  ADDITIF : ne modifie pas handle_new_user ni les flux d'argent.
--  * Trigger AFTER INSERT sur auth.users : si raw_user_meta_data.promo_code
--    correspond à un code ACTIF -> crée le parrainage (affiliate_referrals).
--  * affiliate_reconcile_activity (cron) : 1er dépôt qualifiant (wallet_ledger)
--    + last_active (bets). Alimente le CPA.
--  * affiliate_log_click : journalise un clic (appelable côté public/landing).
-- ============================================================

-- ── Capture du parrainage à l'inscription ──
create or replace function public._affiliate_capture_referral()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_pc record;
begin
  v_code := upper(nullif(trim(new.raw_user_meta_data->>'promo_code'), ''));
  if v_code is null then return new; end if;

  select pc.id, pc.affiliate_id into v_pc
  from public.affiliate_promo_codes pc
  where pc.status = 'active' and lower(pc.code) = lower(v_code)
  limit 1;
  if v_pc.id is null then return new; end if;

  -- Pas d'auto-parrainage.
  if exists (select 1 from public.affiliates a where a.id = v_pc.affiliate_id and a.user_id = new.id) then
    return new;
  end if;

  insert into public.affiliate_referrals(
    affiliate_id, promo_code_id, code, player_id, country, device, os, registered_at)
  values (v_pc.affiliate_id, v_pc.id, v_code, new.id,
          nullif(new.raw_user_meta_data->>'country', ''),
          nullif(new.raw_user_meta_data->>'device', ''),
          nullif(new.raw_user_meta_data->>'os', ''), now())
  on conflict (player_id) do nothing;

  perform public._affiliate_notify(v_pc.affiliate_id, 'referral_signup', 'Nouvelle inscription',
    'Un nouveau joueur s''est inscrit avec ton code ' || v_code || '.',
    jsonb_build_object('player_id', new.id));
  return new;
exception when others then
  return new;  -- ne jamais bloquer l'inscription
end $$;

drop trigger if exists on_auth_user_created_affiliate on auth.users;
create trigger on_auth_user_created_affiliate
  after insert on auth.users
  for each row execute function public._affiliate_capture_referral();

-- ── Réconciliation : 1er dépôt qualifiant + dernière activité ──
create or replace function public.affiliate_reconcile_activity()
returns int language plpgsql security definer set search_path = public as $$
declare v_min bigint; v_n int := 0; r record; v_dep record;
begin
  select cpa_min_deposit into v_min from public.affiliate_config where id = 1;

  for r in select rf.id, rf.player_id from public.affiliate_referrals rf where rf.first_deposit_at is null loop
    select min(created_at) as first_at,
           (array_agg(delta order by created_at))[1] as first_delta
      into v_dep
      from public.wallet_ledger
      where user_id = r.player_id and reason = 'mobile_money_deposit' and delta > 0;
    if v_dep.first_at is not null then
      update public.affiliate_referrals
        set first_deposit_at = v_dep.first_at,
            first_deposit_amount = v_dep.first_delta,
            qualified = (v_dep.first_delta >= v_min)
        where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;

  update public.affiliate_referrals rf
    set last_active_at = sub.last_at
    from (select user_id, max(created_at) last_at from public.bets where is_virtual = false group by user_id) sub
    where sub.user_id = rf.player_id
      and (rf.last_active_at is null or sub.last_at > rf.last_active_at);

  return v_n;
end $$;
revoke execute on function public.affiliate_reconcile_activity() from public;

-- Intègre la réconciliation dans l'orchestrateur du cron (avant le CPA).
create or replace function public.affiliate_run_accruals()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rec int; v_cpa int; v_mat int; v_rev int;
begin
  v_rec := public.affiliate_reconcile_activity();
  v_cpa := public.affiliate_accrue_cpa();
  v_rev := public.affiliate_accrue_revenue_share();
  v_mat := public.affiliate_mature_commissions();
  return jsonb_build_object('reconciled', v_rec, 'cpa', v_cpa, 'revenue_share', v_rev, 'matured', v_mat, 'at', now());
end; $$;
revoke execute on function public.affiliate_run_accruals() from public;

-- ── Journalisation d'un clic (appelable côté public/landing) ──
create or replace function public.affiliate_log_click(
  p_code text, p_page text, p_country text default null, p_device text default null, p_os text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pc record;
begin
  select id, affiliate_id into v_pc from public.affiliate_promo_codes
  where status = 'active' and lower(code) = lower(coalesce(p_code, '')) limit 1;
  if v_pc.id is null then return jsonb_build_object('success', false); end if;
  insert into public.affiliate_link_clicks(code, promo_code_id, affiliate_id, landing_page, country, device, os)
  values (upper(p_code), v_pc.id, v_pc.affiliate_id, nullif(p_page, ''),
          nullif(p_country, ''), nullif(p_device, ''), nullif(p_os, ''));
  return jsonb_build_object('success', true);
end $$;
grant execute on function public.affiliate_log_click(text, text, text, text, text) to anon, authenticated;
