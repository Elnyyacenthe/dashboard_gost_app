-- ============================================================
-- DEUX TRESORERIES SEPAREES
-- 1. game_treasury  : pot du jeu (solo) - paie les gagnants
-- 2. admin_treasury : profits super_admin (commissions multi)
-- ============================================================

-- ───────── 1. CAISSE DU JEU (liquidités solo) ─────────
CREATE TABLE IF NOT EXISTS game_treasury (
  id              INT PRIMARY KEY DEFAULT 1,
  balance         BIGINT NOT NULL DEFAULT 0,
  total_received  BIGINT NOT NULL DEFAULT 0,  -- mises perdues par joueurs
  total_paid_out  BIGINT NOT NULL DEFAULT 0,  -- gains payés aux joueurs
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT game_single_row CHECK (id = 1)
);

INSERT INTO game_treasury (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ───────── 2. CAISSE SUPER ADMIN (profits) ─────────
CREATE TABLE IF NOT EXISTS admin_treasury (
  id              INT PRIMARY KEY DEFAULT 1,
  balance         BIGINT NOT NULL DEFAULT 0,
  total_earned    BIGINT NOT NULL DEFAULT 0,    -- commissions reçues
  total_withdrawn BIGINT NOT NULL DEFAULT 0,    -- retraits effectués
  total_deposited BIGINT NOT NULL DEFAULT 0,    -- dépôts manuels (renflouage)
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT admin_single_row CHECK (id = 1)
);

INSERT INTO admin_treasury (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ───────── 3. HISTORIQUE DES TRANSACTIONS ─────────
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_type TEXT NOT NULL CHECK (treasury_type IN ('game', 'admin')),
  type          TEXT NOT NULL CHECK (type IN (
    'earning',          -- gain (mise perdue ou commission)
    'payout',           -- paiement à un joueur (solo gagnant)
    'commission',       -- commission multijoueur
    'withdrawal',       -- retrait super_admin
    'deposit',          -- dépôt manuel super_admin
    'transfer_to_game', -- super_admin renfloue le pot du jeu
    'transfer_to_admin' -- super_admin retire du pot du jeu
  )),
  amount        BIGINT NOT NULL,
  game_type     TEXT,                              -- 'mines', 'cora', 'ludo', etc.
  source        TEXT,                              -- description courte
  description   TEXT,                              -- libre
  admin_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_treasury_type ON treasury_transactions(treasury_type);
CREATE INDEX IF NOT EXISTS idx_tx_type          ON treasury_transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_date          ON treasury_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_game          ON treasury_transactions(game_type);

-- ───────── 4. RLS — accès super_admin uniquement ─────────
ALTER TABLE game_treasury         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_treasury        ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
  RETURN v_role = 'super_admin';
END;
$$;

DROP POLICY IF EXISTS sa_game_select ON game_treasury;
CREATE POLICY sa_game_select ON game_treasury FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS sa_game_update ON game_treasury;
CREATE POLICY sa_game_update ON game_treasury FOR UPDATE USING (is_super_admin());

DROP POLICY IF EXISTS sa_admin_select ON admin_treasury;
CREATE POLICY sa_admin_select ON admin_treasury FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS sa_admin_update ON admin_treasury;
CREATE POLICY sa_admin_update ON admin_treasury FOR UPDATE USING (is_super_admin());

DROP POLICY IF EXISTS sa_tx_select ON treasury_transactions;
CREATE POLICY sa_tx_select ON treasury_transactions FOR SELECT USING (is_super_admin());
DROP POLICY IF EXISTS sa_tx_insert ON treasury_transactions;
CREATE POLICY sa_tx_insert ON treasury_transactions FOR INSERT
  WITH CHECK (is_super_admin() OR auth.role() = 'service_role');

-- ============================================================
-- 5. FONCTIONS METIER
-- ============================================================

-- Mise perdue par un joueur en SOLO → va dans la caisse du jeu
CREATE OR REPLACE FUNCTION game_treasury_collect_loss(
  p_amount BIGINT, p_game_type TEXT, p_user_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;
  UPDATE game_treasury
    SET balance = balance + p_amount,
        total_received = total_received + p_amount,
        updated_at = NOW()
    WHERE id = 1;
  INSERT INTO treasury_transactions (treasury_type, type, amount, game_type, source, description, user_id, metadata)
  VALUES ('game', 'earning', p_amount, p_game_type, 'solo_loss', p_description, p_user_id, p_metadata);
END; $$;

-- Gain payé à un joueur en SOLO → sort de la caisse du jeu
CREATE OR REPLACE FUNCTION game_treasury_pay_win(
  p_amount BIGINT, p_game_type TEXT, p_user_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;
  UPDATE game_treasury
    SET balance = balance - p_amount,
        total_paid_out = total_paid_out + p_amount,
        updated_at = NOW()
    WHERE id = 1;
  INSERT INTO treasury_transactions (treasury_type, type, amount, game_type, source, description, user_id, metadata)
  VALUES ('game', 'payout', p_amount, p_game_type, 'solo_win', p_description, p_user_id, p_metadata);
END; $$;

-- Commission multijoueur → 10% ou 15% selon le jeu, va à admin
CREATE OR REPLACE FUNCTION admin_treasury_take_commission(
  p_pot_amount BIGINT, p_game_type TEXT, p_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rate NUMERIC;
  v_commission BIGINT;
BEGIN
  -- 15% pour ludo, dames (checkers), fantasy
  -- 10% pour cora, blackjack, roulette, coinflip, solitaire
  v_rate := CASE p_game_type
    WHEN 'ludo'      THEN 0.15
    WHEN 'checkers'  THEN 0.15
    WHEN 'dames'     THEN 0.15
    WHEN 'fantasy'   THEN 0.15
    WHEN 'fpl'       THEN 0.15
    WHEN 'cora'      THEN 0.10
    WHEN 'blackjack' THEN 0.10
    WHEN 'roulette'  THEN 0.10
    WHEN 'coinflip'  THEN 0.10
    WHEN 'solitaire' THEN 0.10
    ELSE 0.10
  END;
  v_commission := FLOOR(p_pot_amount * v_rate);
  IF v_commission <= 0 THEN RETURN 0; END IF;

  UPDATE admin_treasury
    SET balance = balance + v_commission,
        total_earned = total_earned + v_commission,
        updated_at = NOW()
    WHERE id = 1;

  INSERT INTO treasury_transactions (treasury_type, type, amount, game_type, source, description, user_id, metadata)
  VALUES ('admin', 'commission', v_commission, p_game_type, 'multi_commission',
          format('Commission %s%% sur pot %s', (v_rate*100)::int, p_pot_amount), p_user_id, p_metadata);

  RETURN v_commission;
END; $$;

-- Retrait super_admin (depuis admin_treasury)
CREATE OR REPLACE FUNCTION admin_treasury_withdraw(
  p_amount BIGINT, p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance BIGINT; v_admin UUID := auth.uid();
BEGIN
  IF NOT is_super_admin() THEN RETURN jsonb_build_object('success', false, 'error', 'Accès refusé'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide'); END IF;

  SELECT balance INTO v_balance FROM admin_treasury WHERE id = 1;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solde insuffisant');
  END IF;

  UPDATE admin_treasury
    SET balance = balance - p_amount,
        total_withdrawn = total_withdrawn + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  INSERT INTO treasury_transactions (treasury_type, type, amount, source, description, admin_id)
  VALUES ('admin', 'withdrawal', p_amount, 'manual', p_description, v_admin);

  RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_amount);
END; $$;

-- Dépôt super_admin (renfloue admin_treasury)
CREATE OR REPLACE FUNCTION admin_treasury_deposit(
  p_amount BIGINT, p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin UUID := auth.uid();
BEGIN
  IF NOT is_super_admin() THEN RETURN jsonb_build_object('success', false, 'error', 'Accès refusé'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide'); END IF;

  UPDATE admin_treasury
    SET balance = balance + p_amount,
        total_deposited = total_deposited + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  INSERT INTO treasury_transactions (treasury_type, type, amount, source, description, admin_id)
  VALUES ('admin', 'deposit', p_amount, 'manual', p_description, v_admin);

  RETURN jsonb_build_object('success', true);
END; $$;

-- Transfert admin_treasury → game_treasury (renfloue le pot du jeu)
CREATE OR REPLACE FUNCTION treasury_transfer_admin_to_game(
  p_amount BIGINT, p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin_balance BIGINT; v_admin UUID := auth.uid();
BEGIN
  IF NOT is_super_admin() THEN RETURN jsonb_build_object('success', false, 'error', 'Accès refusé'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide'); END IF;

  SELECT balance INTO v_admin_balance FROM admin_treasury WHERE id = 1;
  IF v_admin_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solde admin insuffisant');
  END IF;

  UPDATE admin_treasury
    SET balance = balance - p_amount, updated_at = NOW() WHERE id = 1;
  UPDATE game_treasury
    SET balance = balance + p_amount, updated_at = NOW() WHERE id = 1;

  INSERT INTO treasury_transactions (treasury_type, type, amount, source, description, admin_id)
  VALUES ('admin', 'transfer_to_game', p_amount, 'transfer', p_description, v_admin);

  RETURN jsonb_build_object('success', true);
END; $$;

-- Transfert game_treasury → admin_treasury (super_admin retire du pot)
CREATE OR REPLACE FUNCTION treasury_transfer_game_to_admin(
  p_amount BIGINT, p_description TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game_balance BIGINT; v_admin UUID := auth.uid();
BEGIN
  IF NOT is_super_admin() THEN RETURN jsonb_build_object('success', false, 'error', 'Accès refusé'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide'); END IF;

  SELECT balance INTO v_game_balance FROM game_treasury WHERE id = 1;
  IF v_game_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Caisse jeu insuffisante');
  END IF;

  UPDATE game_treasury
    SET balance = balance - p_amount, updated_at = NOW() WHERE id = 1;
  UPDATE admin_treasury
    SET balance = balance + p_amount, total_earned = total_earned + p_amount, updated_at = NOW() WHERE id = 1;

  INSERT INTO treasury_transactions (treasury_type, type, amount, source, description, admin_id)
  VALUES ('game', 'transfer_to_admin', p_amount, 'transfer', p_description, v_admin);

  RETURN jsonb_build_object('success', true);
END; $$;

-- ============================================================
-- 6. TRIGGERS AUTO sur les jeux SOLO
-- (Les jeux multijoueurs appelleront admin_treasury_take_commission via leurs RPC existantes)
-- ============================================================

-- Mines : solo vs machine
CREATE OR REPLACE FUNCTION mines_treasury_hook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Joueur perd → mise va dans game_treasury
  IF NEW.status = 'lost' AND OLD.status = 'active' THEN
    PERFORM game_treasury_collect_loss(
      NEW.bet_amount, 'mines', NEW.user_id,
      'Mines: joueur a perdu',
      jsonb_build_object('session_id', NEW.id, 'mines_count', NEW.mines_count)
    );
  -- Joueur cash out → on paie depuis game_treasury (montant = potentiel - mise)
  ELSIF NEW.status = 'cashed_out' AND OLD.status = 'active' THEN
    -- On ne paie que le profit (gain - mise initiale, qui est déjà déduite du wallet)
    PERFORM game_treasury_pay_win(
      NEW.current_potential_win, 'mines', NEW.user_id,
      'Mines: joueur a cash out',
      jsonb_build_object('session_id', NEW.id, 'multiplier', NEW.current_multiplier)
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS mines_treasury_trg ON mines_sessions;
CREATE TRIGGER mines_treasury_trg
  AFTER UPDATE OF status ON mines_sessions
  FOR EACH ROW EXECUTE FUNCTION mines_treasury_hook();

-- ============================================================
-- 7. CLEANUP : ancienne table project_treasury si elle existe
-- ============================================================
DROP TABLE IF EXISTS project_treasury CASCADE;
DROP FUNCTION IF EXISTS treasury_add_earning CASCADE;
DROP FUNCTION IF EXISTS treasury_withdraw CASCADE;
DROP FUNCTION IF EXISTS mines_feed_treasury CASCADE;

-- ============================================================
-- TESTS
-- ============================================================
-- SELECT * FROM game_treasury;
-- SELECT * FROM admin_treasury;
-- SELECT admin_treasury_take_commission(1000, 'ludo');  -- => 150 commission
-- SELECT * FROM treasury_transactions ORDER BY created_at DESC LIMIT 10;
