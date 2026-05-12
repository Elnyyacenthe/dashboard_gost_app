-- ============================================================
-- REMOVE SYSTEM OPENINGS — Nettoyage comptable
-- ============================================================
-- Supprime les transactions SYSTEM_* (opening balance / seed
-- de réconciliation) qui embrouillent la comptabilité car elles
-- ne correspondent pas à de l'argent réel entré via Mobile Money.
--
-- Effet :
--   - Retire les freemopay_transactions SYSTEM_*
--   - Retire les wallet_ledger entries 'opening_balance' / ref_type='system'
--   - Ajuste user_profiles.coins pour rester cohérent
--   - Installe un trigger qui BLOQUE les futurs inserts SYSTEM_*
--
-- TOUT en transaction atomique : si une étape échoue, rollback.
-- ============================================================

-- ============================================================
-- PARTIE A — DIAGNOSTIC (à exécuter en premier pour voir ce qui sera touché)
-- ============================================================

-- A.1 : Combien de transactions SYSTEM_* existent et leur montant total
SELECT
  'A1_freemopay_system_txs' AS check_name,
  COUNT(*)::TEXT AS count,
  COALESCE(SUM(amount), 0)::TEXT AS total_amount,
  COALESCE(SUM(CASE WHEN transaction_type='DEPOSIT' THEN amount ELSE -amount END), 0)::TEXT AS net_impact
FROM freemopay_transactions
WHERE reference LIKE 'SYSTEM_%' OR payer_or_receiver = 'system';

-- A.2 : Liste détaillée
SELECT
  reference,
  payer_or_receiver,
  transaction_type,
  amount,
  status,
  user_id,
  (SELECT username FROM user_profiles WHERE id = ft.user_id) AS username,
  message,
  created_at
FROM freemopay_transactions ft
WHERE reference LIKE 'SYSTEM_%' OR payer_or_receiver = 'system'
ORDER BY created_at DESC;

-- A.3 : Wallet_ledger entries d'opening balance
SELECT
  'A3_wallet_ledger_openings' AS check_name,
  COUNT(*)::TEXT AS count,
  COALESCE(SUM(delta), 0)::TEXT AS total_delta
FROM wallet_ledger
WHERE reason = 'opening_balance' AND ref_type = 'system';

-- ============================================================
-- PARTIE B — NETTOYAGE (à exécuter APRES avoir vérifié le diagnostic)
-- ============================================================
-- DECOMMENTER LE BLOC CI-DESSOUS POUR EXECUTER LE NETTOYAGE.
-- Tout est wrappé dans une transaction : tout ou rien.
-- ============================================================

/*
BEGIN;

-- B.1 : Archiver d'abord dans une table dédiée (au cas où)
CREATE TABLE IF NOT EXISTS public.system_transactions_archive (
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_table   TEXT NOT NULL,
  payload        JSONB NOT NULL
);

-- B.2 : Archiver les freemopay_transactions SYSTEM_*
INSERT INTO system_transactions_archive (source_table, payload)
SELECT 'freemopay_transactions', to_jsonb(ft.*)
FROM freemopay_transactions ft
WHERE ft.reference LIKE 'SYSTEM_%' OR ft.payer_or_receiver = 'system';

-- B.3 : Archiver les wallet_ledger opening_balance
INSERT INTO system_transactions_archive (source_table, payload)
SELECT 'wallet_ledger', to_jsonb(wl.*)
FROM wallet_ledger wl
WHERE wl.reason = 'opening_balance' AND wl.ref_type = 'system';

-- B.4 : Ajuster user_profiles.coins pour annuler les opening balances
-- (sinon ledger.sum() ne matchera plus coins après le delete)
UPDATE user_profiles up
   SET coins = GREATEST(0, coins - (
     SELECT COALESCE(SUM(delta), 0)
     FROM wallet_ledger wl
     WHERE wl.user_id = up.id
       AND wl.reason = 'opening_balance'
       AND wl.ref_type = 'system'
   ))
 WHERE EXISTS (
   SELECT 1 FROM wallet_ledger wl
   WHERE wl.user_id = up.id
     AND wl.reason = 'opening_balance'
     AND wl.ref_type = 'system'
 );

-- B.5 : Supprimer les wallet_ledger entries
DELETE FROM wallet_ledger
WHERE reason = 'opening_balance' AND ref_type = 'system';

-- B.6 : Supprimer les freemopay_transactions SYSTEM_*
DELETE FROM freemopay_transactions
WHERE reference LIKE 'SYSTEM_%' OR payer_or_receiver = 'system';

COMMIT;
*/

-- ============================================================
-- PARTIE C — TRIGGER ANTI-FUTUR (à exécuter toujours, idempotent)
-- ============================================================
-- Empêche tout futur insert d'une transaction SYSTEM_* ou avec
-- payer_or_receiver = 'system' qui ne soit pas explicitement
-- voulue (la fonction wallet_ledger_seed_opening_balances ne
-- pourra plus en créer).
-- ============================================================

CREATE OR REPLACE FUNCTION block_system_transactions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference LIKE 'SYSTEM_%' OR NEW.payer_or_receiver = 'system' THEN
    RAISE EXCEPTION
      'SYSTEM transactions are no longer allowed. Cash must come from real Mobile Money deposits/withdrawals only. Reference: %, Payer: %',
      NEW.reference, NEW.payer_or_receiver
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS block_system_tx_trg ON freemopay_transactions;
CREATE TRIGGER block_system_tx_trg
  BEFORE INSERT ON freemopay_transactions
  FOR EACH ROW
  EXECUTE FUNCTION block_system_transactions();

-- Idem pour wallet_ledger : empêche futurs 'opening_balance' / ref_type='system'
CREATE OR REPLACE FUNCTION block_system_ledger_entries()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason = 'opening_balance' OR NEW.ref_type = 'system' THEN
    RAISE EXCEPTION
      'SYSTEM ledger entries are no longer allowed. Reason: %, Ref type: %',
      NEW.reason, NEW.ref_type
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS block_system_ledger_trg ON wallet_ledger;
CREATE TRIGGER block_system_ledger_trg
  BEFORE INSERT ON wallet_ledger
  FOR EACH ROW
  EXECUTE FUNCTION block_system_ledger_entries();

-- ============================================================
-- PARTIE D — VERIFICATION FINALE
-- ============================================================

SELECT
  'D1_remaining_system_freemopay' AS check_name,
  COUNT(*)::TEXT AS count
FROM freemopay_transactions
WHERE reference LIKE 'SYSTEM_%' OR payer_or_receiver = 'system'
UNION ALL SELECT
  'D2_remaining_system_ledger',
  COUNT(*)::TEXT
FROM wallet_ledger
WHERE reason = 'opening_balance' OR ref_type = 'system'
UNION ALL SELECT
  'D3_triggers_installed',
  COUNT(*)::TEXT
FROM pg_trigger
WHERE tgname IN ('block_system_tx_trg', 'block_system_ledger_trg')
UNION ALL SELECT
  'D4_archive_table_exists',
  CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'system_transactions_archive')
       THEN '1' ELSE '0' END;
