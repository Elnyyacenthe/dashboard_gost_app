-- ============================================================
-- SAFETY & ANTI-FRAUD FEATURES
-- A executer APRES supabase_treasury.sql + supabase_treasury_hooks.sql
-- ============================================================

-- ───────── A. LIMITES DE RETRAIT + KYC ─────────

-- 1. Configuration globale (modifiable par super_admin)
CREATE TABLE IF NOT EXISTS withdrawal_config (
  id                       INT PRIMARY KEY DEFAULT 1,
  max_daily_no_kyc         BIGINT NOT NULL DEFAULT 10000,    -- 10K coins/jour sans KYC
  max_weekly_no_kyc        BIGINT NOT NULL DEFAULT 50000,    -- 50K coins/semaine sans KYC
  kyc_required_above       BIGINT NOT NULL DEFAULT 100000,   -- 100K → KYC obligatoire
  max_single_withdrawal    BIGINT NOT NULL DEFAULT 500000,   -- plafond par opération
  manual_review_above      BIGINT NOT NULL DEFAULT 200000,   -- review admin requise
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT wcfg_single CHECK (id = 1)
);
INSERT INTO withdrawal_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Colonnes user_profiles : KYC + cumul retraits
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS kyc_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_full_name        TEXT,
  ADD COLUMN IF NOT EXISTS kyc_id_doc_url       TEXT,                    -- photo CNI/passport
  ADD COLUMN IF NOT EXISTS kyc_submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_today      BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS withdrawn_this_week  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_withdrawal_at   TIMESTAMPTZ;

-- 3. Reset cumuls automatiquement (jour/semaine)
CREATE OR REPLACE FUNCTION reset_withdrawal_counters()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Reset daily si > 24h depuis dernier retrait
  UPDATE user_profiles
    SET withdrawn_today = 0
    WHERE last_withdrawal_at IS NULL
       OR last_withdrawal_at < (NOW() - INTERVAL '24 hours');
  -- Reset weekly si > 7j
  UPDATE user_profiles
    SET withdrawn_this_week = 0
    WHERE last_withdrawal_at IS NULL
       OR last_withdrawal_at < (NOW() - INTERVAL '7 days');
END; $$;

-- 4. RPC unique de vérification AVANT retrait (appelée par freemopay/manual)
CREATE OR REPLACE FUNCTION check_withdrawal_allowed(
  p_amount BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID := auth.uid();
  v_cfg RECORD;
  v_user_data RECORD;
  v_review_needed BOOLEAN := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Non authentifié');
  END IF;

  -- Reset les compteurs (cron-like, à chaque appel)
  PERFORM reset_withdrawal_counters();

  SELECT * INTO v_cfg FROM withdrawal_config WHERE id = 1;
  SELECT coins, kyc_verified, withdrawn_today, withdrawn_this_week
    INTO v_user_data FROM user_profiles WHERE id = v_user;

  -- Vérif solde
  IF v_user_data.coins < p_amount THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Solde insuffisant');
  END IF;

  -- Vérif plafond par opération
  IF p_amount > v_cfg.max_single_withdrawal THEN
    RETURN jsonb_build_object('allowed', false, 'reason',
      format('Retrait maximum: %s coins par opération', v_cfg.max_single_withdrawal));
  END IF;

  -- Vérif KYC requis pour gros montants
  IF p_amount >= v_cfg.kyc_required_above AND NOT v_user_data.kyc_verified THEN
    RETURN jsonb_build_object('allowed', false, 'reason',
      format('KYC requis pour les retraits ≥ %s coins. Soumettez votre vérification d''identité.', v_cfg.kyc_required_above),
      'kyc_required', true);
  END IF;

  -- Vérif limites quotidiennes/hebdo si pas KYC
  IF NOT v_user_data.kyc_verified THEN
    IF v_user_data.withdrawn_today + p_amount > v_cfg.max_daily_no_kyc THEN
      RETURN jsonb_build_object('allowed', false, 'reason',
        format('Limite quotidienne atteinte (%s coins/jour sans KYC)', v_cfg.max_daily_no_kyc));
    END IF;
    IF v_user_data.withdrawn_this_week + p_amount > v_cfg.max_weekly_no_kyc THEN
      RETURN jsonb_build_object('allowed', false, 'reason',
        format('Limite hebdomadaire atteinte (%s coins/sem sans KYC)', v_cfg.max_weekly_no_kyc));
    END IF;
  END IF;

  -- Si gros montant : review manuelle nécessaire
  IF p_amount >= v_cfg.manual_review_above THEN
    v_review_needed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'review_needed', v_review_needed,
    'message', CASE WHEN v_review_needed
      THEN 'Retrait validé sous réserve de revue manuelle (24-48h)'
      ELSE 'Retrait autorisé' END
  );
END; $$;

-- 5. Trigger : enregistrer le cumul après chaque retrait Freemopay réussi
CREATE OR REPLACE FUNCTION update_user_withdrawal_counters()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.transaction_type = 'WITHDRAW'
     AND NEW.status = 'SUCCESS'
     AND (OLD.status IS NULL OR OLD.status != 'SUCCESS') THEN
    UPDATE user_profiles
      SET withdrawn_today = withdrawn_today + NEW.amount,
          withdrawn_this_week = withdrawn_this_week + NEW.amount,
          last_withdrawal_at = NOW()
      WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS withdrawal_counter_trg ON freemopay_transactions;
CREATE TRIGGER withdrawal_counter_trg
  AFTER INSERT OR UPDATE OF status ON freemopay_transactions
  FOR EACH ROW EXECUTE FUNCTION update_user_withdrawal_counters();

-- ───────── B. ANTI-FRAUD DETECTOR ─────────

-- 6. Table d'alertes admin
CREATE TABLE IF NOT EXISTS admin_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL,           -- 'high_winrate', 'win_streak', 'large_winnings', 'frequent_withdrawals'
  severity    TEXT NOT NULL DEFAULT 'medium',  -- 'low', 'medium', 'high', 'critical'
  title       TEXT NOT NULL,
  description TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON admin_alerts(resolved, created_at DESC) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_alerts_user ON admin_alerts(user_id);

ALTER TABLE admin_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_alerts_all ON admin_alerts;
CREATE POLICY sa_alerts_all ON admin_alerts FOR ALL USING (is_super_admin() OR is_admin());

-- 7. Fonction qui scanne les profils et crée des alertes
CREATE OR REPLACE FUNCTION scan_for_fraud_patterns()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_alerts_created INT := 0;
  v_user RECORD;
BEGIN
  -- Pattern 1 : Win rate > 80% avec >= 30 parties (anormal)
  FOR v_user IN
    SELECT id, username, games_played, total_wins,
           ROUND(total_wins::numeric / NULLIF(games_played, 0) * 100, 1) AS winrate
      FROM user_profiles
     WHERE games_played >= 30
       AND total_wins::numeric / NULLIF(games_played, 0) > 0.80
       AND NOT EXISTS (
         SELECT 1 FROM admin_alerts
         WHERE user_id = user_profiles.id
           AND alert_type = 'high_winrate'
           AND created_at > NOW() - INTERVAL '7 days'
       )
  LOOP
    INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
    VALUES (
      v_user.id, 'high_winrate', 'high',
      format('Taux de victoire anormalement haut : %s%%', v_user.winrate),
      format('Joueur %s : %s/%s victoires (%s%%). Possible exploit.',
        v_user.username, v_user.total_wins, v_user.games_played, v_user.winrate),
      jsonb_build_object('winrate', v_user.winrate, 'games', v_user.games_played, 'wins', v_user.total_wins)
    );
    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  -- Pattern 2 : Coins très élevés (top 1%)
  FOR v_user IN
    SELECT id, username, coins
      FROM user_profiles
     WHERE coins > 1000000  -- > 1M coins
       AND NOT EXISTS (
         SELECT 1 FROM admin_alerts
         WHERE user_id = user_profiles.id
           AND alert_type = 'large_winnings'
           AND created_at > NOW() - INTERVAL '3 days'
       )
  LOOP
    INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
    VALUES (
      v_user.id, 'large_winnings', 'medium',
      format('Solde élevé : %s coins', v_user.coins),
      format('Joueur %s a un solde de %s coins. À surveiller.', v_user.username, v_user.coins),
      jsonb_build_object('coins', v_user.coins)
    );
    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  -- Pattern 3 : Multiples retraits dans 24h (cumul > seuil)
  FOR v_user IN
    SELECT user_id, COUNT(*) AS nb_withdrawals, SUM(amount) AS total
      FROM freemopay_transactions
     WHERE transaction_type = 'WITHDRAW'
       AND status = 'SUCCESS'
       AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY user_id
    HAVING COUNT(*) >= 3 OR SUM(amount) > 100000
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM admin_alerts
      WHERE user_id = v_user.user_id
        AND alert_type = 'frequent_withdrawals'
        AND created_at > NOW() - INTERVAL '24 hours'
    ) THEN
      INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
      VALUES (
        v_user.user_id, 'frequent_withdrawals', 'high',
        format('%s retraits en 24h (total %s)', v_user.nb_withdrawals, v_user.total),
        'Multiples retraits rapprochés. Risque de blanchiment ou compte compromis.',
        jsonb_build_object('count', v_user.nb_withdrawals, 'total', v_user.total)
      );
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  RETURN v_alerts_created;
END; $$;

-- 8. Vue admin : alertes non résolues avec username
CREATE OR REPLACE VIEW admin_alerts_view AS
SELECT
  a.id, a.user_id, a.alert_type, a.severity, a.title, a.description,
  a.metadata, a.resolved, a.created_at, a.resolved_at,
  up.username, up.email, up.coins, up.kyc_verified
FROM admin_alerts a
LEFT JOIN user_profiles up ON up.id = a.user_id
ORDER BY a.resolved ASC, a.created_at DESC;

-- 9. RPC pour résoudre une alerte
CREATE OR REPLACE FUNCTION resolve_admin_alert(p_alert_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_super_admin() OR is_admin()) THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  UPDATE admin_alerts
    SET resolved = TRUE, resolved_at = NOW(), resolved_by = auth.uid()
    WHERE id = p_alert_id;
END; $$;

-- ───────── C. CONFIG HOUSE EDGE TRANSPARENTE ─────────
-- (Le edge mathématique des jeux est appliqué directement dans les formules.
--  Documenter dans les règles : "Taux de retour théorique : X%")

-- Pour Mines : edge actuel = 0% (formule linéaire). On peut appliquer un facteur 0.95 :
-- multiplicateur final = (0.50 + n * 1.00) * 0.95 → edge 5%
-- C'est à modifier dans la fonction mines_calc_multiplier (déjà existante)

-- Application optionnelle : décommenter pour activer 5% edge sur Mines
-- CREATE OR REPLACE FUNCTION mines_calc_multiplier(
--   p_safe_revealed INT, p_mines_count INT, p_grid_size INT DEFAULT 25
-- ) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
-- BEGIN
--   IF p_safe_revealed <= 0 THEN RETURN 1.0; END IF;
--   RETURN ROUND(((0.50 + p_safe_revealed * 1.00) * 0.95)::NUMERIC, 4);
-- END; $$;

-- ───────── VERIFICATION ─────────
SELECT 'withdrawal_config' AS item, COUNT(*) FROM withdrawal_config
UNION ALL SELECT 'admin_alerts', COUNT(*) FROM admin_alerts
UNION ALL SELECT 'kyc_columns', COUNT(*) FROM information_schema.columns
  WHERE table_name = 'user_profiles' AND column_name LIKE 'kyc%'
UNION ALL SELECT 'check_withdrawal_allowed exists',
  CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'check_withdrawal_allowed') THEN 1 ELSE 0 END;
