-- ============================================================
-- APP ANNOUNCEMENTS — Maintenance / broadcast notifications
-- ============================================================
-- Permet au super_admin/admin d'envoyer une notification a tous
-- les utilisateurs (ou un sous-groupe) depuis le dashboard.
-- L'app mobile ecoute cette table en Realtime et affiche
-- une notification locale via NotificationService.
-- Idempotent.
-- ============================================================

-- ─── Table principale ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info'
              CHECK (severity IN ('info', 'warning', 'maintenance', 'critical')),
  target_role TEXT NOT NULL DEFAULT 'all'
              CHECK (target_role IN ('all', 'user', 'admin', 'super_admin')),
  cta_url     TEXT,
  sent_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,                   -- null = permanente jusqu'a delete
  active      BOOLEAN NOT NULL DEFAULT TRUE  -- false = retracted manuellement
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON app_announcements(active, expires_at, sent_at DESC)
  WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_announcements_target
  ON app_announcements(target_role, sent_at DESC);

-- ─── Table de tracking lecture par user (optionnel) ────────
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id UUID NOT NULL REFERENCES app_announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user
  ON announcement_reads(user_id, read_at DESC);

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE app_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

-- Drop policies existantes (idempotent)
DROP POLICY IF EXISTS aa_admin_all   ON app_announcements;
DROP POLICY IF EXISTS aa_user_read   ON app_announcements;
DROP POLICY IF EXISTS ar_user_own    ON announcement_reads;

-- Admin/super_admin : tout
CREATE POLICY aa_admin_all ON app_announcements FOR ALL
  USING (public.is_super_admin() OR public.is_admin())
  WITH CHECK (public.is_super_admin() OR public.is_admin());

-- Tout user authentifie : lecture des annonces actives qui le concernent
CREATE POLICY aa_user_read ON app_announcements FOR SELECT
  USING (
    active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      target_role = 'all'
      OR target_role = 'user'  -- pour l'app mobile (joueurs)
      OR (target_role = 'admin' AND (public.is_admin() OR public.is_super_admin()))
      OR (target_role = 'super_admin' AND public.is_super_admin())
    )
  );

-- Tracking lecture : un user gere ses propres reads
CREATE POLICY ar_user_own ON announcement_reads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── RPC publique : broadcaster une annonce ────────────────
CREATE OR REPLACE FUNCTION broadcast_announcement(
  p_title       TEXT,
  p_body        TEXT,
  p_severity    TEXT DEFAULT 'info',
  p_target_role TEXT DEFAULT 'all',
  p_cta_url     TEXT DEFAULT NULL,
  p_expires_in_hours INT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  UUID;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  END IF;

  IF p_title IS NULL OR length(trim(p_title)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'TITLE_TOO_SHORT');
  END IF;
  IF p_body IS NULL OR length(trim(p_body)) < 5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'BODY_TOO_SHORT');
  END IF;

  INSERT INTO app_announcements (
    title, body, severity, target_role, cta_url, sent_by, expires_at
  ) VALUES (
    trim(p_title),
    trim(p_body),
    COALESCE(p_severity, 'info'),
    COALESCE(p_target_role, 'all'),
    NULLIF(trim(COALESCE(p_cta_url, '')), ''),
    v_uid,
    CASE WHEN p_expires_in_hours IS NOT NULL
         THEN NOW() + (p_expires_in_hours || ' hours')::INTERVAL
         ELSE NULL END
  )
  RETURNING id INTO v_id;

  -- Trace dans admin_actions_log si elle existe
  BEGIN
    PERFORM _log_admin_action(
      'announcement_broadcast',
      NULL, v_id, NULL,
      jsonb_build_object('title', p_title, 'severity', p_severity, 'target', p_target_role),
      format('Announcement: %s', p_title),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END $$;

GRANT EXECUTE ON FUNCTION broadcast_announcement(TEXT, TEXT, TEXT, TEXT, TEXT, INT) TO authenticated;

-- ─── RPC : retracter une annonce ──────────────────────────
CREATE OR REPLACE FUNCTION retract_announcement(p_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_admin()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ADMIN');
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  END IF;

  UPDATE app_announcements SET active = FALSE WHERE id = p_id;

  BEGIN
    PERFORM _log_admin_action(
      'announcement_retract',
      NULL, p_id, NULL, NULL, p_reason, NULL
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true);
END $$;

GRANT EXECUTE ON FUNCTION retract_announcement(UUID, TEXT) TO authenticated;

-- ─── RPC : marquer une annonce comme lue (cote app mobile) ─
CREATE OR REPLACE FUNCTION mark_announcement_read(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  INSERT INTO announcement_reads (announcement_id, user_id)
  VALUES (p_id, auth.uid())
  ON CONFLICT (announcement_id, user_id) DO NOTHING;
END $$;

GRANT EXECUTE ON FUNCTION mark_announcement_read(UUID) TO authenticated;

-- ─── Vue admin : annonces avec compteur reads ─────────────
CREATE OR REPLACE VIEW admin_announcements_view AS
SELECT
  a.*,
  up.username AS sent_by_username,
  (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count,
  CASE
    WHEN NOT a.active THEN 'retracted'
    WHEN a.expires_at IS NOT NULL AND a.expires_at <= NOW() THEN 'expired'
    ELSE 'active'
  END AS status
FROM app_announcements a
LEFT JOIN user_profiles up ON up.id = a.sent_by
ORDER BY a.sent_at DESC;

GRANT SELECT ON admin_announcements_view TO authenticated;

-- ─── Activer Realtime (essentiel pour push mobile) ────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'app_announcements'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE app_announcements';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ─── VERIFICATION ─────────────────────────────────────────
SELECT
  'app_announcements'             AS item, COUNT(*)::TEXT AS value FROM app_announcements
UNION ALL SELECT
  'broadcast_announcement_exists',
  CASE WHEN EXISTS(SELECT 1 FROM pg_proc WHERE proname='broadcast_announcement') THEN '1' ELSE '0' END
UNION ALL SELECT
  'realtime_enabled',
  CASE WHEN EXISTS(SELECT 1 FROM pg_publication_tables
                    WHERE pubname='supabase_realtime' AND tablename='app_announcements')
       THEN '1' ELSE '0' END;
