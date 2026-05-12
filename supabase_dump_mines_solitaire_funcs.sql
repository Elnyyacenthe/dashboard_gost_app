-- ============================================================
-- DUMP du code SQL actuel de cashout_mines_session et solitaire_payout
-- ============================================================
-- Pour voir si la version deployee appelle bien :
--   - treasury_place_bet (debit)
--   - apply_game_payout (credit + commission)
-- Si ces appels sont absents -> la migration mines_treasury_migration.sql
-- ou solitaire_v2_anticheat.sql n'a pas ete appliquee.
-- ============================================================

SELECT
  proname AS fn,
  pg_get_function_arguments(oid) AS args,
  pg_get_functiondef(oid) AS source
FROM pg_proc
WHERE proname IN ('cashout_mines_session', 'reveal_mines_tile', 'solitaire_payout', 'create_mines_session');
