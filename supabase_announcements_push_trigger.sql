-- ============================================================
-- ANNOUNCEMENTS PUSH TRIGGER — Auto-envoi FCM via Edge Function
-- ============================================================
-- A executer APRES supabase_announcements.sql ET le deploiement de
-- l'Edge Function `send-announcement-push`.
--
-- A chaque INSERT dans app_announcements, ce trigger appelle l'Edge
-- Function via pg_net.http_post pour envoyer un push FCM a tous les
-- appareils enregistres dans push_tokens.
--
-- Necessite :
--   - extension pg_net (activee par defaut sur Supabase)
--   - secret FIREBASE_SERVICE_ACCOUNT configure dans la function
--   - app_settings.announcement_push contenant le project_ref Supabase
-- ============================================================

-- Activer pg_net si pas deja fait
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─── Stocker la config push (URL function + service key) ────
-- A executer une fois manuellement avec votre project_ref Supabase :
--
--   INSERT INTO app_settings (key, value)
--   VALUES (
--     'announcement_push_config',
--     jsonb_build_object(
--       'function_url', 'https://VOTRE_PROJECT_REF.supabase.co/functions/v1/send-announcement-push',
--       'service_role_key', 'VOTRE_SERVICE_ROLE_KEY'
--     )
--   )
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- (Le project_ref se trouve dans Supabase Dashboard > Settings > General)
-- (La service_role_key se trouve dans Settings > API > service_role secret)

-- ─── Trigger function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_announcement_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_config JSONB;
  v_url    TEXT;
  v_key    TEXT;
BEGIN
  -- Skip si annonce inactive ou expiree
  IF NEW.active = false THEN RETURN NEW; END IF;
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= NOW() THEN RETURN NEW; END IF;

  -- Charger la config
  SELECT value INTO v_config FROM app_settings WHERE key = 'announcement_push_config';
  IF v_config IS NULL THEN
    RAISE NOTICE 'announcement_push_config not configured, skipping push';
    RETURN NEW;
  END IF;

  v_url := v_config->>'function_url';
  v_key := v_config->>'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'function_url or service_role_key missing, skipping push';
    RETURN NEW;
  END IF;

  -- Appel async via pg_net (ne bloque pas la transaction)
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('announcement_id', NEW.id::text)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- En cas d'erreur, on ne casse pas l'INSERT
  RAISE NOTICE 'announcement push trigger error: %', SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS app_announcements_push_trg ON app_announcements;
CREATE TRIGGER app_announcements_push_trg
  AFTER INSERT ON app_announcements
  FOR EACH ROW
  EXECUTE FUNCTION trigger_announcement_push();

-- ─── RPC manuelle : ré-envoyer une annonce (test ou rattrapage) ───
CREATE OR REPLACE FUNCTION resend_announcement_push(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_config JSONB;
  v_url    TEXT;
  v_key    TEXT;
  v_request_id BIGINT;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  END IF;

  SELECT value INTO v_config FROM app_settings WHERE key = 'announcement_push_config';
  IF v_config IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'CONFIG_MISSING');
  END IF;

  v_url := v_config->>'function_url';
  v_key := v_config->>'service_role_key';

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('announcement_id', p_id::text)
  ) INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END $$;

GRANT EXECUTE ON FUNCTION resend_announcement_push(UUID) TO authenticated;

-- ─── VERIFICATION ─────────────────────────────────────────
SELECT
  'pg_net_extension'  AS item,
  CASE WHEN EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN '1' ELSE '0' END AS value
UNION ALL SELECT
  'trigger_installed',
  CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'app_announcements_push_trg') THEN '1' ELSE '0' END
UNION ALL SELECT
  'config_set',
  CASE WHEN EXISTS(SELECT 1 FROM app_settings WHERE key = 'announcement_push_config') THEN '1' ELSE '0_NEEDS_INSERT' END;
