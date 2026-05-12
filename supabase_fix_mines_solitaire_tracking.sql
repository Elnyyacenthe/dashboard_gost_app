-- ============================================================
-- FIX Mines & Solitaire : tracer les mouvements dans treasury_movements
-- ============================================================
-- Bug Mines : create_mines_session(uuid, int, int) - 3 args, fait
--   UPDATE coins direct sans appeler treasury_place_bet.
-- Bug Solitaire : solitaire_payout ecrit dans wallet_ledger mais
--   pas dans treasury_movements.
--
-- Ce script patch les 2 fonctions pour qu'elles inserent les
-- mouvements requis dans treasury_movements.
-- ============================================================

-- ============================================================
-- A. MINES : patch create_mines_session (version 3-args)
-- ============================================================
-- On remplace UPDATE coins direct par treasury_place_bet pour que
-- la mise soit tracee dans treasury_movements + game_treasury.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_mines_session(
  p_user_id uuid, p_bet_amount integer, p_mines_count integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_coins      INT;
  v_positions  INT[];
  v_session_id UUID;
  v_pos        INT;
  v_idx        INT;
BEGIN
  IF p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;

  -- Rate limit (best-effort)
  BEGIN
    IF NOT check_rate_limit(p_user_id, 'mines_create', 2000) THEN
      RETURN jsonb_build_object('error', 'rate_limited');
    END IF;
  EXCEPTION WHEN undefined_function THEN NULL; END;

  IF p_bet_amount < 10 THEN
    RETURN jsonb_build_object('error', 'bet_too_low');
  END IF;
  IF p_mines_count < 1 OR p_mines_count > 24 THEN
    RETURN jsonb_build_object('error', 'invalid_mines_count');
  END IF;

  IF EXISTS (
    SELECT 1 FROM mines_sessions
    WHERE user_id = p_user_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('error', 'session_already_active');
  END IF;

  SELECT coins INTO v_coins
    FROM user_profiles WHERE id = p_user_id FOR UPDATE;
  IF v_coins IS NULL OR v_coins < p_bet_amount THEN
    RETURN jsonb_build_object('error', 'insufficient_coins');
  END IF;

  -- Genere positions des mines (Fisher-Yates)
  v_positions := ARRAY(SELECT generate_series(0, 24));
  FOR v_i IN REVERSE 24..1 LOOP
    v_idx := floor(random() * (v_i + 1))::int;
    v_pos := v_positions[v_idx + 1];
    v_positions[v_idx + 1] := v_positions[v_i + 1];
    v_positions[v_i + 1] := v_pos;
  END LOOP;

  INSERT INTO mines_sessions (
    user_id, bet_amount, mines_count,
    mine_positions, current_potential_win
  ) VALUES (
    p_user_id, p_bet_amount, p_mines_count,
    to_jsonb(v_positions[1:p_mines_count]),
    p_bet_amount
  )
  RETURNING id INTO v_session_id;

  -- ===== TREASURY (FIX) =====
  -- Avant : UPDATE user_profiles SET coins = coins - p_bet_amount  (PAS TRACE)
  -- Maintenant : passe par treasury_place_bet qui trace dans treasury_movements
  --             et game_treasury (et qui debite atomiquement les coins).
  PERFORM public.treasury_place_bet(
    'mines', v_session_id::text, p_user_id, p_bet_amount
  );

  RETURN jsonb_build_object(
    'id', v_session_id,
    'user_id', p_user_id,
    'bet_amount', p_bet_amount,
    'status', 'active',
    'mines_count', p_mines_count,
    'grid_size', 25,
    'safe_revealed_count', 0,
    'revealed_positions', '[]'::jsonb,
    'current_multiplier', 1.0,
    'current_potential_win', p_bet_amount,
    'created_at', now()
  );
END;
$function$;

-- ============================================================
-- B. SOLITAIRE : patch solitaire_payout pour INSERT treasury_movements
-- ============================================================
-- On laisse la logique existante intacte mais on ajoute les
-- INSERT manquants dans treasury_movements :
--   - 'loss_collect' (mise encaissee) au moment du payout, retroactif
--   - 'payout' (gain paye)
--   - 'house_cut' (commission 10%)
--
-- Note : on ne peut pas tracer 'loss_collect' au moment de
-- solitaire_place_bet sans modifier cette fonction aussi. Mais on
-- l'ajoute ici en meme temps que le payout pour avoir l'historique.
-- ============================================================
CREATE OR REPLACE FUNCTION public.solitaire_payout(
  p_session_id uuid,
  p_score integer,
  p_won boolean,
  p_moves jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'extensions' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sess solitaire_sessions;
  v_cfg solitaire_config;
  v_gross bigint;
  v_cut bigint;
  v_net bigint;
  v_today_payout bigint;
  v_moves_count int;
  v_fraud_flags jsonb := '[]'::jsonb;
  v_elapsed_sec int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTH' USING errcode = '42501'; END IF;
  SELECT * INTO v_cfg FROM solitaire_config WHERE id = 1;

  SELECT * INTO v_sess FROM solitaire_sessions
   WHERE id = p_session_id AND user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND' USING errcode = 'P0002'; END IF;

  -- Idempotence
  IF v_sess.state = 'paid' THEN
    RETURN jsonb_build_object('paid', v_sess.paid_amount, 'state', 'paid', 'idempotent', true);
  END IF;
  IF v_sess.state IN ('forfeit', 'expired', 'cancelled') THEN
    RETURN jsonb_build_object('paid', 0, 'state', v_sess.state, 'idempotent', true);
  END IF;
  IF v_sess.state != 'open' THEN
    RAISE EXCEPTION 'SESSION_INVALID_STATE: %', v_sess.state USING errcode = 'P0007';
  END IF;

  IF v_sess.bet_at < now() - (v_cfg.session_timeout_min || ' minutes')::interval THEN
    UPDATE solitaire_sessions SET state = 'expired', closed_at = now(), final_score = p_score
      WHERE id = p_session_id;
    RAISE EXCEPTION 'SESSION_EXPIRED' USING errcode = 'P0008';
  END IF;

  v_moves_count := jsonb_array_length(COALESCE(p_moves, '[]'::jsonb));
  v_elapsed_sec := EXTRACT(EPOCH FROM (now() - v_sess.bet_at))::int;

  -- Plausibility checks (conserves)
  IF p_won AND v_moves_count < 30 THEN
    v_fraud_flags := v_fraud_flags || jsonb_build_array(jsonb_build_object('flag', 'too_few_moves', 'moves', v_moves_count, 'min_expected', 30));
  END IF;
  IF p_won AND p_score > 1500 THEN
    v_fraud_flags := v_fraud_flags || jsonb_build_array(jsonb_build_object('flag', 'score_too_high', 'score', p_score, 'max', 1500));
  END IF;
  IF p_won AND v_elapsed_sec < 30 THEN
    v_fraud_flags := v_fraud_flags || jsonb_build_array(jsonb_build_object('flag', 'too_fast_win', 'elapsed_sec', v_elapsed_sec, 'min', 30));
  END IF;
  IF v_moves_count > 0 AND v_elapsed_sec > 0 AND (v_moves_count::float / v_elapsed_sec) > 5 THEN
    v_fraud_flags := v_fraud_flags || jsonb_build_array(jsonb_build_object('flag', 'bot_pace', 'moves_per_sec', round((v_moves_count::numeric / v_elapsed_sec)::numeric, 2)));
  END IF;

  IF v_sess.is_practice THEN
    UPDATE solitaire_sessions
       SET state = CASE WHEN p_won THEN 'paid' ELSE 'forfeit' END,
           closed_at = now(), final_score = p_score, paid_amount = 0,
           moves_log = p_moves, moves_count = v_moves_count, fraud_flags = v_fraud_flags
     WHERE id = p_session_id;
    RETURN jsonb_build_object('paid', 0, 'state', 'practice_done', 'fraud_flags', v_fraud_flags);
  END IF;

  -- ===== FIX : tracer la mise dans treasury_movements ===========
  -- Cette ligne est nouvelle. La mise n'a jamais ete tracee jusqu'ici.
  INSERT INTO treasury_movements (game_type, game_id, user_id, movement_type, amount, metadata)
  VALUES (
    'solitaire', p_session_id, v_uid, 'loss_collect', v_sess.bet_amount,
    jsonb_build_object('session_id', p_session_id, 'description', 'Mise Solitaire')
  );

  IF NOT p_won THEN
    UPDATE solitaire_sessions
       SET state = 'forfeit', closed_at = now(), final_score = p_score,
           moves_log = p_moves, moves_count = v_moves_count, fraud_flags = v_fraud_flags
     WHERE id = p_session_id;
    RETURN jsonb_build_object('paid', 0, 'state', 'forfeit');
  END IF;

  -- VICTOIRE
  v_gross := v_sess.bet_amount * 2;
  v_cut := floor(v_gross * v_cfg.house_cut_pct)::bigint;
  v_net := v_gross - v_cut;

  -- Cap journalier
  SELECT COALESCE(SUM(paid_amount), 0) INTO v_today_payout
    FROM solitaire_sessions
   WHERE user_id = v_uid AND state = 'paid'
     AND closed_at > now() - interval '24 hours';
  IF v_today_payout + v_net > v_cfg.max_payout_per_24h THEN
    RAISE EXCEPTION 'DAILY_PAYOUT_CAP_REACHED' USING errcode = 'P0009';
  END IF;

  -- Ledger v2 (conserve)
  PERFORM _ledger_post(
    v_uid, v_net, 'payout',
    'solitaire_payout:' || p_session_id::text,
    'solitaire', p_session_id::text,
    jsonb_build_object('gross', v_gross, 'commission', v_cut, 'score', p_score, 'fraud_flags', v_fraud_flags)
  );

  -- ===== FIX : tracer le payout et la commission dans treasury_movements ===
  INSERT INTO treasury_movements (game_type, game_id, user_id, movement_type, amount, metadata)
  VALUES (
    'solitaire', p_session_id, v_uid, 'payout', v_net,
    jsonb_build_object('session_id', p_session_id, 'gross', v_gross, 'commission', v_cut)
  );
  IF v_cut > 0 THEN
    INSERT INTO treasury_movements (game_type, game_id, user_id, movement_type, amount, metadata)
    VALUES (
      'solitaire', p_session_id, NULL, 'house_cut', v_cut,
      jsonb_build_object('session_id', p_session_id, 'pct', v_cfg.house_cut_pct)
    );

    -- admin_treasury (conserve)
    UPDATE admin_treasury SET balance = balance + v_cut,
                              total_earned = total_earned + v_cut,
                              updated_at = now()
     WHERE id = 1;
    IF NOT FOUND THEN
      INSERT INTO admin_treasury (id, balance, total_earned, total_withdrawn)
        VALUES (1, v_cut, v_cut, 0);
    END IF;
  END IF;

  -- Alerte fraude si necessaire (conserve)
  IF jsonb_array_length(v_fraud_flags) > 0 THEN
    BEGIN
      INSERT INTO admin_alerts (user_id, alert_type, severity, title, description, metadata)
      VALUES (v_uid, 'solitaire_suspicious_win',
              CASE WHEN jsonb_array_length(v_fraud_flags) >= 2 THEN 'high' ELSE 'medium' END,
              format('Victoire Solitaire suspecte (%s flags)', jsonb_array_length(v_fraud_flags)),
              'Plausibility checks ont detecte des anomalies. Voir metadata.fraud_flags.',
              jsonb_build_object('session_id', p_session_id, 'bet', v_sess.bet_amount,
                                 'payout', v_net, 'score', p_score,
                                 'moves_count', v_moves_count, 'elapsed_sec', v_elapsed_sec,
                                 'fraud_flags', v_fraud_flags));
    EXCEPTION WHEN undefined_table THEN NULL; END;
  END IF;

  UPDATE solitaire_sessions
     SET state = 'paid', closed_at = now(), final_score = p_score,
         paid_amount = v_net,
         request_id_pay = 'solitaire_payout:' || p_session_id::text,
         moves_log = p_moves, moves_count = v_moves_count, fraud_flags = v_fraud_flags
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'paid', v_net, 'gross', v_gross, 'commission', v_cut, 'state', 'paid',
    'fraud_flags', v_fraud_flags
  );
END;
$function$;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT
  'mines_3args_uses_treasury_place_bet' AS check_name,
  CASE WHEN pg_get_functiondef(oid) LIKE '%treasury_place_bet%' THEN '1' ELSE '0' END AS value
FROM pg_proc
WHERE proname = 'create_mines_session'
  AND pg_get_function_arguments(oid) = 'p_user_id uuid, p_bet_amount integer, p_mines_count integer'

UNION ALL SELECT
  'solitaire_payout_inserts_treasury_movements',
  CASE WHEN pg_get_functiondef(oid) LIKE '%INSERT INTO treasury_movements%' OR
            pg_get_functiondef(oid) LIKE '%insert into treasury_movements%' THEN '1' ELSE '0' END
FROM pg_proc
WHERE proname = 'solitaire_payout'
  AND pg_get_function_arguments(oid) LIKE '%jsonb%';
