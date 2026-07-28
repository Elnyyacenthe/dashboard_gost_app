-- ============================================================
--  PlugBet Affiliation — Activation revenue-share + referral Google
-- ============================================================
--  * NGR = sports (bets: Σ mises - Σ gains) + casino (treasury_movements :
--    Σ loss_collect - Σ payout, par joueur). Sources per-user, sans ambiguïté.
--  * Activation du revenue-share (revenue_share_enabled = true).
--  * affiliate_claim_referral : capture le parrainage APRÈS inscription
--    (Google OAuth ne porte pas de metadata) — borné aux comptes fraîchement
--    créés (anti-claim rétroactif).
-- ============================================================

create or replace function public.affiliate_accrue_revenue_share()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean; v_pct numeric; v_hold int;
  v_ws date; v_we date; v_n int := 0; a record;
  v_ngr_sport bigint; v_ngr_casino bigint; v_ngr bigint; v_comm bigint;
begin
  select revenue_share_enabled, revenue_share_percent, holding_days
    into v_enabled, v_pct, v_hold from public.affiliate_config where id = 1;
  if not v_enabled then return 0; end if;

  v_ws := (date_trunc('week', now())::date - 7);  -- lundi de la semaine passée
  v_we := v_ws + 7;                                -- lundi suivant (exclu)

  for a in select id from public.affiliates where status = 'active' loop
    -- NGR sports : Σ mises - Σ gains payés (paris réels réglés).
    select coalesce(sum(b.stake), 0) - coalesce(sum(coalesce(b.actual_payout, 0)), 0)
      into v_ngr_sport
      from public.bets b
      join public.affiliate_referrals rf on rf.player_id = b.user_id and rf.affiliate_id = a.id
      where b.is_virtual = false and b.settled_at is not null
        and b.settled_at >= v_ws and b.settled_at < v_we;

    -- NGR casino : Σ pertes collectées - Σ gains payés (treasury_movements).
    select coalesce(sum(tm.amount) filter (where tm.movement_type = 'loss_collect'), 0)
         - coalesce(sum(tm.amount) filter (where tm.movement_type = 'payout'), 0)
      into v_ngr_casino
      from public.treasury_movements tm
      join public.affiliate_referrals rf on rf.player_id = tm.user_id and rf.affiliate_id = a.id
      where tm.created_at >= v_ws and tm.created_at < v_we;

    v_ngr := coalesce(v_ngr_sport, 0) + coalesce(v_ngr_casino, 0);
    v_comm := floor(greatest(v_ngr, 0) * v_pct / 100.0)::bigint;
    if v_comm > 0 then
      insert into public.affiliate_commissions(
        affiliate_id, type, amount, status, period_start, period_end, available_at, note)
      values (a.id, 'revenue_share', v_comm, 'pending', v_ws, v_we - 1,
              (v_we + make_interval(days => v_hold)), 'Revenue-share (sports + casino)')
      on conflict (affiliate_id, period_start, period_end) where type = 'revenue_share' do nothing;
      if found then
        perform public._affiliate_notify(a.id, 'commission_revenue', 'Commission hebdomadaire',
          'Revenue-share de la semaine : +' || v_comm || ' FCFA.',
          jsonb_build_object('period_start', v_ws, 'amount', v_comm));
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end; $$;
revoke execute on function public.affiliate_accrue_revenue_share() from public;

-- Activation.
update public.affiliate_config set revenue_share_enabled = true where id = 1;

-- ── Capture du parrainage post-inscription (Google OAuth & fallback) ──
create or replace function public.affiliate_claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_created timestamptz; v_pc record; v_code text;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  -- Déjà parrainé -> succès idempotent.
  if exists (select 1 from public.affiliate_referrals where player_id = v_uid) then
    return jsonb_build_object('success', true, 'already', true);
  end if;
  -- Uniquement à l'inscription : compte créé il y a moins de 30 min.
  select created_at into v_created from auth.users where id = v_uid;
  if v_created is null or v_created < now() - interval '30 minutes' then
    return jsonb_build_object('success', false, 'error', 'TOO_LATE');
  end if;

  v_code := upper(nullif(trim(p_code), ''));
  if v_code is null then return jsonb_build_object('success', false, 'error', 'CODE_REQUIRED'); end if;

  select id, affiliate_id into v_pc from public.affiliate_promo_codes
  where status = 'active' and lower(code) = lower(v_code) limit 1;
  if v_pc.id is null then return jsonb_build_object('success', false, 'error', 'CODE_INVALID'); end if;
  -- Pas d'auto-parrainage.
  if exists (select 1 from public.affiliates a where a.id = v_pc.affiliate_id and a.user_id = v_uid) then
    return jsonb_build_object('success', false, 'error', 'SELF_REFERRAL');
  end if;

  insert into public.affiliate_referrals(affiliate_id, promo_code_id, code, player_id)
  values (v_pc.affiliate_id, v_pc.id, v_code, v_uid)
  on conflict (player_id) do nothing;

  perform public._affiliate_notify(v_pc.affiliate_id, 'referral_signup', 'Nouvelle inscription',
    'Un nouveau joueur s''est inscrit avec ton code ' || v_code || '.',
    jsonb_build_object('player_id', v_uid));
  return jsonb_build_object('success', true);
end; $$;
revoke execute on function public.affiliate_claim_referral(text) from public;
grant execute on function public.affiliate_claim_referral(text) to authenticated;
