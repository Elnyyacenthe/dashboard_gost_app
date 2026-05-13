-- ============================================================
-- RELINK : anciens crédits manuels admin → freemopay_tx
-- ============================================================
-- Pour les credits/refunds manuels effectues AVANT le fix
-- "admin_adjust_user_coins(p_ref_type, p_ref_id)", les entrees
-- wallet_ledger ont ref_type='admin' et ref_id=null.
-- Resultat : le diagnostic Finance ne trouve pas le lien et
-- continue d'afficher la transaction comme "non crediteee".
--
-- Ce script relie retroactivement ces entrees en se basant sur
-- la reference Freemopay incluse dans le texte de la raison
-- (format historique : "[FREEMOPAY <reference>] ..." ou
-- "[REFUND <reference>] ...").
-- ============================================================

-- ============================================================
-- A. DIAGNOSTIC : combien d'entrees a relier ?
-- ============================================================
WITH candidates AS (
  SELECT
    wl.id AS ledger_id,
    wl.user_id,
    wl.delta,
    wl.created_at,
    wl.metadata->>'reason' AS reason_text,
    ft.id AS freemopay_tx_id,
    ft.reference AS freemopay_ref
  FROM wallet_ledger wl
  JOIN freemopay_transactions ft
    ON ft.user_id = wl.user_id
   AND ABS(ft.amount) = ABS(wl.delta)
   AND (
     wl.metadata->>'reason' LIKE '%' || ft.reference || '%'
     OR wl.metadata->>'reason' LIKE '%FREEMOPAY ' || ft.reference || '%'
     OR wl.metadata->>'reason' LIKE '%REFUND ' || ft.reference || '%'
   )
  WHERE wl.reason = 'admin_adjustment'
    AND (wl.ref_type IS NULL OR wl.ref_type = 'admin')
    AND wl.ref_id IS NULL
)
SELECT
  COUNT(*) AS to_relink_count,
  COUNT(DISTINCT user_id) AS users_affected,
  SUM(ABS(delta)) AS total_amount
FROM candidates;

-- ============================================================
-- B. RELINK : update les wallet_ledger pour pointer vers freemopay_tx
-- ============================================================
-- A executer apres avoir verifie le diagnostic A.
-- DECOMMENTER POUR EXECUTER :
/*
WITH matched AS (
  SELECT DISTINCT ON (wl.id)
    wl.id AS ledger_id,
    ft.id AS freemopay_tx_id
  FROM wallet_ledger wl
  JOIN freemopay_transactions ft
    ON ft.user_id = wl.user_id
   AND ABS(ft.amount) = ABS(wl.delta)
   AND (
     wl.metadata->>'reason' LIKE '%' || ft.reference || '%'
     OR wl.metadata->>'reason' LIKE '%FREEMOPAY ' || ft.reference || '%'
     OR wl.metadata->>'reason' LIKE '%REFUND ' || ft.reference || '%'
   )
  WHERE wl.reason = 'admin_adjustment'
    AND (wl.ref_type IS NULL OR wl.ref_type = 'admin')
    AND wl.ref_id IS NULL
  ORDER BY wl.id, ft.created_at DESC  -- prend la freemopay_tx la plus recente si plusieurs match
)
UPDATE wallet_ledger wl
   SET ref_type = 'freemopay_tx',
       ref_id   = m.freemopay_tx_id::text,
       metadata = COALESCE(wl.metadata, '{}'::jsonb) || jsonb_build_object(
         'relinked_at', NOW(),
         'relinked_reason', 'retroactive_link_to_freemopay_tx'
       )
  FROM matched m
 WHERE wl.id = m.ledger_id;

SELECT 'relinked_count' AS check_name, COUNT(*)::TEXT AS value
FROM wallet_ledger
WHERE ref_type = 'freemopay_tx'
  AND reason = 'admin_adjustment'
  AND metadata ? 'relinked_at';
*/
