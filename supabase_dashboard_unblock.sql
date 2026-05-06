-- ============================================================
-- DASHBOARD UNBLOCK — Fix RLS + game stats
-- ============================================================
-- A executer APRES tous les autres fichiers SQL.
-- Idempotent.
--
-- Probleme resolu :
--   La table treasury_movements avait une policy RLS "using(false)"
--   qui bloquait TOUTE lecture (meme super_admin).
--   Resultat : Games, Treasury, Audit, Replay, UserDetail affichaient 0.
--
--   Aussi : user_profiles.games_played n'etait incremente que par Ludo v1.
--   Resultat : Overview "Parties jouees (total)" sous-evalue.
-- ============================================================

-- ============================================================
-- 1) RLS treasury_movements — autoriser lecture admin/super_admin
-- ============================================================

-- Drop toutes policies SELECT potentiellement bloquantes (par defensive)
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treasury_movements'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.treasury_movements', pol.policyname);
  END LOOP;
END $$;

-- Activer RLS si pas deja actif (idempotent)
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

-- Nouvelle policy : super_admin et admin peuvent lire toutes les lignes ;
-- chaque user peut lire ses propres mouvements (utile cote app mobile)
CREATE POLICY tm_admin_read ON public.treasury_movements
  FOR SELECT
  USING (
    public.is_super_admin()
    OR public.is_admin()
    OR auth.uid() = user_id
  );

-- ============================================================
-- 2) Idem pour treasury_transactions (legacy mais lu par certains scripts)
-- ============================================================
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'treasury_transactions'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.treasury_transactions', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tt_admin_read ON public.treasury_transactions
  FOR SELECT
  USING (
    public.is_super_admin()
    OR public.is_admin()
    OR auth.uid() = user_id
  );

-- ============================================================
-- 3) Trigger : maintenir games_played/total_wins/games_won
-- ============================================================
-- Chaque insertion dans treasury_movements met a jour les compteurs
-- du joueur cible. Comme treasury_place_bet insere systematiquement
-- une ligne 'loss_collect', games_played incremente a chaque mise.
-- Les payouts (mouvement 'payout') incrementent total_wins/games_won.

CREATE OR REPLACE FUNCTION public.bump_user_game_stats()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.movement_type = 'loss_collect' AND NEW.game_type <> 'system' THEN
    UPDATE public.user_profiles
      SET games_played = COALESCE(games_played, 0) + 1,
          last_seen = NOW()
      WHERE id = NEW.user_id;
  ELSIF NEW.movement_type = 'payout' AND NEW.game_type <> 'system' THEN
    UPDATE public.user_profiles
      SET total_wins  = COALESCE(total_wins, 0) + 1,
          games_won   = COALESCE(games_won, 0) + 1,
          last_seen   = NOW()
      WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bump_user_game_stats ON public.treasury_movements;
CREATE TRIGGER trg_bump_user_game_stats
  AFTER INSERT ON public.treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.bump_user_game_stats();

-- ============================================================
-- 4) BACKFILL retroactif des compteurs manquants
-- ============================================================
-- Recalcule games_played et total_wins pour TOUS les utilisateurs
-- a partir des mouvements existants. Idempotent : ecrase les valeurs.

WITH stats AS (
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE movement_type = 'loss_collect' AND game_type <> 'system') AS games,
    COUNT(*) FILTER (WHERE movement_type = 'payout'        AND game_type <> 'system') AS wins
  FROM public.treasury_movements
  WHERE user_id IS NOT NULL
  GROUP BY user_id
)
UPDATE public.user_profiles up
   SET games_played = s.games,
       total_wins   = s.wins,
       games_won    = s.wins
  FROM stats s
 WHERE up.id = s.user_id
   -- Ne touche pas si les valeurs actuelles sont deja superieures (legacy Ludo v1)
   AND (s.games > COALESCE(up.games_played, 0) OR s.wins > COALESCE(up.total_wins, 0));

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT
  'treasury_movements_rows'             AS item, (SELECT COUNT(*) FROM treasury_movements)::TEXT  AS value
UNION ALL SELECT
  'treasury_transactions_rows',         (SELECT COUNT(*) FROM treasury_transactions)::TEXT
UNION ALL SELECT
  'select_policies_treasury_movements', (SELECT string_agg(policyname, ', ')
                                          FROM pg_policies
                                         WHERE tablename = 'treasury_movements'
                                           AND cmd = 'SELECT')
UNION ALL SELECT
  'total_games_played',                 COALESCE(SUM(games_played), 0)::TEXT
                                          FROM user_profiles
UNION ALL SELECT
  'total_wins',                         COALESCE(SUM(total_wins), 0)::TEXT
                                          FROM user_profiles
UNION ALL SELECT
  'players_with_games',                 COUNT(*)::TEXT
                                          FROM user_profiles
                                         WHERE games_played > 0;
