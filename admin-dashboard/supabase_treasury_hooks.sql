-- ============================================================
-- TREASURY HOOKS pour TOUS LES JEUX
-- A executer APRES supabase_treasury.sql
-- ============================================================
-- Strategie :
--  - Jeux SOLO (vs machine) : trigger automatique sur change de status
--    → Loss : mise va dans game_treasury
--    → Win : gain (mise + profit) sort de game_treasury
--  - Jeux MULTI : trigger sur fin de partie
--    → Commission (10% ou 15%) prelevee sur le pot total et envoyee a admin_treasury
-- ============================================================

-- ───────── 1. APPLE FORTUNE (solo) — 10% commission ─────────
CREATE OR REPLACE FUNCTION apple_fortune_treasury_hook()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'lost' AND OLD.status = 'active' THEN
    PERFORM game_treasury_collect_loss(
      NEW.bet_amount, 'apple_fortune', NEW.user_id,
      'Apple Fortune: pomme pourrie',
      jsonb_build_object('session_id', NEW.id)
    );
  ELSIF NEW.status = 'cashed_out' AND OLD.status = 'active' THEN
    PERFORM game_treasury_pay_win(
      NEW.current_potential_win, 'apple_fortune', NEW.user_id,
      'Apple Fortune: cash out',
      jsonb_build_object('session_id', NEW.id, 'multiplier', NEW.current_multiplier)
    );
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS apple_fortune_treasury_trg ON apple_fortune_sessions;
CREATE TRIGGER apple_fortune_treasury_trg
  AFTER UPDATE OF status ON apple_fortune_sessions
  FOR EACH ROW EXECUTE FUNCTION apple_fortune_treasury_hook();


-- ───────── 2. AVIATOR (solo machine) — 10% house edge ─────────
-- Aviator a un systeme de bets dans aviator_rounds. Si la table existe,
-- on attache un trigger sur les rounds finis (statut 'crashed').
DO $$ BEGIN
  IF to_regclass('public.aviator_rounds') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION aviator_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_total_bets BIGINT; v_total_payouts BIGINT;
      BEGIN
        -- Quand un round se termine (status crashed), on calcule le net house gain
        IF NEW.status = 'crashed' AND OLD.status != 'crashed' THEN
          -- Selon ton schema, ajuster les colonnes (total_bets / total_payouts)
          v_total_bets := COALESCE((NEW.metadata->>'total_bets')::bigint, 0);
          v_total_payouts := COALESCE((NEW.metadata->>'total_payouts')::bigint, 0);
          IF v_total_bets > v_total_payouts THEN
            PERFORM game_treasury_collect_loss(
              v_total_bets - v_total_payouts, 'aviator', NULL,
              'Aviator round crashed',
              jsonb_build_object('round_id', NEW.id)
            );
          ELSIF v_total_payouts > v_total_bets THEN
            PERFORM game_treasury_pay_win(
              v_total_payouts - v_total_bets, 'aviator', NULL,
              'Aviator: joueurs ont cashout avant crash',
              jsonb_build_object('round_id', NEW.id)
            );
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS aviator_treasury_trg ON aviator_rounds;
    -- N'active le trigger que si la colonne 'status' existe
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'aviator_rounds' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER aviator_treasury_trg
               AFTER UPDATE OF status ON aviator_rounds
               FOR EACH ROW EXECUTE FUNCTION aviator_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 3. LUDO V2 (multi) — 15% commission ─────────
DO $$ BEGIN
  IF to_regclass('public.ludo_v2_games') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION ludo_v2_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT; v_winner UUID;
      BEGIN
        -- Quand une partie est terminee (winner_id renseigne)
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          -- Recuperer le pot depuis la room (bet_amount × nb_players)
          SELECT COALESCE(r.bet_amount * (SELECT COUNT(*) FROM ludo_v2_room_players WHERE room_id = NEW.room_id), 0)
            INTO v_pot
            FROM ludo_v2_rooms r WHERE r.id = NEW.room_id;
          v_winner := NEW.winner_id;
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'ludo', v_winner,
              jsonb_build_object('game_id', NEW.id, 'room_id', NEW.room_id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    -- Activer si colonne winner_id et status existent
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'ludo_v2_games' AND column_name = 'status') THEN
      DROP TRIGGER IF EXISTS ludo_v2_treasury_trg ON ludo_v2_games;
      EXECUTE 'CREATE TRIGGER ludo_v2_treasury_trg
               AFTER UPDATE OF status ON ludo_v2_games
               FOR EACH ROW EXECUTE FUNCTION ludo_v2_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 4. CORA DICE (multi) — 10% commission ─────────
-- Recherche table cora_rooms ou cora_games
DO $$ BEGIN
  IF to_regclass('public.cora_rooms') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION cora_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT;
      BEGIN
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          v_pot := COALESCE(NEW.bet_amount * NEW.player_count, 0);
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'cora', NEW.winner_id,
              jsonb_build_object('room_id', NEW.id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS cora_treasury_trg ON cora_rooms;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'cora_rooms' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER cora_treasury_trg
               AFTER UPDATE OF status ON cora_rooms
               FOR EACH ROW EXECUTE FUNCTION cora_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 5. CHECKERS / DAMES (1v1) — 15% commission ─────────
DO $$ BEGIN
  IF to_regclass('public.checkers_rooms') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION checkers_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT;
      BEGIN
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          -- 1v1 : pot = mise × 2
          v_pot := COALESCE(NEW.bet_amount * 2, 0);
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'checkers', NEW.winner_id,
              jsonb_build_object('room_id', NEW.id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS checkers_treasury_trg ON checkers_rooms;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'checkers_rooms' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER checkers_treasury_trg
               AFTER UPDATE OF status ON checkers_rooms
               FOR EACH ROW EXECUTE FUNCTION checkers_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 6. BLACKJACK (multi 2-4 vs dealer) — 10% commission ─────────
DO $$ BEGIN
  IF to_regclass('public.blackjack_rooms') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION blackjack_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT;
      BEGIN
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          v_pot := COALESCE((NEW.metadata->>'total_pot')::bigint, NEW.bet_amount * 2);
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'blackjack', NULL,
              jsonb_build_object('room_id', NEW.id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS blackjack_treasury_trg ON blackjack_rooms;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'blackjack_rooms' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER blackjack_treasury_trg
               AFTER UPDATE OF status ON blackjack_rooms
               FOR EACH ROW EXECUTE FUNCTION blackjack_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 7. ROULETTE (multi) — 10% commission ─────────
DO $$ BEGIN
  IF to_regclass('public.roulette_rooms') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION roulette_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT;
      BEGIN
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          v_pot := COALESCE((NEW.metadata->>'total_pot')::bigint, NEW.bet_amount * 2);
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'roulette', NULL,
              jsonb_build_object('room_id', NEW.id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS roulette_treasury_trg ON roulette_rooms;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'roulette_rooms' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER roulette_treasury_trg
               AFTER UPDATE OF status ON roulette_rooms
               FOR EACH ROW EXECUTE FUNCTION roulette_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 8. COINFLIP / PILE OU FACE (1v1) — 10% commission ─────────
DO $$ BEGIN
  IF to_regclass('public.coinflip_rooms') IS NOT NULL THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION coinflip_treasury_hook()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $body$
      DECLARE v_pot BIGINT;
      BEGIN
        IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
          v_pot := COALESCE(NEW.bet_amount * 2, 0);
          IF v_pot > 0 THEN
            PERFORM admin_treasury_take_commission(v_pot, 'coinflip', NEW.winner_id,
              jsonb_build_object('room_id', NEW.id));
          END IF;
        END IF;
        RETURN NEW;
      END; $body$;
    $func$;
    DROP TRIGGER IF EXISTS coinflip_treasury_trg ON coinflip_rooms;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'coinflip_rooms' AND column_name = 'status') THEN
      EXECUTE 'CREATE TRIGGER coinflip_treasury_trg
               AFTER UPDATE OF status ON coinflip_rooms
               FOR EACH ROW EXECUTE FUNCTION coinflip_treasury_hook()';
    END IF;
  END IF;
END $$;


-- ───────── 9. SOLITAIRE (solo) — pas de table SQL connue ─────────
-- Solitaire est traite cote client. La mise est deduite via wallet,
-- la victoire credite. Pour collecter la commission, il faudrait
-- ajouter une table solitaire_sessions ou appeler les RPC depuis le client.
-- Pour l'instant, le cote client doit appeler manuellement :
--   - SELECT game_treasury_collect_loss(bet, 'solitaire', user_id, 'Solitaire perdu');
--   - SELECT game_treasury_pay_win(win, 'solitaire', user_id, 'Solitaire gagne');


-- ───────── 10. FANTASY PREMIER LEAGUE (FPL) — 15% commission ─────────
-- Fantasy fonctionne par ligues : la commission est prise sur le pot
-- de la ligue quand elle se termine. Pas de trigger auto possible
-- (depend de la fin de saison FPL).
-- Le code mobile fpl_provider doit appeler :
--   SELECT admin_treasury_take_commission(pot, 'fantasy', winner_id, '{}');


-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'apple_fortune_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'apple_fortune_treasury_trg'
UNION ALL SELECT 'mines_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'mines_treasury_trg'
UNION ALL SELECT 'aviator_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'aviator_treasury_trg'
UNION ALL SELECT 'ludo_v2_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'ludo_v2_treasury_trg'
UNION ALL SELECT 'cora_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'cora_treasury_trg'
UNION ALL SELECT 'checkers_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'checkers_treasury_trg'
UNION ALL SELECT 'blackjack_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'blackjack_treasury_trg'
UNION ALL SELECT 'roulette_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'roulette_treasury_trg'
UNION ALL SELECT 'coinflip_treasury_trg', tgenabled FROM pg_trigger WHERE tgname = 'coinflip_treasury_trg';
