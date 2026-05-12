-- ============================================================
-- RECONCILE MONEY SYSTEM V2 — Tient compte de l'heritage pre-ledger
-- ============================================================
-- La v1 affichait "IMBALANCE DETECTE" parce que les opening_balance
-- (soldes des joueurs avant le deploiement du ledger) ne sont pas
-- couverts par de vrais depots Mobile Money — mais sont legitimes.
--
-- Cette v2 :
--   - Calcule la discrepance brute (comme v1)
--   - Soustrait le total des opening_balance
--   - Tolere un ecart < 100 coins (arrondis commissions)
--   - Marque consistent=true si l'imbalance reelle est negligeable
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconcile_money_system_v2()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_coins     BIGINT;
  v_game_balance   BIGINT;
  v_admin_balance  BIGINT;
  v_deposits       BIGINT;
  v_withdrawals    BIGINT;
  v_openings       BIGINT;
  v_total_system   BIGINT;
  v_expected       BIGINT;
  v_diff_raw       BIGINT;
  v_diff_adjusted  BIGINT;
  v_consistent     BOOLEAN;
BEGIN
  -- Lectures parallèles des composants
  SELECT COALESCE(SUM(coins), 0) INTO v_user_coins FROM user_profiles;

  SELECT COALESCE(balance, 0) INTO v_game_balance
  FROM game_treasury WHERE id = 1;

  SELECT COALESCE(balance, 0) INTO v_admin_balance
  FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(CASE
    WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0
  END), 0) INTO v_deposits
  FROM freemopay_transactions WHERE status = 'SUCCESS';

  SELECT COALESCE(SUM(CASE
    WHEN transaction_type = 'WITHDRAW' THEN amount ELSE 0
  END), 0) INTO v_withdrawals
  FROM freemopay_transactions WHERE status = 'SUCCESS';

  -- Heritage pre-ledger : soldes initialises sans depot MM correspondant
  SELECT COALESCE(SUM(delta), 0) INTO v_openings
  FROM wallet_ledger
  WHERE reason = 'opening_balance' AND ref_type = 'system';

  v_total_system  := v_user_coins + v_game_balance + v_admin_balance;
  v_expected      := v_deposits - v_withdrawals;
  v_diff_raw      := v_total_system - v_expected;
  v_diff_adjusted := v_diff_raw - v_openings;

  -- Tolerance 100 coins pour les arrondis (commissions, etc.)
  v_consistent := ABS(v_diff_adjusted) < 100;

  RETURN jsonb_build_object(
    'consistent',          v_consistent,
    'total_in_system',     v_total_system,
    'deposits_total',      v_deposits,
    'withdrawals_total',   v_withdrawals,
    'expected_total',      v_expected,
    'opening_balance_sum', v_openings,
    'diff',                v_diff_adjusted,        -- diff REELLE (ajustee)
    'diff_raw',            v_diff_raw,             -- diff brute (info)
    'legacy_count',        (SELECT COUNT(*) FROM wallet_ledger
                            WHERE reason = 'opening_balance' AND ref_type = 'system'),
    'checked_at',          NOW()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.reconcile_money_system_v2() TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT reconcile_money_system_v2();
