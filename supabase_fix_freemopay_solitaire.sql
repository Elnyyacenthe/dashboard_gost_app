-- ============================================================
-- FIX : Freemopay RLS + verification Solitaire RPC
-- ============================================================
-- Probleme 1 : Les transactions Mobile Money n'apparaissent pas dans
-- le dashboard car la RLS de freemopay_transactions n'autorise QUE
-- super_admin a voir les transactions des autres users. Si admin/
-- moderator se connectent, ils ne voient que les leurs.
--
-- Probleme 2 : Les gains Solitaire n'apparaissent pas. Soit la
-- migration solitaire_treasury_migration.sql n'a pas ete appliquee,
-- soit aucune partie n'a ete jouee.
-- ============================================================

-- ============================================================
-- PARTIE A — DIAGNOSTIC (a executer en 1er pour voir l'etat)
-- ============================================================

-- A.1 : Qui suis-je ? (utile pour comprendre ce que vous voyez)
SELECT
  'YOUR_USER'            AS check_name,
  auth.uid()::TEXT       AS auth_uid,
  (SELECT username FROM user_profiles WHERE id = auth.uid()) AS username,
  (SELECT role FROM user_profiles WHERE id = auth.uid())     AS role;

-- A.2 : Combien de transactions Mobile Money existent au total ?
SELECT
  'FREEMOPAY_TOTAL'      AS check_name,
  COUNT(*)::TEXT         AS value
FROM freemopay_transactions;

-- A.3 : Repartition par statut
SELECT
  'FREEMOPAY_BY_STATUS'  AS check_name,
  status,
  transaction_type,
  COUNT(*)               AS count,
  SUM(amount)::TEXT      AS sum_amount
FROM freemopay_transactions
GROUP BY status, transaction_type
ORDER BY status, transaction_type;

-- A.4 : RLS actuelle sur freemopay_transactions
SELECT
  'FREEMOPAY_POLICIES'   AS check_name,
  policyname,
  cmd,
  permissive,
  qual::TEXT             AS using_clause
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'freemopay_transactions';

-- A.5 : Mouvements treasury pour Solitaire
SELECT
  'SOLITAIRE_MOVEMENTS'  AS check_name,
  movement_type,
  COUNT(*)               AS count,
  COALESCE(SUM(amount), 0)::TEXT AS sum_amount
FROM treasury_movements
WHERE game_type IN ('solitaire', 'solitaire_multi')
GROUP BY movement_type;

-- A.6 : Les RPC Solitaire existent-elles ?
SELECT
  'SOLITAIRE_RPCS'       AS check_name,
  proname                AS function_name,
  '1'                    AS exists
FROM pg_proc
WHERE proname IN ('solitaire_place_bet', 'solitaire_payout', 'apply_game_payout', 'treasury_place_bet');

-- ============================================================
-- PARTIE B — FIX RLS freemopay_transactions
-- ============================================================
-- Etend la lecture aux admin (en plus de super_admin et du user lui-meme).
-- Conserve le verrouillage en INSERT/UPDATE/DELETE (que les webhooks
-- via service_role peuvent ecrire).

-- Drop toutes policies SELECT existantes
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'freemopay_transactions'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.freemopay_transactions', pol.policyname);
  END LOOP;
END $$;

-- Nouvelle policy SELECT : self OR admin OR super_admin
CREATE POLICY freemopay_select_self_or_admin
  ON public.freemopay_transactions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR COALESCE(
         (SELECT role FROM public.user_profiles WHERE id = auth.uid()),
         ''
       ) IN ('admin', 'super_admin')
  );

-- ============================================================
-- PARTIE C — Idem pour wallet_ledger (souvent meme symptome)
-- ============================================================
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wallet_ledger'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.wallet_ledger', pol.policyname);
  END LOOP;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  IF to_regclass('public.wallet_ledger') IS NOT NULL THEN
    EXECUTE $sql$
      CREATE POLICY wl_select_self_or_admin
        ON public.wallet_ledger
        FOR SELECT
        TO authenticated
        USING (
          user_id = auth.uid()
          OR COALESCE(
               (SELECT role FROM public.user_profiles WHERE id = auth.uid()),
               ''
             ) IN ('admin', 'super_admin')
        )
    $sql$;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- PARTIE D — VERIFICATION APRES FIX
-- ============================================================
-- Refait le compte avec la nouvelle policy active (vous devriez
-- maintenant voir tous les enregistrements).

SELECT
  'AFTER_FIX_freemopay_visible'  AS check_name,
  COUNT(*)::TEXT                  AS visible_to_you
FROM freemopay_transactions
UNION ALL SELECT
  'AFTER_FIX_solitaire_movements',
  COUNT(*)::TEXT
FROM treasury_movements
WHERE game_type IN ('solitaire', 'solitaire_multi')
UNION ALL SELECT
  'AFTER_FIX_solitaire_rpcs_exist',
  COUNT(*)::TEXT
FROM pg_proc
WHERE proname IN ('solitaire_place_bet', 'solitaire_payout');
