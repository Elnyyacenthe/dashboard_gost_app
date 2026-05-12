-- ============================================================
-- DIAGNOSTIC Mines & Solitaire : ou sont les gains ?
-- ============================================================

-- 1. Combien de mouvements existent pour Mines et Solitaire ?
SELECT
  game_type,
  movement_type,
  COUNT(*)               AS nb,
  COALESCE(SUM(amount),0)::TEXT AS total,
  MAX(created_at)        AS last_mvt
FROM treasury_movements
WHERE game_type IN ('mines', 'solitaire', 'solitaire_multi')
GROUP BY game_type, movement_type
ORDER BY game_type, movement_type;

-- 2. Les RPCs Mines existent-elles en base ?
SELECT
  proname AS function_name,
  pg_get_function_arguments(oid) AS signature
FROM pg_proc
WHERE proname IN (
  'create_mines_session', 'reveal_mines_tile', 'cashout_mines_session',
  'solitaire_place_bet', 'solitaire_payout',
  'treasury_place_bet', 'apply_game_payout'
)
ORDER BY proname, signature;

-- 3. Combien de sessions Mines ont été créées (table source) ?
SELECT
  'mines_sessions_total'   AS check_name,
  COUNT(*)::TEXT           AS count,
  COUNT(*) FILTER (WHERE status = 'won')::TEXT  AS won,
  COUNT(*) FILTER (WHERE status = 'lost')::TEXT AS lost,
  COUNT(*) FILTER (WHERE status = 'active')::TEXT AS active
FROM mines_sessions
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mines_sessions');

-- 4. Combien de sessions Solitaire ?
SELECT
  'solitaire_sessions_total' AS check_name,
  COUNT(*)::TEXT             AS count,
  COUNT(*) FILTER (WHERE state = 'won')::TEXT     AS won,
  COUNT(*) FILTER (WHERE state = 'lost')::TEXT    AS lost,
  COUNT(*) FILTER (WHERE state = 'pending')::TEXT AS pending
FROM solitaire_sessions
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'solitaire_sessions');

-- 5. Derniers mouvements treasury (pour voir si quelque chose passe encore)
SELECT
  created_at, game_type, movement_type, amount,
  (SELECT username FROM user_profiles WHERE id = tm.user_id) AS user
FROM treasury_movements tm
ORDER BY created_at DESC
LIMIT 20;
