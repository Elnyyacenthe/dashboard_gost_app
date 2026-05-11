-- ============================================================
-- DIAGNOSTIC PRECIS : signatures Solitaire RPCs
-- ============================================================
-- L'app mobile appelle solitaire_payout(session_id, score, won, moves)
-- — 4 parametres. Cette version est dans solitaire_v2_anticheat.sql.
-- Si seule la V2 a 3 parametres existe, l'appel echoue → 0 mouvement.
-- ============================================================

SELECT
  proname                          AS function_name,
  pg_get_function_arguments(oid)   AS signature,
  CASE
    WHEN proname = 'solitaire_payout' AND
         pg_get_function_arguments(oid) LIKE '%jsonb%' THEN '✅ V2.1 anti-cheat (4 params, OK)'
    WHEN proname = 'solitaire_payout' THEN '❌ V2 obsolete (3 params) — app mobile crash silencieusement'
    WHEN proname = 'solitaire_place_bet' AND
         pg_get_function_arguments(oid) LIKE '%boolean%' THEN '✅ V2 OK (2 params)'
    WHEN proname = 'solitaire_place_bet' THEN '❌ V1 obsolete (1 param)'
    ELSE '?'
  END AS verdict
FROM pg_proc
WHERE proname IN ('solitaire_place_bet', 'solitaire_payout')
ORDER BY proname, signature;
