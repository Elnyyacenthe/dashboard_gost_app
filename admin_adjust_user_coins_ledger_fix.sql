-- ============================================================
-- FIX : admin_adjust_user_coins via wallet_ledger (V2)
-- ============================================================
-- L'ancien chemin UPDATE direct user_profiles.coins cree un drift :
--   1. coins decremente (ex: 1000 -> 500)
--   2. wallet_ledger reste a 1000 (pas d'entree)
--   3. wallet-drift-repair-daily a 3h matin force coins = ledger = 1000
--   4. L'ajustement admin est ANNULE
--
-- FIX : utilise wallet_apply_delta qui ecrit atomiquement dans
-- wallet_ledger + user_profiles.coins. Plus de drift, plus d'annulation.
-- ============================================================

create or replace function public.admin_adjust_user_coins(
  p_user_id uuid,
  p_delta bigint,
  p_reason text,
  p_ref_type text default 'admin',
  p_ref_id text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_new_balance int;
  v_actual_delta bigint;
  v_current_balance bigint;
begin
  if not is_super_admin() then
    return jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  end if;

  if p_delta = 0 then
    return jsonb_build_object('success', false, 'error', 'DELTA_ZERO');
  end if;

  -- Lock + snapshot avant
  select to_jsonb(up.*) into v_before
    from user_profiles up where id = p_user_id for update;

  if v_before is null then
    return jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- Pour les debits : cap au solde dispo (jamais negatif)
  -- car wallet_apply_delta refuse si balance < 0
  v_current_balance := wallet_balance(p_user_id);
  v_actual_delta := p_delta;
  if p_delta < 0 then
    -- p_delta negatif : on debite. Cap au solde actuel pour eviter exception
    if (v_current_balance + p_delta) < 0 then
      v_actual_delta := -v_current_balance; -- debite le maximum dispo
    end if;
  end if;

  -- Skip si delta effectif = 0 (user avait deja 0)
  if v_actual_delta = 0 then
    return jsonb_build_object(
      'success', true,
      'new_balance', v_current_balance,
      'note', 'no_change_balance_already_zero'
    );
  end if;

  -- DEBIT/CREDIT atomique via wallet_ledger
  -- Idempotent via request_id si appele plusieurs fois (admin retry)
  -- p_ref_type/p_ref_id permettent de lier l'entree a une transaction
  -- specifique (ex: freemopay_tx) pour que le diagnostic Finance la
  -- considere comme resolue apres credit manuel.
  v_new_balance := public.wallet_apply_delta(
    p_user_id,
    v_actual_delta::int,
    'admin_adjustment',
    coalesce(p_ref_type, 'admin'),
    p_ref_id,
    jsonb_build_object(
      'reason', p_reason,
      'admin_id', auth.uid(),
      'requested_delta', p_delta,
      'actual_delta', v_actual_delta,
      'capped', p_delta != v_actual_delta,
      'ref_type', coalesce(p_ref_type, 'admin'),
      'ref_id', p_ref_id
    ),
    'admin_adj_' || p_user_id::text || '_' || extract(epoch from now())::text || '_' || gen_random_uuid()::text
  );

  -- Snapshot apres (depuis user_profiles, deja a jour)
  select to_jsonb(up.*) into v_after from user_profiles up where id = p_user_id;

  -- Log admin_actions
  perform _log_admin_action(
    'coin_adjustment',
    p_user_id, null, v_before, v_after, p_reason, v_actual_delta
  );

  -- treasury_movements pour audit
  insert into treasury_movements (game_type, user_id, movement_type, amount, metadata)
  values (
    'system', p_user_id, 'adjustment', v_actual_delta,
    jsonb_build_object(
      'action', 'admin_coin_adjustment',
      'reason', p_reason,
      'admin_id', auth.uid(),
      'via_ledger', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'requested_delta', p_delta,
    'actual_delta', v_actual_delta,
    'capped', p_delta != v_actual_delta
  );
end;
$$;

grant execute on function public.admin_adjust_user_coins(uuid, bigint, text) to authenticated;
grant execute on function public.admin_adjust_user_coins(uuid, bigint, text, text, text) to authenticated;
