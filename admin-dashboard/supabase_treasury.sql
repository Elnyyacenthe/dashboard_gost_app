-- ============================================================
-- PROJECT TREASURY — Caisse des profits du fondateur
-- Accessible UNIQUEMENT par super_admin
-- ============================================================

-- 1. Table trésorerie (une seule ligne, id fixe)
CREATE TABLE IF NOT EXISTS project_treasury (
  id              INT PRIMARY KEY DEFAULT 1,
  balance         BIGINT NOT NULL DEFAULT 0,
  total_earned    BIGINT NOT NULL DEFAULT 0,
  total_withdrawn BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Ligne initiale
INSERT INTO project_treasury (id, balance, total_earned, total_withdrawn)
VALUES (1, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Historique des transactions
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('earning', 'withdrawal')),
  amount      BIGINT NOT NULL,
  source      TEXT NOT NULL,  -- ex: 'mines_loss', 'aviator_crash', 'manual_withdraw'
  description TEXT,
  admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- pour les retraits
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- pour les gains (joueur qui a perdu)
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treasury_tx_type ON treasury_transactions(type);
CREATE INDEX IF NOT EXISTS idx_treasury_tx_date ON treasury_transactions(created_at DESC);

-- 3. RLS — uniquement super_admin peut lire/modifier
ALTER TABLE project_treasury ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transactions ENABLE ROW LEVEL SECURITY;

-- Helper : fonction is_super_admin (si pas déjà créée)
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN FALSE; END IF;
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid();
  RETURN v_role = 'super_admin';
END;
$$;

-- Policies treasury
DROP POLICY IF EXISTS "super_admin_read_treasury" ON project_treasury;
CREATE POLICY "super_admin_read_treasury"
  ON project_treasury FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS "super_admin_update_treasury" ON project_treasury;
CREATE POLICY "super_admin_update_treasury"
  ON project_treasury FOR UPDATE
  USING (is_super_admin());

-- Policies transactions
DROP POLICY IF EXISTS "super_admin_read_treasury_tx" ON treasury_transactions;
CREATE POLICY "super_admin_read_treasury_tx"
  ON treasury_transactions FOR SELECT
  USING (is_super_admin());

DROP POLICY IF EXISTS "service_role_insert_treasury_tx" ON treasury_transactions;
CREATE POLICY "service_role_insert_treasury_tx"
  ON treasury_transactions FOR INSERT
  WITH CHECK (is_super_admin() OR auth.role() = 'service_role');

-- 4. Fonction pour ajouter un gain à la trésorerie
CREATE OR REPLACE FUNCTION treasury_add_earning(
  p_amount BIGINT,
  p_source TEXT,
  p_description TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;

  UPDATE project_treasury
    SET balance = balance + p_amount,
        total_earned = total_earned + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  INSERT INTO treasury_transactions (type, amount, source, description, user_id, metadata)
  VALUES ('earning', p_amount, p_source, p_description, p_user_id, p_metadata);
END;
$$;

-- 5. Fonction de retrait (super_admin uniquement)
CREATE OR REPLACE FUNCTION treasury_withdraw(
  p_amount BIGINT,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_admin_id UUID := auth.uid();
BEGIN
  -- Vérifier que l'appelant est super_admin
  IF NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Accès refusé');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Montant invalide');
  END IF;

  -- Vérifier le solde
  SELECT balance INTO v_balance FROM project_treasury WHERE id = 1;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solde insuffisant');
  END IF;

  -- Débiter
  UPDATE project_treasury
    SET balance = balance - p_amount,
        total_withdrawn = total_withdrawn + p_amount,
        updated_at = NOW()
    WHERE id = 1;

  -- Enregistrer la transaction
  INSERT INTO treasury_transactions (type, amount, source, description, admin_id)
  VALUES ('withdrawal', p_amount, 'manual_withdraw', p_description, v_admin_id);

  RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_amount);
END;
$$;

-- ============================================================
-- 6. OPTIONNEL : trigger auto sur mines pour alimenter treasury
-- Quand un joueur perd aux mines, sa mise va dans la caisse
-- ============================================================
CREATE OR REPLACE FUNCTION mines_feed_treasury()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Déclenché quand status passe de 'active' à 'lost'
  IF NEW.status = 'lost' AND OLD.status = 'active' THEN
    PERFORM treasury_add_earning(
      NEW.bet_amount,
      'mines_loss',
      'Joueur a perdu aux mines',
      NEW.user_id,
      jsonb_build_object('session_id', NEW.id, 'mines_count', NEW.mines_count)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mines_treasury_trigger ON mines_sessions;
CREATE TRIGGER mines_treasury_trigger
  AFTER UPDATE OF status ON mines_sessions
  FOR EACH ROW
  EXECUTE FUNCTION mines_feed_treasury();

-- ============================================================
-- Test manuel
-- ============================================================
-- SELECT treasury_add_earning(500, 'test', 'test earning');
-- SELECT * FROM project_treasury;
-- SELECT * FROM treasury_transactions ORDER BY created_at DESC LIMIT 10;
