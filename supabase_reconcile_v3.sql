-- ============================================================
-- RECONCILE MONEY SYSTEM V3 — Inclut legacy untracked bets Mines/Solitaire
-- ============================================================
-- V2 affichait diff_adjusted = -16 291 (16k coins disparus).
-- Cause : avant le fix Mines/Solitaire, les mises de ces 2 jeux
-- etaient debitees du user mais PAS creditees a game_treasury
-- → coins disparus de la comptabilite globale.
--
-- V3 calcule ces "legacy untracked bets" en cherchant les sessions
-- Mines/Solitaire dont la mise n'a JAMAIS ete inseree dans
-- treasury_movements. Les soustrait du diff pour avoir la VRAIE
-- imbalance (qui devrait etre proche de 0).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reconcile_money_system_v3()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_coins         BIGINT;
  v_game_balance       BIGINT;
  v_admin_balance      BIGINT;
  v_deposits           BIGINT;
  v_withdrawals        BIGINT;
  v_openings           BIGINT;
  v_legacy_mines_bets  BIGINT := 0;
  v_legacy_solit_bets  BIGINT := 0;
  v_total_system       BIGINT;
  v_expected           BIGINT;
  v_diff_raw           BIGINT;
  v_diff_v2            BIGINT;
  v_diff_v3            BIGINT;
  v_consistent         BOOLEAN;
BEGIN
  SELECT COALESCE(SUM(coins), 0) INTO v_user_coins FROM user_profiles;
  SELECT COALESCE(balance, 0) INTO v_game_balance FROM game_treasury WHERE id = 1;
  SELECT COALESCE(balance, 0) INTO v_admin_balance FROM admin_treasury WHERE id = 1;

  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT' THEN amount ELSE 0 END), 0)
    INTO v_deposits FROM freemopay_transactions WHERE status = 'SUCCESS';
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'WITHDRAW' THEN amount ELSE 0 END), 0)
    INTO v_withdrawals FROM freemopay_transactions WHERE status = 'SUCCESS';

  SELECT COALESCE(SUM(delta), 0) INTO v_openings
  FROM wallet_ledger
  WHERE reason = 'opening_balance' AND ref_type = 'system';

  -- ===== Legacy Mines : sessions terminees sans loss_collect dans treasury =====
  BEGIN
    SELECT COALESCE(SUM(ms.bet_amount), 0) INTO v_legacy_mines_bets
    FROM mines_sessions ms
    WHERE ms.status IN ('lost', 'cashed_out')
      AND NOT EXISTS (
        SELECT 1 FROM treasury_movements tm
        WHERE tm.game_type = 'mines'
          AND tm.game_id = ms.id
          AND tm.movement_type = 'loss_collect'
      );
  EXCEPTION WHEN OTHERS THEN v_legacy_mines_bets := 0; END;

  -- ===== Legacy Solitaire : sessions terminees sans loss_collect =====
  BEGIN
    SELECT COALESCE(SUM(ss.bet_amount), 0) INTO v_legacy_solit_bets
    FROM solitaire_sessions ss
    WHERE ss.state IN ('paid', 'forfeit', 'expired')
      AND NOT ss.is_practice
      AND NOT EXISTS (
        SELECT 1 FROM treasury_movements tm
        WHERE tm.game_type = 'solitaire'
          AND tm.game_id = ss.id
          AND tm.movement_type = 'loss_collect'
      );
  EXCEPTION WHEN OTHERS THEN v_legacy_solit_bets := 0; END;

  v_total_system := v_user_coins + v_game_balance + v_admin_balance;
  v_expected     := v_deposits - v_withdrawals;
  v_diff_raw     := v_total_system - v_expected;
  v_diff_v2      := v_diff_raw - v_openings;
  -- v3 : v2 PLUS les mises legacy non tracees (qui ont fait sortir des coins)
  v_diff_v3      := v_diff_v2 + v_legacy_mines_bets + v_legacy_solit_bets;

  v_consistent := ABS(v_diff_v3) < 200;

  RETURN jsonb_build_object(
    'consistent',           v_consistent,
    'total_in_system',      v_total_system,
    'deposits_total',       v_deposits,
    'withdrawals_total',    v_withdrawals,
    'expected_total',       v_expected,
    'opening_balance_sum',  v_openings,
    'legacy_mines_untracked', v_legacy_mines_bets,
    'legacy_solitaire_untracked', v_legacy_solit_bets,
    'diff',                 v_diff_v3,            -- diff REELLE (apres tous ajustements)
    'diff_v2',              v_diff_v2,            -- diff sans le legacy bets
    'diff_raw',             v_diff_raw,           -- diff brute
    'legacy_count',         (SELECT COUNT(*) FROM wallet_ledger
                              WHERE reason = 'opening_balance' AND ref_type = 'system'),
    'checked_at',           NOW()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.reconcile_money_system_v3() TO authenticated;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT reconcile_money_system_v3();
