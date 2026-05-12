-- ============================================================
-- VERIFIER que le diff Treasury vient bien des opening_balance
-- ============================================================
-- Si la somme des opening_balance == discrepance affichee dans
-- Treasury, alors c'est l'heritage pre-ledger legitime et il faut
-- juste arreter de l'afficher comme "imbalance critique".
-- ============================================================

SELECT
  'sum_opening_balance' AS check_name,
  COALESCE(SUM(delta), 0)::TEXT AS value,
  COUNT(*)::TEXT       AS lignes
FROM wallet_ledger
WHERE reason = 'opening_balance' AND ref_type = 'system'
UNION ALL
SELECT
  'total_user_coins',
  COALESCE(SUM(coins), 0)::TEXT,
  COUNT(*)::TEXT
FROM user_profiles
UNION ALL
SELECT
  'deposits_minus_withdrawals_freemopay',
  COALESCE(
    SUM(CASE
      WHEN transaction_type = 'DEPOSIT' THEN amount
      WHEN transaction_type = 'WITHDRAW' THEN -amount
      ELSE 0
    END), 0)::TEXT,
  COUNT(*)::TEXT
FROM freemopay_transactions
WHERE status = 'SUCCESS'
UNION ALL
SELECT
  'admin_treasury_balance',
  COALESCE(balance, 0)::TEXT,
  '1'
FROM admin_treasury
WHERE id = 1
UNION ALL
SELECT
  'game_treasury_balance',
  COALESCE(balance, 0)::TEXT,
  '1'
FROM game_treasury
WHERE id = 1;
