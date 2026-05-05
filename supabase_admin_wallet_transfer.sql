-- ============================================================
-- ADMIN ↔ WALLET TRANSFERS
-- ============================================================
-- 2 RPCs pour permettre au super admin de :
--   1. Transferer admin_treasury -> son wallet perso (user_profiles.coins)
--      Apres : il peut faire un retrait Freemopay normal sur le mobile.
--   2. Transferer son wallet perso -> admin_treasury
--      Avant : il a fait un depot Freemopay normal sur le mobile.
--
-- Le but : permettre l'argent vrai sans Edge Function, en reutilisant
-- l'integration Freemopay deja en place dans l'app mobile.
-- ============================================================

-- ============================================================
-- 1) admin_treasury_to_wallet
-- ============================================================
-- Sort N coins de la caisse super admin et les met dans le wallet du caller.
-- Apres, le super admin peut retirer ces coins via Freemopay (mobile).
create or replace function public.admin_treasury_to_wallet(
  p_amount bigint,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  end if;
  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  end if;

  -- Lock la caisse
  select balance into v_balance
    from public.admin_treasury where id = 1 for update;
  if v_balance is null or v_balance < p_amount then
    return jsonb_build_object('success', false,
      'error', 'INSUFFICIENT_TREASURY_BALANCE');
  end if;

  -- 1) Debiter la caisse admin
  update public.admin_treasury set
    balance = balance - p_amount,
    total_withdrawn = total_withdrawn + p_amount,
    updated_at = now()
  where id = 1;

  -- 2) Crediter le wallet du caller
  update public.user_profiles set
    coins = coins + p_amount,
    updated_at = now()
  where id = v_uid;

  -- 3) Log dashboard (legacy)
  insert into public.treasury_transactions
    (treasury_type, type, amount, source, description, admin_id, user_id, metadata)
  values (
    'admin', 'withdrawal', p_amount, 'to_wallet',
    coalesce(p_description, 'Transfert admin -> wallet perso'),
    v_uid, v_uid,
    jsonb_build_object('action', 'admin_to_wallet')
  );

  -- 4) Log nouveau systeme
  insert into public.treasury_movements
    (game_type, user_id, movement_type, amount, metadata)
  values (
    'system', v_uid, 'adjustment', -p_amount,
    jsonb_build_object('action', 'admin_treasury_to_wallet',
                       'description', p_description)
  );

  return jsonb_build_object('success', true,
    'amount', p_amount,
    'new_treasury_balance', v_balance - p_amount);
end;
$$;

grant execute on function public.admin_treasury_to_wallet(bigint, text) to authenticated;

-- ============================================================
-- 2) wallet_to_admin_treasury
-- ============================================================
-- Prend N coins du wallet du caller et les met dans la caisse admin.
-- Le super admin a typiquement fait un depot Freemopay avant pour avoir
-- ces coins, donc cet acte transfere du "vrai argent" vers la caisse.
create or replace function public.wallet_to_admin_treasury(
  p_amount bigint,
  p_description text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_coins int;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  end if;
  if p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  end if;

  -- Lock + verif le solde du caller
  select coins into v_coins
    from public.user_profiles where id = v_uid for update;
  if v_coins is null or v_coins < p_amount then
    return jsonb_build_object('success', false,
      'error', 'INSUFFICIENT_WALLET_BALANCE');
  end if;

  -- 1) Debiter le wallet
  update public.user_profiles set
    coins = coins - p_amount,
    updated_at = now()
  where id = v_uid;

  -- 2) Crediter la caisse admin
  update public.admin_treasury set
    balance = balance + p_amount,
    total_deposited = total_deposited + p_amount,
    updated_at = now()
  where id = 1;

  -- 3) Log legacy
  insert into public.treasury_transactions
    (treasury_type, type, amount, source, description, admin_id, user_id, metadata)
  values (
    'admin', 'deposit', p_amount, 'from_wallet',
    coalesce(p_description, 'Transfert wallet perso -> admin'),
    v_uid, v_uid,
    jsonb_build_object('action', 'wallet_to_admin_treasury')
  );

  -- 4) Log nouveau systeme
  insert into public.treasury_movements
    (game_type, user_id, movement_type, amount, metadata)
  values (
    'system', v_uid, 'adjustment', p_amount,
    jsonb_build_object('action', 'wallet_to_admin_treasury',
                       'description', p_description)
  );

  return jsonb_build_object('success', true,
    'amount', p_amount,
    'new_wallet_balance', v_coins - p_amount);
end;
$$;

grant execute on function public.wallet_to_admin_treasury(bigint, text) to authenticated;

-- ============================================================
-- BONUS : Recuperer les coins de l'admin pour affichage dashboard
-- ============================================================
create or replace function public.get_super_admin_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_coins int;
  v_username text;
begin
  if not public.is_super_admin() then
    return jsonb_build_object('error', 'NOT_SUPER_ADMIN');
  end if;

  select coins, username into v_coins, v_username
    from public.user_profiles where id = v_uid;

  return jsonb_build_object(
    'user_id', v_uid,
    'username', v_username,
    'coins', coalesce(v_coins, 0)
  );
end;
$$;

grant execute on function public.get_super_admin_wallet() to authenticated;
