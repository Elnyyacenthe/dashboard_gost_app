// ============================================================
// ANNOUNCEMENTS - Broadcast notifications aux utilisateurs
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import {
  Megaphone, Send, RefreshCw, AlertTriangle, CheckCircle2,
  Loader2, Lock, Wrench, Info, X, Eye, Clock,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

type Severity = 'info' | 'warning' | 'maintenance' | 'critical';
type TargetRole = 'all' | 'user' | 'admin' | 'super_admin';

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  target_role: TargetRole;
  cta_url: string | null;
  sent_by: string | null;
  sent_by_username: string | null;
  sent_at: string;
  expires_at: string | null;
  active: boolean;
  read_count: number;
  status: 'active' | 'expired' | 'retracted';
}

const sevCfg: Record<Severity, { label: string; color: string; icon: React.ReactNode }> = {
  info:        { label: 'Info',        color: 'bg-info/15 text-info border-info/30',          icon: <Info className="h-4 w-4" /> },
  warning:     { label: 'Avertissement', color: 'bg-warning/15 text-warning border-warning/30', icon: <AlertTriangle className="h-4 w-4" /> },
  maintenance: { label: 'Maintenance', color: 'bg-warning/20 text-warning border-warning/40', icon: <Wrench className="h-4 w-4" /> },
  critical:    { label: 'Critique',    color: 'bg-danger/15 text-danger border-danger/30',    icon: <AlertTriangle className="h-4 w-4" /> },
};

const targetCfg: Record<TargetRole, string> = {
  all: 'Tous',
  user: 'Joueurs',
  admin: 'Admins',
  super_admin: 'Super admin',
};

const TEMPLATES: { label: string; severity: Severity; title: string; body: string; expires: number }[] = [
  {
    label: 'Maintenance courte',
    severity: 'maintenance',
    title: 'Maintenance technique en cours',
    body: 'Nous effectuons actuellement une maintenance pour améliorer Plugbet. Vos parties et vos coins sont en sécurité. Le service revient sous peu, merci de votre patience.',
    expires: 2,
  },
  {
    label: 'Maintenance longue',
    severity: 'maintenance',
    title: 'Maintenance prolongée',
    body: 'Une maintenance technique est en cours. Aucune partie ni transaction n\'est perdue — votre solde est protégé. Service de retour sous quelques heures.',
    expires: 6,
  },
  {
    label: 'Mise à jour disponible',
    severity: 'info',
    title: 'Nouvelle mise à jour Plugbet',
    body: 'Une nouvelle version est disponible avec des corrections et améliorations. Mettez à jour votre application pour en profiter.',
    expires: 24,
  },
  {
    label: 'Incident résolu',
    severity: 'info',
    title: 'Service rétabli',
    body: 'L\'incident est résolu. Toutes les fonctionnalités sont à nouveau disponibles. Merci de votre patience !',
    expires: 12,
  },
];

export default function AnnouncementsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentResult, setSentResult] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<Severity>('maintenance');
  const [targetRole, setTargetRole] = useState<TargetRole>('all');
  const [expiresIn, setExpiresIn] = useState<string>('2');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('admin_announcements_view')
      .select('*')
      .limit(100);
    if (e) console.error('load announcements:', e);
    if (data) setList(data as Announcement[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setTitle(t.title);
    setBody(t.body);
    setSeverity(t.severity);
    setExpiresIn(String(t.expires));
  };

  const send = async () => {
    setError('');
    setSentResult(null);
    if (title.trim().length < 3) { setError('Le titre doit faire 3 caractères minimum'); return; }
    if (body.trim().length < 5)  { setError('Le message doit faire 5 caractères minimum'); return; }

    setSending(true);
    try {
      const expHours = expiresIn === '' ? null : parseInt(expiresIn, 10);
      const { data, error: rpcErr } = await supabase.rpc('broadcast_announcement', {
        p_title: title.trim(),
        p_body: body.trim(),
        p_severity: severity,
        p_target_role: targetRole,
        p_cta_url: null,
        p_expires_in_hours: isNaN(expHours as number) ? null : expHours,
      });
      if (rpcErr) throw rpcErr;
      if (data?.success === false) throw new Error(data.error ?? 'Erreur');

      setSentResult('Annonce envoyée avec succès — les utilisateurs vont la recevoir.');
      setTitle(''); setBody('');
      load();
      setTimeout(() => setSentResult(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSending(false);
    }
  };

  const retract = async (id: string) => {
    const reason = prompt('Raison de la rétractation (obligatoire) :');
    if (!reason || reason.trim().length < 3) return;
    const { data, error: e } = await supabase.rpc('retract_announcement', {
      p_id: id, p_reason: reason.trim(),
    });
    if (e || data?.success === false) {
      alert('Erreur: ' + (e?.message ?? data?.error));
      return;
    }
    load();
  };

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Section réservée aux administrateurs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-text">Annonces & Maintenance</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Envoie une notification à tous les utilisateurs — affichée dans l'app mobile en temps réel
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-border/30 px-4 py-2 text-sm text-text-muted hover:bg-surface-lighter hover:text-text"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,1.2fr]">
        {/* COMPOSE */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6 space-y-4 h-fit">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-text">Composer une annonce</h2>
          </div>

          {/* Templates */}
          <div>
            <p className="mb-2 text-xs font-medium text-text-muted">Modèles rapides</p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map(t => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  className="flex items-center gap-2 rounded-lg border border-border/30 bg-surface px-3 py-2 text-left text-xs text-text-muted hover:border-primary/30 hover:text-text transition-colors"
                >
                  {sevCfg[t.severity].icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Type</label>
            <div className="flex gap-2 flex-wrap">
              {(['info', 'maintenance', 'warning', 'critical'] as Severity[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    severity === s ? sevCfg[s].color : 'bg-surface text-text-muted border-border/30'
                  }`}
                >
                  {sevCfg[s].icon}
                  {sevCfg[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Cible</label>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'user', 'admin'] as TargetRole[]).map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTargetRole(r)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    targetRole === r
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-surface text-text-muted border-border/30'
                  }`}
                >
                  {targetCfg[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Titre <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Maintenance technique en cours"
              maxLength={120}
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] text-text-muted">{title.length}/120 — apparaît comme titre de la notification</p>
          </div>

          {/* Body */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Message <span className="text-danger">*</span>
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Ex: Nous améliorons Plugbet. Vos coins sont en sécurité. Service de retour sous peu, merci de votre patience."
              rows={5}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] text-text-muted">{body.length}/500 — texte du message rassurant</p>
          </div>

          {/* Expiry */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Expire dans (heures)
            </label>
            <select
              value={expiresIn}
              onChange={e => setExpiresIn(e.target.value)}
              aria-label="Durée de validité"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
            >
              <option value="1">1 heure</option>
              <option value="2">2 heures</option>
              <option value="6">6 heures</option>
              <option value="12">12 heures</option>
              <option value="24">1 jour</option>
              <option value="72">3 jours</option>
              <option value="168">1 semaine</option>
              <option value="">Permanente (jusqu'à rétraction)</option>
            </select>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          {sentResult && (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 border border-success/20 p-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> {sentResult}
            </div>
          )}

          <button
            type="button"
            onClick={send}
            disabled={sending || !title.trim() || !body.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? 'Envoi...' : 'Envoyer à tous'}
          </button>
          <p className="text-[10px] text-text-muted text-center">
            L'annonce est tracée dans <code>admin_actions_log</code> et envoyée en temps réel via Supabase Realtime.
          </p>
        </div>

        {/* HISTORIQUE */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-text-muted" />
            <h2 className="text-lg font-semibold text-text">Historique</h2>
            <span className="ml-auto text-xs text-text-muted">{list.length} annonce(s)</span>
          </div>

          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
              <Megaphone className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
              <p className="font-semibold text-text">Aucune annonce envoyée</p>
              <p className="mt-2 text-sm text-text-muted">Composez votre première à gauche.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[800px] overflow-y-auto">
              {list.map(a => {
                const sev = sevCfg[a.severity];
                return (
                  <div key={a.id} className={`rounded-2xl border bg-surface-light p-4 ${
                    a.status === 'active' ? sev.color : 'border-border/20 opacity-60'
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 rounded-lg p-2 ${sev.color.split(' ').filter(c => c.startsWith('bg-')).join(' ')}`}>
                        {sev.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-text">{a.title}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${sev.color}`}>
                            {sev.label}
                          </span>
                          <span className="rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
                            {targetCfg[a.target_role]}
                          </span>
                          {a.status === 'expired' && (
                            <span className="rounded-full bg-text-muted/15 px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
                              Expirée
                            </span>
                          )}
                          {a.status === 'retracted' && (
                            <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
                              Rétractée
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-text-secondary mb-2 leading-relaxed">{a.body}</p>
                        <div className="flex items-center gap-3 text-[11px] text-text-muted flex-wrap">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" /> {a.read_count} lu{a.read_count !== 1 ? 's' : ''}
                          </span>
                          <span>·</span>
                          <span title={format(new Date(a.sent_at), 'dd MMM yyyy HH:mm', { locale: fr })}>
                            envoyée {formatDistanceToNow(new Date(a.sent_at), { addSuffix: true, locale: fr })}
                          </span>
                          {a.sent_by_username && (
                            <>
                              <span>·</span>
                              <span>par {a.sent_by_username}</span>
                            </>
                          )}
                          {a.expires_at && (
                            <>
                              <span>·</span>
                              <span>expire {formatDistanceToNow(new Date(a.expires_at), { addSuffix: true, locale: fr })}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {a.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => retract(a.id)}
                          aria-label="Rétracter"
                          title="Rétracter cette annonce"
                          className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
