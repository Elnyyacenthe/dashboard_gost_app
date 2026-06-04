-- ============================================================
-- RPC : treasury_game_stats(p_days int default 30)
-- ============================================================
-- Source UNIVERSELLE pour les stats argent par jeu dans le dashboard.
-- Aggrège wallet_ledger (la table V2 ledger qui recoit TOUS les flux
-- via _ledger_post) en bypassant RLS via SECURITY DEFINER.
--
-- Couvre tous les jeux : Penalty, Big Win 777, Cora Dice, Ludo,
-- Blackjack, etc. — peu importe s'ils ecrivent dans treasury_movements
-- ou pas.
--
-- Returns jsonb array :
--   [
--     { "game_type": "slots_777",
--       "bets_in":     150000,        -- argent QUI RENTRE (mises perdues)
--       "payouts_out": 120000,        -- argent QUI SORT (gains payes)
--       "refunds_out": 0,
--       "count":       342,           -- nb de mouvements
--       "users":       18,            -- joueurs uniques
--       "net_profit":  30000          -- bets_in - payouts_out - refunds_out
--     },
--     ...
--   ]
--
-- Acces : super_admin / admin uniquement.
-- ============================================================

create or replace function public.treasury_game_stats(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_since timestamptz := now() - (greatest(coalesce(p_days, 30), 1) || ' days')::interval;
  v_role text;
begin
  -- Acces restreint
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('super_admin', 'admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'game_type',   game_type,
      'bets_in',     bets_in,
      'payouts_out', payouts_out,
      'refunds_out', refunds_out,
      'count',       cnt,
      'users',       users,
      'net_profit',  bets_in - payouts_out - refunds_out
    ) order by (bets_in - payouts_out - refunds_out) desc)
    from (
      select
        coalesce(game_type, 'unknown') as game_type,
        sum(case when amount < 0 and lower(type) in ('bet','wager','stake')
                 then -amount else 0 end)::bigint                                as bets_in,
        sum(case when amount > 0 and lower(type) in ('win','payout','jackpot')
                 then amount else 0 end)::bigint                                 as payouts_out,
        sum(case when lower(type) in ('refund','void') then abs(amount) else 0 end)::bigint as refunds_out,
        count(*)::int                                                            as cnt,
        count(distinct user_id)::int                                             as users
      from wallet_ledger
      where created_at >= v_since
        and game_type is not null
        and game_type not in ('system', 'admin')
      group by game_type
    ) t
  ), '[]'::jsonb);
end $function$;

revoke all on function public.treasury_game_stats(int) from public, anon;
grant execute on function public.treasury_game_stats(int) to authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- 1. Test depuis ton compte super_admin (dashboard ou SQL Editor + JWT):
--    select public.treasury_game_stats(30);
-- 2. Attendu : array de tous les jeux ayant des mouvements sur 30j,
--    avec bets_in/payouts_out/net_profit/users par game_type.
-- 3. Acces refuse pour autres roles :
--    -> raise FORBIDDEN.
