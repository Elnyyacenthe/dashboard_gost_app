-- ============================================================
--  PlugBet Affiliation — Retraits & Paiements (Phase 3b)
-- ============================================================
--  « Disponible au retrait » = commissions available - retraits déjà engagés
--  (pending/validated/paid). Un retrait payé consomme le disponible sans
--  toucher au grand livre des commissions. Idempotent, additif.
-- ============================================================

-- Montant déjà engagé en retraits (réservé).
create or replace function public.affiliate_reserved_withdrawals(p_aff uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint
  from public.affiliate_withdrawals
  where affiliate_id = p_aff and status in ('pending', 'validated', 'paid');
$$;
revoke execute on function public.affiliate_reserved_withdrawals(uuid) from public;

-- dashboard_summary : "available" = disponible RÉEL au retrait (réservations déduites).
create or replace function public.affiliate_dashboard_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_aff_id uuid; v_bal record;
  v_signups int; v_first_deposits int; v_active int;
  v_comm_today bigint; v_comm_month bigint; v_available bigint;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select id into v_aff_id from public.affiliates where user_id = v_uid;
  if v_aff_id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;

  select * into v_bal from public.affiliate_balances_view where affiliate_id = v_aff_id;
  v_available := greatest(coalesce(v_bal.available, 0) - public.affiliate_reserved_withdrawals(v_aff_id), 0);

  select count(*) into v_signups from public.affiliate_referrals where affiliate_id = v_aff_id;
  select count(*) into v_first_deposits from public.affiliate_referrals where affiliate_id = v_aff_id and qualified;
  select count(*) into v_active from public.affiliate_referrals where affiliate_id = v_aff_id and last_active_at > now() - interval '30 days';
  select coalesce(sum(amount), 0) into v_comm_today from public.affiliate_commissions
    where affiliate_id = v_aff_id and status <> 'reversed' and created_at >= date_trunc('day', now());
  select coalesce(sum(amount), 0) into v_comm_month from public.affiliate_commissions
    where affiliate_id = v_aff_id and status <> 'reversed' and created_at >= date_trunc('month', now());

  return jsonb_build_object('success', true,
    'total_earned', coalesce(v_bal.total_earned, 0),
    'available', v_available,
    'pending', coalesce(v_bal.pending, 0),
    'signups', v_signups, 'first_deposits', v_first_deposits, 'active_players', v_active,
    'commission_today', v_comm_today, 'commission_month', v_comm_month);
end; $$;
revoke execute on function public.affiliate_dashboard_summary() from public;
grant execute on function public.affiliate_dashboard_summary() to authenticated;

-- ── Affilié : demande de retrait ──
create or replace function public.affiliate_request_withdrawal(
  p_amount bigint, p_method text, p_holder text, p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_aff public.affiliates; v_cfg public.affiliate_config;
  v_available bigint; v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('success', false, 'error', 'AUTH_REQUIRED'); end if;
  select * into v_aff from public.affiliates where user_id = v_uid;
  if v_aff.id is null then return jsonb_build_object('success', false, 'error', 'NOT_AFFILIATE'); end if;
  if v_aff.status <> 'active' then return jsonb_build_object('success', false, 'error', 'AFFILIATE_INACTIVE'); end if;
  select * into v_cfg from public.affiliate_config where id = 1;

  if p_method not in ('orange_money', 'mtn_money', 'wave', 'crypto') then
    return jsonb_build_object('success', false, 'error', 'INVALID_METHOD'); end if;
  if coalesce(trim(p_holder), '') = '' or coalesce(trim(p_number), '') = '' then
    return jsonb_build_object('success', false, 'error', 'MISSING_ACCOUNT',
      'message', 'Renseigne le titulaire et le numéro du compte.'); end if;
  if p_amount < v_cfg.withdrawal_min then
    return jsonb_build_object('success', false, 'error', 'BELOW_MIN',
      'message', 'Le montant minimum de retrait est ' || v_cfg.withdrawal_min || ' FCFA.'); end if;

  select greatest(coalesce(b.available, 0) - public.affiliate_reserved_withdrawals(v_aff.id), 0)
    into v_available from public.affiliate_balances_view b where b.affiliate_id = v_aff.id;
  if p_amount > v_available then
    return jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE',
      'message', 'Montant supérieur à ton solde disponible (' || v_available || ' FCFA).'); end if;

  insert into public.affiliate_withdrawals(affiliate_id, amount, method, account_holder, account_number)
  values (v_aff.id, p_amount, p_method, trim(p_holder), trim(p_number))
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'remaining', v_available - p_amount);
end; $$;
revoke execute on function public.affiliate_request_withdrawal(bigint, text, text, text) from public;
grant execute on function public.affiliate_request_withdrawal(bigint, text, text, text) to authenticated;

-- ── Admin : décision sur un retrait ──
create or replace function public.admin_decide_withdrawal(
  p_id uuid, p_action text, p_reason text default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.affiliate_withdrawals; v_user uuid; v_new text; v_title text; v_body text;
begin
  if not (public.is_admin() or public.is_super_admin()) then
    return jsonb_build_object('success', false, 'error', 'NOT_ADMIN'); end if;
  select * into v_row from public.affiliate_withdrawals where id = p_id;
  if v_row.id is null then return jsonb_build_object('success', false, 'error', 'WITHDRAWAL_NOT_FOUND'); end if;
  select user_id into v_user from public.affiliates where id = v_row.affiliate_id;

  if p_action = 'validate' then
    if v_row.status <> 'pending' then return jsonb_build_object('success', false, 'error', 'BAD_STATE'); end if;
    v_new := 'validated'; v_title := 'Retrait validé';
    v_body := 'Ta demande de retrait de ' || v_row.amount || ' FCFA a été validée. Paiement en cours.';
    update public.affiliate_withdrawals set status = v_new, decided_at = now(), decided_by = auth.uid(),
      decision_reason = nullif(trim(p_reason), '') where id = p_id;
  elsif p_action = 'refuse' then
    if v_row.status not in ('pending', 'validated') then return jsonb_build_object('success', false, 'error', 'BAD_STATE'); end if;
    if coalesce(trim(p_reason), '') = '' then return jsonb_build_object('success', false, 'error', 'REASON_REQUIRED'); end if;
    v_new := 'refused'; v_title := 'Retrait refusé';
    v_body := 'Ta demande de retrait de ' || v_row.amount || ' FCFA a été refusée : ' || trim(p_reason);
    update public.affiliate_withdrawals set status = v_new, decided_at = now(), decided_by = auth.uid(),
      decision_reason = trim(p_reason) where id = p_id;
  elsif p_action = 'mark_paid' then
    if v_row.status <> 'validated' then return jsonb_build_object('success', false, 'error', 'BAD_STATE'); end if;
    v_new := 'paid'; v_title := 'Retrait payé';
    v_body := 'Ton retrait de ' || v_row.amount || ' FCFA a été payé' ||
              coalesce(' (réf. ' || nullif(trim(p_reference), '') || ')', '') || '.';
    update public.affiliate_withdrawals set status = v_new, paid_at = now(),
      reference = nullif(trim(p_reference), ''), decided_by = auth.uid() where id = p_id;
  else
    return jsonb_build_object('success', false, 'error', 'UNKNOWN_ACTION');
  end if;

  perform public._affiliate_notify(v_row.affiliate_id, 'withdrawal_' || v_new, v_title, v_body,
    jsonb_build_object('withdrawal_id', p_id, 'amount', v_row.amount));
  begin
    perform public._log_admin_action('affiliate_withdrawal_' || p_action, v_user, p_id, to_jsonb(v_row),
      (select to_jsonb(w) from public.affiliate_withdrawals w where id = p_id),
      coalesce(nullif(trim(p_reason), ''), 'retrait ' || p_action), v_row.amount);
  exception when undefined_function then null; end;

  return jsonb_build_object('success', true, 'status', v_new);
end; $$;
revoke execute on function public.admin_decide_withdrawal(uuid, text, text, text) from public;
grant execute on function public.admin_decide_withdrawal(uuid, text, text, text) to authenticated;

-- Vue admin : retraits + identité de l'affilié.
create or replace view public.admin_affiliate_withdrawals_view as
select w.*, up.username, up.email
from public.affiliate_withdrawals w
join public.affiliates a on a.id = w.affiliate_id
join public.user_profiles up on up.id = a.user_id;
alter view public.admin_affiliate_withdrawals_view set (security_invoker = on);
grant select on public.admin_affiliate_withdrawals_view to authenticated;
