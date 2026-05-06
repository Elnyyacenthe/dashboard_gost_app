-- ============================================================
-- AUDIT CORRECTIONS — Tracabilite, audit, watchdog, idempotency
-- ============================================================
-- A executer APRES tous les autres fichiers SQL.
-- Idempotent (CREATE IF NOT EXISTS / CREATE OR REPLACE partout).
-- ============================================================

-- ============================================================
-- 1) GAME_EVENTS — Event sourcing pour TOUS les jeux
-- ============================================================
-- Chaque action de jeu (mise, lancer, mouvement, fin) y est inseree.
-- Permet replay, detection d'anomalies, audit litiges.
-- ============================================================

CREATE TABLE IF NOT EXISTS game_events (
  id            BIGSERIAL PRIMARY KEY,
  game_id       UUID NOT NULL,
  game_type     TEXT NOT NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,          -- game_start, bet_placed, dice_roll, move,
                                        -- turn_change, payout, refund, game_end,
                                        -- crash_detected, stalled
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  state_before  JSONB,
  state_after   JSONB,
  client_ts     TIMESTAMPTZ,
  server_ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id    UUID,
  ip            INET,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_game        ON game_events(game_id, server_ts);
CREATE INDEX IF NOT EXISTS idx_events_user_recent ON game_events(user_id, server_ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_game_type   ON game_events(game_type, server_ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_idempo
  ON game_events(request_id) WHERE request_id IS NOT NULL;

ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ge_admin_read ON game_events;
CREATE POLICY ge_admin_read ON game_events FOR SELECT
  USING (is_admin() OR is_super_admin() OR auth.uid() = user_id);

-- Insertion controlee : un user ne peut inserer un event que pour lui-meme
DROP POLICY IF EXISTS ge_user_insert ON game_events;
CREATE POLICY ge_user_insert ON game_events FOR INSERT
  WITH CHECK (auth.uid() = user_id OR is_super_admin());

-- ─── RPC log_game_event : appelable depuis le client/serveur des jeux ───
CREATE OR REPLACE FUNCTION log_game_event(
  p_game_id      UUID,
  p_game_type    TEXT,
  p_event_type   TEXT,
  p_payload      JSONB DEFAULT '{}'::jsonb,
  p_state_before JSONB DEFAULT NULL,
  p_state_after  JSONB DEFAULT NULL,
  p_request_id   UUID DEFAULT NULL,
  p_client_ts    TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Idempotency : si request_id existe deja, retourne l'event existant
  IF p_request_id IS NOT NULL THEN
    SELECT id INTO v_id FROM game_events WHERE request_id = p_request_id;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  INSERT INTO game_events (
    game_id, game_type, user_id, event_type, payload,
    state_before, state_after, request_id, client_ts
  ) VALUES (
    p_game_id, p_game_type, v_uid, p_event_type, p_payload,
    p_state_before, p_state_after, p_request_id, p_client_ts
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION log_game_event(UUID, TEXT, TEXT, JSONB, JSONB, JSONB, UUID, TIMESTAMPTZ) TO authenticated;

-- ─── Vue replay : tous les events d'une partie ───
CREATE OR REPLACE VIEW game_replay_view AS
SELECT
  ge.id, ge.game_id, ge.game_type, ge.event_type,
  ge.user_id, up.username,
  ge.payload, ge.state_before, ge.state_after,
  ge.client_ts, ge.server_ts,
  EXTRACT(EPOCH FROM (ge.server_ts - LAG(ge.server_ts) OVER (PARTITION BY ge.game_id ORDER BY ge.server_ts, ge.id))) AS delta_seconds,
  CASE WHEN ge.client_ts IS NOT NULL
       THEN ABS(EXTRACT(EPOCH FROM (ge.server_ts - ge.client_ts)))
       ELSE NULL END AS clock_drift_seconds
FROM game_events ge
LEFT JOIN user_profiles up ON up.id = ge.user_id
ORDER BY ge.game_id, ge.server_ts, ge.id;

-- ============================================================
-- 2) ADMIN_ACTIONS_LOG — Audit trail toutes actions admin
-- ============================================================
-- Toute action super_admin sensible passe par RPC qui log ici.
-- Reason obligatoire pour traçabilité comptable/légale.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_actions_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    UUID NOT NULL REFERENCES auth.users(id),
  action      TEXT NOT NULL,            -- block_user, unblock_user, refund, treasury_transfer,
                                        -- coin_adjustment, kyc_approve, kyc_reject, role_change
  target_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  target_id   UUID,                     -- ticket/game/movement selon contexte
  before_data JSONB,
  after_data  JSONB,
  reason      TEXT NOT NULL,            -- OBLIGATOIRE
  amount      BIGINT,                   -- si action financiere
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aal_admin   ON admin_actions_log(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_target  ON admin_actions_log(target_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aal_action  ON admin_actions_log(action, created_at DESC);

ALTER TABLE admin_actions_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aal_admin_all ON admin_actions_log;
CREATE POLICY aal_admin_all ON admin_actions_log FOR ALL
  USING (is_super_admin() OR is_admin())
  WITH CHECK (is_super_admin() OR is_admin());

-- ─── Helper interne pour logger ───
CREATE OR REPLACE FUNCTION _log_admin_action(
  p_action      TEXT,
  p_target_user UUID,
  p_target_id   UUID,
  p_before      JSONB,
  p_after       JSONB,
  p_reason      TEXT,
  p_amount      BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id BIGINT;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Reason required for admin action (min 3 chars)';
  END IF;

  INSERT INTO admin_actions_log (admin_id, action, target_user, target_id, before_data, after_data, reason, amount)
  VALUES (auth.uid(), p_action, p_target_user, p_target_id, p_before, p_after, p_reason, p_amount)
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

-- ─── RPC publique : Block / Unblock user (avec audit obligatoire) ───
CREATE OR REPLACE FUNCTION admin_set_user_blocked(
  p_user_id UUID,
  p_blocked BOOLEAN,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
BEGIN
  IF NOT (is_super_admin() OR is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  END IF;

  SELECT to_jsonb(up.*) INTO v_before
    FROM user_profiles up WHERE id = p_user_id FOR UPDATE;

  IF v_before IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  UPDATE user_profiles
    SET is_blocked = p_blocked, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING to_jsonb(user_profiles.*) INTO v_after;

  PERFORM _log_admin_action(
    CASE WHEN p_blocked THEN 'block_user' ELSE 'unblock_user' END,
    p_user_id, NULL, v_before, v_after, p_reason, NULL
  );

  RETURN jsonb_build_object('success', true);
END; $$;

GRANT EXECUTE ON FUNCTION admin_set_user_blocked(UUID, BOOLEAN, TEXT) TO authenticated;

-- ─── RPC : Ajuster coins d'un user (refund, correction) ───
CREATE OR REPLACE FUNCTION admin_adjust_user_coins(
  p_user_id UUID,
  p_delta   BIGINT,        -- + ou -
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
  v_new_balance BIGINT;
BEGIN
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_SUPER_ADMIN');
  END IF;

  IF p_delta = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'DELTA_ZERO');
  END IF;

  SELECT to_jsonb(up.*) INTO v_before
    FROM user_profiles up WHERE id = p_user_id FOR UPDATE;

  IF v_before IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  UPDATE user_profiles
    SET coins = GREATEST(0, coins + p_delta), updated_at = NOW()
    WHERE id = p_user_id
    RETURNING coins INTO v_new_balance;

  SELECT to_jsonb(up.*) INTO v_after FROM user_profiles up WHERE id = p_user_id;

  PERFORM _log_admin_action(
    'coin_adjustment',
    p_user_id, NULL, v_before, v_after, p_reason, p_delta
  );

  -- Aussi inserer dans treasury_movements pour zero-sum visible dans Audit page
  INSERT INTO treasury_movements (game_type, user_id, movement_type, amount, metadata)
  VALUES (
    'system', p_user_id, 'adjustment', p_delta,
    jsonb_build_object('action', 'admin_coin_adjustment', 'reason', p_reason, 'admin_id', auth.uid())
  );

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END; $$;

GRANT EXECUTE ON FUNCTION admin_adjust_user_coins(UUID, BIGINT, TEXT) TO authenticated;

-- ─── RPC : Refund une partie pour un joueur ───
CREATE OR REPLACE FUNCTION admin_refund_game(
  p_game_id UUID,
  p_user_id UUID,
  p_amount  BIGINT,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
BEGIN
  IF NOT (is_super_admin() OR is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_AMOUNT');
  END IF;

  -- Idempotency : verifier qu'on n'a pas deja refund cette partie pour ce user
  IF EXISTS (
    SELECT 1 FROM admin_actions_log
    WHERE action = 'refund' AND target_user = p_user_id AND target_id = p_game_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REFUNDED');
  END IF;

  SELECT to_jsonb(up.*) INTO v_before
    FROM user_profiles up WHERE id = p_user_id FOR UPDATE;

  UPDATE user_profiles
    SET coins = coins + p_amount, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING to_jsonb(user_profiles.*) INTO v_after;

  -- Sortir de la caisse jeu
  UPDATE game_treasury
    SET balance = GREATEST(0, balance - p_amount),
        total_paid_out = COALESCE(total_paid_out, 0) + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  -- Trace dans treasury_movements
  INSERT INTO treasury_movements (game_type, game_id, user_id, movement_type, amount, metadata)
  VALUES (
    'system', p_game_id, p_user_id, 'refund', p_amount,
    jsonb_build_object('action', 'admin_refund', 'reason', p_reason, 'admin_id', auth.uid())
  );

  -- Trace dans admin_actions_log avec reason obligatoire
  PERFORM _log_admin_action('refund', p_user_id, p_game_id, v_before, v_after, p_reason, p_amount);

  -- Trace event jeu pour le replay
  INSERT INTO game_events (game_id, game_type, user_id, event_type, payload)
  VALUES (
    p_game_id, 'system', p_user_id, 'admin_refund',
    jsonb_build_object('amount', p_amount, 'reason', p_reason, 'admin_id', auth.uid())
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END; $$;

GRANT EXECUTE ON FUNCTION admin_refund_game(UUID, UUID, BIGINT, TEXT) TO authenticated;

-- ============================================================
-- 3) WATCHDOG — Detection parties bloquees + auto refund
-- ============================================================

-- Ajouter colonne last_activity_at sur les rooms si absente
DO $$ BEGIN
  IF to_regclass('public.ludo_v2_games') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE ludo_v2_games ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NOW()';
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END $$;

-- Trigger : refresh last_activity_at sur insertion d'event
CREATE OR REPLACE FUNCTION refresh_game_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Update tous les jeux supportes (essai sur chacun, ignore si table absente)
  BEGIN
    UPDATE ludo_v2_games SET last_activity_at = NEW.server_ts WHERE id = NEW.game_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS game_events_activity_trg ON game_events;
CREATE TRIGGER game_events_activity_trg
  AFTER INSERT ON game_events
  FOR EACH ROW EXECUTE FUNCTION refresh_game_activity();

-- ─── Detection parties stalled (a appeler via cron) ───
CREATE OR REPLACE FUNCTION detect_stalled_games()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
  v_game RECORD;
BEGIN
  -- Ludo V2 : pas d'event depuis > 5 min en in_progress
  IF to_regclass('public.ludo_v2_games') IS NOT NULL THEN
    FOR v_game IN
      SELECT id, room_id
      FROM ludo_v2_games
      WHERE status = 'in_progress'
        AND COALESCE(last_activity_at, updated_at) < NOW() - INTERVAL '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM admin_alerts
          WHERE alert_type = 'game_stalled'
            AND metadata->>'game_id' = ludo_v2_games.id::text
            AND created_at > NOW() - INTERVAL '10 minutes'
        )
    LOOP
      INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
      VALUES (
        (SELECT user_id FROM ludo_v2_room_players WHERE room_id = v_game.room_id LIMIT 1),
        'game_stalled', 'high',
        format('Partie Ludo bloquee: %s', v_game.id),
        'Aucune activite depuis 5 min en cours de partie. Refund automatique recommande.',
        jsonb_build_object('game_id', v_game.id, 'room_id', v_game.room_id, 'game_type', 'ludo_v2')
      );
      v_count := v_count + 1;
    END LOOP;
  END IF;
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION detect_stalled_games() TO authenticated;

-- ============================================================
-- 4) IDEMPOTENCY POUR PAYOUTS (existing apply_game_payout)
-- ============================================================
-- Table pour tracker les payouts deja effectues
CREATE TABLE IF NOT EXISTS payout_idempotency (
  request_id  UUID PRIMARY KEY,
  game_id     UUID,
  user_id     UUID,
  amount      BIGINT,
  result      JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_idempo_user ON payout_idempotency(user_id);
CREATE INDEX IF NOT EXISTS idx_payout_idempo_game ON payout_idempotency(game_id);

ALTER TABLE payout_idempotency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pi_admin_read ON payout_idempotency;
CREATE POLICY pi_admin_read ON payout_idempotency FOR SELECT
  USING (is_admin() OR is_super_admin());

-- ─── Wrapper idempotent pour payouts ───
CREATE OR REPLACE FUNCTION safe_apply_payout(
  p_request_id UUID,
  p_user_id    UUID,
  p_amount     BIGINT,
  p_game_type  TEXT,
  p_game_id    UUID,
  p_description TEXT DEFAULT 'Gain'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing JSONB;
BEGIN
  -- Si deja traite, retourne le resultat memorise
  SELECT result INTO v_existing FROM payout_idempotency WHERE request_id = p_request_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'data', v_existing);
  END IF;

  -- Crediter user
  UPDATE user_profiles SET coins = coins + p_amount WHERE id = p_user_id;

  -- Decrementer caisse jeu
  UPDATE game_treasury
    SET balance = GREATEST(0, balance - p_amount),
        total_paid_out = COALESCE(total_paid_out, 0) + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  -- Trace
  INSERT INTO treasury_movements (game_type, game_id, user_id, movement_type, amount, metadata)
  VALUES (p_game_type, p_game_id, p_user_id, 'payout', p_amount,
          jsonb_build_object('description', p_description, 'request_id', p_request_id));

  -- Memorize idempotency
  INSERT INTO payout_idempotency (request_id, game_id, user_id, amount, result)
  VALUES (p_request_id, p_game_id, p_user_id, p_amount,
          jsonb_build_object('paid_amount', p_amount, 'paid_at', NOW()));

  RETURN jsonb_build_object('success', true, 'idempotent', false, 'amount', p_amount);
END; $$;

GRANT EXECUTE ON FUNCTION safe_apply_payout(UUID, UUID, BIGINT, TEXT, UUID, TEXT) TO authenticated;

-- ============================================================
-- 5) USER 360 VIEW — Vue agregee pour dashboard support
-- ============================================================
CREATE OR REPLACE VIEW admin_user_360_view AS
SELECT
  up.id, up.username, up.email, up.coins, up.xp, up.rank,
  up.games_played, up.total_wins, up.is_blocked,
  up.kyc_verified, up.kyc_full_name,
  up.created_at, up.last_seen,
  (SELECT COUNT(*) FROM treasury_movements WHERE user_id = up.id) AS movement_count,
  (SELECT COUNT(*) FROM treasury_movements WHERE user_id = up.id AND movement_type = 'loss_collect') AS bets_count,
  (SELECT COUNT(*) FROM treasury_movements WHERE user_id = up.id AND movement_type = 'payout') AS wins_count,
  (SELECT COALESCE(SUM(amount),0) FROM treasury_movements WHERE user_id = up.id AND movement_type = 'loss_collect') AS total_bet,
  (SELECT COALESCE(SUM(amount),0) FROM treasury_movements WHERE user_id = up.id AND movement_type = 'payout') AS total_won,
  (SELECT COALESCE(SUM(amount),0) FROM freemopay_transactions WHERE user_id = up.id AND transaction_type = 'DEPOSIT' AND status = 'SUCCESS') AS total_deposited,
  (SELECT COALESCE(SUM(amount),0) FROM freemopay_transactions WHERE user_id = up.id AND transaction_type = 'WITHDRAW' AND status = 'SUCCESS') AS total_withdrawn,
  (SELECT COUNT(*) FROM admin_alerts WHERE user_id = up.id AND NOT resolved) AS active_alerts,
  (SELECT COUNT(*) FROM support_tickets WHERE user_id = up.id) AS tickets_count
FROM user_profiles up;

GRANT SELECT ON admin_user_360_view TO authenticated;

-- ============================================================
-- 6) LEDGER INVARIANT CHECK — vue zero-sum verifiable
-- ============================================================
CREATE OR REPLACE VIEW ledger_invariant_view AS
WITH
  user_total AS (SELECT COALESCE(SUM(coins),0) AS total FROM user_profiles),
  game_t AS (SELECT COALESCE(balance,0) AS bal FROM game_treasury WHERE id=1),
  admin_t AS (SELECT COALESCE(balance,0) AS bal FROM admin_treasury WHERE id=1),
  deposits AS (SELECT COALESCE(SUM(amount),0) AS total FROM freemopay_transactions WHERE transaction_type='DEPOSIT' AND status='SUCCESS'),
  withdrawals AS (SELECT COALESCE(SUM(amount),0) AS total FROM freemopay_transactions WHERE transaction_type='WITHDRAW' AND status='SUCCESS')
SELECT
  user_total.total                                 AS total_user_coins,
  game_t.bal                                       AS game_treasury,
  admin_t.bal                                      AS admin_treasury,
  user_total.total + game_t.bal + admin_t.bal      AS total_system,
  deposits.total - withdrawals.total               AS expected_total,
  user_total.total + game_t.bal + admin_t.bal
    - (deposits.total - withdrawals.total)         AS discrepancy,
  CASE
    WHEN ABS(user_total.total + game_t.bal + admin_t.bal - (deposits.total - withdrawals.total)) < 1
    THEN true ELSE false
  END AS is_balanced
FROM user_total, game_t, admin_t, deposits, withdrawals;

GRANT SELECT ON ledger_invariant_view TO authenticated;

-- ============================================================
-- 7) ANTI-FRAUD ENRICHED — patterns supplementaires
-- ============================================================
CREATE OR REPLACE FUNCTION scan_for_fraud_patterns_v2()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
  v_user RECORD;
BEGIN
  -- Reuse v1 patterns
  v_count := scan_for_fraud_patterns();

  -- Pattern 4 : Compte cree il y a < 24h avec retrait > 50K
  FOR v_user IN
    SELECT up.id, up.username,
           SUM(ft.amount) AS total_w
    FROM user_profiles up
    JOIN freemopay_transactions ft ON ft.user_id = up.id
    WHERE up.created_at > NOW() - INTERVAL '24 hours'
      AND ft.transaction_type = 'WITHDRAW'
      AND ft.status = 'SUCCESS'
    GROUP BY up.id, up.username
    HAVING SUM(ft.amount) > 50000
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM admin_alerts
      WHERE user_id = v_user.id AND alert_type = 'new_account_high_withdrawal'
        AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
      VALUES (
        v_user.id, 'new_account_high_withdrawal', 'critical',
        format('Nouveau compte (<24h) avec retrait %s', v_user.total_w),
        'Risque de blanchiment ou compte mule.',
        jsonb_build_object('total_withdrawn', v_user.total_w)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Pattern 5 : Joueur jamais misé mais avec coins eleves (= dépôt sans jeu = blanchiment)
  FOR v_user IN
    SELECT up.id, up.username, up.coins
    FROM user_profiles up
    WHERE up.coins > 50000
      AND up.games_played = 0
      AND up.created_at < NOW() - INTERVAL '48 hours'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM admin_alerts
      WHERE user_id = v_user.id AND alert_type = 'no_play_high_balance'
        AND created_at > NOW() - INTERVAL '7 days'
    ) THEN
      INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
      VALUES (
        v_user.id, 'no_play_high_balance', 'high',
        format('Solde eleve sans jeu : %s coins', v_user.coins),
        'Compte avec coins importants mais 0 partie jouee. Suspect (blanchiment).',
        jsonb_build_object('coins', v_user.coins)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION scan_for_fraud_patterns_v2() TO authenticated;

-- ============================================================
-- 8) SUPPORT TICKETS - lien game/movement + refund tracking
-- ============================================================
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS related_game_id     UUID,
  ADD COLUMN IF NOT EXISTS related_movement_id UUID,
  ADD COLUMN IF NOT EXISTS financial_impact    BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status       TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount       BIGINT,
  ADD COLUMN IF NOT EXISTS investigated_by     UUID REFERENCES auth.users(id);

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'game_events'             AS item, COUNT(*) FROM game_events
UNION ALL SELECT 'admin_actions_log',     COUNT(*) FROM admin_actions_log
UNION ALL SELECT 'payout_idempotency',    COUNT(*) FROM payout_idempotency
UNION ALL SELECT 'admin_user_360_view',
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='admin_user_360_view') THEN 1 ELSE 0 END
UNION ALL SELECT 'ledger_invariant_view',
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='ledger_invariant_view') THEN 1 ELSE 0 END;
