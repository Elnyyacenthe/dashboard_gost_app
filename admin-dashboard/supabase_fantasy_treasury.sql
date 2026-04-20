-- ============================================================
-- FANTASY PREMIER LEAGUE — Entry Fee + Commission 15%
-- A executer APRES supabase_treasury.sql + supabase_treasury_hooks.sql
-- ============================================================
-- Ajoute :
--  1. Colonne entry_fee + total_pot + status sur fantasy_leagues
--  2. RPC pour rejoindre une ligue avec mise
--  3. RPC pour distribuer le pot en fin de saison (avec commission 15%)
--  4. Trigger sur changement status → finished pour prelever commission
-- ============================================================

-- ───────── 1. Colonnes nouvelles sur fantasy_leagues ─────────
ALTER TABLE fantasy_leagues
  ADD COLUMN IF NOT EXISTS entry_fee   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_pot   BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'finished', 'cancelled')),
  ADD COLUMN IF NOT EXISTS winner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- ───────── 2. RPC : rejoindre une ligue avec mise ─────────
CREATE OR REPLACE FUNCTION fantasy_join_league_with_fee(
  p_league_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_fee INT;
  v_status TEXT;
  v_coins INT;
  v_existing UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Non authentifie');
  END IF;

  -- Verifier que la ligue existe et est active
  SELECT entry_fee, status INTO v_fee, v_status
    FROM fantasy_leagues WHERE id = p_league_id;
  IF v_fee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ligue introuvable');
  END IF;
  IF v_status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cette ligue est terminee');
  END IF;

  -- Verifier qu'on n'est pas deja membre
  SELECT id INTO v_existing FROM fantasy_league_members
    WHERE league_id = p_league_id AND user_id = v_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vous etes deja membre');
  END IF;

  -- Si payante : verifier solde et debiter
  IF v_fee > 0 THEN
    SELECT coins INTO v_coins FROM user_profiles WHERE id = v_user_id;
    IF v_coins IS NULL OR v_coins < v_fee THEN
      RETURN jsonb_build_object('success', false, 'error', 'Solde insuffisant');
    END IF;
    UPDATE user_profiles SET coins = coins - v_fee WHERE id = v_user_id;
    UPDATE fantasy_leagues SET total_pot = total_pot + v_fee WHERE id = p_league_id;
  END IF;

  -- Inscrire le membre
  INSERT INTO fantasy_league_members (league_id, user_id)
  VALUES (p_league_id, v_user_id);

  RETURN jsonb_build_object('success', true, 'fee_paid', v_fee);
END; $$;

-- ───────── 3. RPC : terminer une ligue + distribuer ─────────
CREATE OR REPLACE FUNCTION fantasy_finish_league(
  p_league_id UUID,
  p_winner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_creator UUID;
  v_pot BIGINT;
  v_commission BIGINT;
  v_winner_share BIGINT;
BEGIN
  -- Seul le createur ou super_admin peut terminer
  SELECT creator_id, total_pot INTO v_creator, v_pot
    FROM fantasy_leagues WHERE id = p_league_id;
  IF v_creator IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ligue introuvable');
  END IF;
  IF v_user_id != v_creator AND NOT is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Seul le createur peut terminer');
  END IF;

  -- Verifier que le winner est membre
  IF NOT EXISTS (
    SELECT 1 FROM fantasy_league_members
    WHERE league_id = p_league_id AND user_id = p_winner_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Le gagnant doit etre membre');
  END IF;

  -- Marquer comme finished (le trigger prelevera la commission)
  UPDATE fantasy_leagues
    SET status = 'finished',
        winner_id = p_winner_id,
        finished_at = NOW()
    WHERE id = p_league_id;

  -- Distribuer le pot au gagnant (apres commission 15%)
  IF v_pot > 0 THEN
    v_commission := FLOOR(v_pot * 0.15);
    v_winner_share := v_pot - v_commission;

    -- Crediter le gagnant
    UPDATE user_profiles SET coins = coins + v_winner_share WHERE id = p_winner_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pot', v_pot,
    'winner_share', v_winner_share,
    'commission', v_commission
  );
END; $$;

-- ───────── 4. Trigger fantasy_leagues → admin_treasury commission ─────────
CREATE OR REPLACE FUNCTION fantasy_treasury_hook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'finished' AND OLD.status != 'finished' AND NEW.total_pot > 0 THEN
    PERFORM admin_treasury_take_commission(
      NEW.total_pot, 'fantasy', NEW.winner_id,
      jsonb_build_object('league_id', NEW.id, 'league_name', NEW.name)
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS fantasy_treasury_trg ON fantasy_leagues;
CREATE TRIGGER fantasy_treasury_trg
  AFTER UPDATE OF status ON fantasy_leagues
  FOR EACH ROW EXECUTE FUNCTION fantasy_treasury_hook();

-- ───────── 5. Verification ─────────
SELECT 'fantasy_treasury_trg' AS name, tgenabled FROM pg_trigger WHERE tgname = 'fantasy_treasury_trg';
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'fantasy_leagues' AND column_name IN ('entry_fee', 'total_pot', 'status', 'winner_id');
