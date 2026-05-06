import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, CheckCircle2, Search, RefreshCw, Shield,
  TrendingUp, Coins, Activity, X, Loader2, Users, Database, Bot,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Alert {
  id: number | string;
  user_id: string | null;
  alert_type: string;
  severity: Severity;
  title: string;
  description: string | null;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  // Optionnel (jointure user)
  username?: string | null;
}

const sevCfg: Record<Severity, { color: string; label: string; ring: string }> = {
  low:      { color: 'bg-info/15 text-info border-info/30',         label: 'Faible',   ring: 'ring-info/30' },
  medium:   { color: 'bg-warning/15 text-warning border-warning/30', label: 'Moyen',    ring: 'ring-warning/30' },
  high:     { color: 'bg-danger/15 text-danger border-danger/30',   label: 'Élevé',    ring: 'ring-danger/30' },
  critical: { color: 'bg-danger/30 text-danger border-danger',       label: 'Critique', ring: 'ring-danger' },
};

const typeIcons: Record<string, React.ReactNode> = {
  // Anciens types
  high_winrate:          <TrendingUp className="h-4 w-4" />,
  large_winnings:        <Coins className="h-4 w-4" />,
  frequent_withdrawals:  <Activity className="h-4 w-4" />,
  win_streak:            <TrendingUp className="h-4 w-4" />,
  // Nouveaux types Ludo V2 / Cora V3
  money_imbalance:       <Database className="h-4 w-4" />,
  unusual_payout:        <Coins className="h-4 w-4" />,
  rapid_wins:            <Bot className="h-4 w-4" />,
  wallet_drift:          <Database className="h-4 w-4" />,
  cora_high_winrate:     <TrendingUp className="h-4 w-4" />,
  cora_high_volume:      <Coins className="h-4 w-4" />,
  cora_recurrent_pair:   <Users className="h-4 w-4" />,
};

const typeLabels: Record<string, string> = {
  money_imbalance:       'Désequilibre financier',
  unusual_payout:        'Payout exceptionnel',
  rapid_wins:            'Victoires rapides',
  wallet_drift:          'Wallet incohérent',
  cora_high_winrate:     'Cora : winrate suspect',
  cora_high_volume:      'Cora : volume élevé',
  cora_recurrent_pair:   'Cora : paire récurrente',
};

export default function AlertsPage() {
  const { isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all');
  const [scanResult, setScanResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Lecture directe de la table admin_alerts (RLS super_admin only)
    const { data, error } = await supabase
      .from('admin_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) console.error('Load alerts:', error);
    if (data) {
      // Enrich avec username si user_id renseigne
      const userIds = [...new Set((data as Alert[]).map(a => a.user_id).filter(Boolean))] as string[];
      let usernames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, username')
          .in('id', userIds);
        if (profiles) {
          usernames = (profiles as { id: string; username: string | null }[])
            .reduce<Record<string, string>>((acc, p) => {
              acc[p.id] = p.username ?? 'Joueur';
              return acc;
            }, {});
        }
      }
      const enriched = (data as Alert[]).map(a => ({
        ...a,
        username: a.user_id ? (usernames[a.user_id] ?? null) : null,
      }));
      setAlerts(enriched);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const sub = supabase
      .channel('admin-alerts-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_alerts' }, load)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [isAdmin, load]);

  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    // Cora fraud scan (la fonction Ludo v2 alimente automatiquement via triggers)
    const { data: coraScan, error: coraErr } = await supabase.rpc('cora_scan_fraud_patterns');
    let total = (coraScan as number) ?? 0;

    // Optionnel : ancienne RPC fraud (si elle existe encore)
    const { data: oldScan } = await supabase.rpc('scan_for_fraud_patterns');
    if (typeof oldScan === 'number') total += oldScan;

    // Manual reconciliation (peut générer money_imbalance alert)
    const { data: recon } = await supabase.rpc('reconcile_money_system');
    if (recon && (recon as { consistent: boolean }).consistent === false) total += 1;

    setScanning(false);
    if (coraErr) {
      setScanResult(`Erreur scan : ${coraErr.message}`);
    } else {
      setScanResult(`${total} nouvelle(s) alerte(s) détectée(s)`);
      load();
    }
    setTimeout(() => setScanResult(null), 4000);
  };

  const resolve = async (id: number | string) => {
    // Update direct (la table admin_alerts permet l'update super_admin via la policy "for all")
    await supabase
      .from('admin_alerts')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id);
    load();
  };

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Shield className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Section réservée aux administrateurs.</p>
        </div>
      </div>
    );
  }

  const filtered = alerts
    .filter(a => filter === 'all' || (filter === 'resolved' ? a.resolved : !a.resolved))
    .filter(a => sevFilter === 'all' || a.severity === sevFilter)
    .filter(a => !search ||
      a.username?.toLowerCase().includes(search.toLowerCase()) ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.alert_type.toLowerCase().includes(search.toLowerCase())
    );

  const stats = {
    unresolved: alerts.filter(a => !a.resolved).length,
    critical:   alerts.filter(a => !a.resolved && a.severity === 'critical').length,
    high:       alerts.filter(a => !a.resolved && a.severity === 'high').length,
    today:      alerts.filter(a => new Date(a.created_at) > new Date(Date.now() - 86400000)).length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-warning">
            Plugbet · Anti-fraud
          </p>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <AlertTriangle className="h-7 w-7 text-warning" strokeWidth={2} />
            <h1 className="hero-number text-3xl text-text">Alertes</h1>
            {stats.critical > 0 && (
              <span className="badge-danger flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
                {stats.critical} CRITIQUE{stats.critical > 1 ? 'S' : ''}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Détection automatique : déséquilibres, payouts suspects, collusion, winrate anormal
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold uppercase tracking-wider text-surface hover:bg-primary-light hover:shadow-[0_0_24px_rgba(0,230,118,0.4)] disabled:opacity-50 transition-all"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Scan
          </button>
          <button onClick={load}
            className="flex items-center gap-2 rounded-xl border border-border/40 bg-surface-light/50 px-4 py-2 text-sm font-semibold text-text-secondary hover:border-primary/30 hover:text-text transition-colors">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {scanResult && (
        <div className="card-plugbet card-glow-green flex items-center gap-2 p-3 text-sm font-semibold text-primary">
          <CheckCircle2 className="h-4 w-4" />
          {scanResult}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Non résolues" value={stats.unresolved} icon={<AlertTriangle />} color="text-warning" bg="bg-warning/10" />
        <StatCard label="Critiques" value={stats.critical} icon={<AlertTriangle />} color="text-danger" bg="bg-danger/10" />
        <StatCard label="Sévérité élevée" value={stats.high} icon={<TrendingUp />} color="text-danger" bg="bg-danger/10" />
        <StatCard label="Dernières 24h" value={stats.today} icon={<Activity />} color="text-info" bg="bg-info/10" />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher joueur, titre, type..."
            className="w-full rounded-lg border border-border/30 bg-surface-light pl-10 pr-4 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border/30 bg-surface-light p-1">
          {(['unresolved', 'resolved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                filter === f ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
              }`}>
              {f === 'unresolved' ? 'Non résolues' : f === 'resolved' ? 'Résolues' : 'Toutes'}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-border/30 bg-surface-light p-1">
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map(s => (
            <button key={s} onClick={() => setSevFilter(s)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                sevFilter === s ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
              }`}>
              {s === 'all' ? 'Tous' : sevCfg[s as Severity].label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success/70" />
          <p className="font-semibold text-text">Aucune alerte {filter === 'unresolved' ? 'en attente' : ''}</p>
          <p className="mt-2 text-sm text-text-muted">
            Cliquez sur "Scan + Reconcile" pour déclencher manuellement la détection.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => (
            <AlertRow key={a.id} alert={a} onResolve={() => resolve(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color, bg }: {
  label: string; value: number; icon: React.ReactNode; color: string; bg: string;
}) {
  return (
    <div className="card-plugbet relative overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{label}</p>
          <p className="hero-number mt-1 text-2xl text-text">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

function AlertRow({ alert, onResolve }: { alert: Alert; onResolve: () => void }) {
  const sev = sevCfg[alert.severity];
  const icon = typeIcons[alert.alert_type] ?? <AlertTriangle className="h-4 w-4" />;
  const typeLabel = typeLabels[alert.alert_type] ?? alert.alert_type;
  // metadata pour cora_*, context pour ludo_v2/wallet
  const ctx = alert.metadata ?? alert.context ?? null;

  return (
    <div className={`rounded-2xl border ${sev.color} bg-surface-light p-5 ${alert.resolved ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-lg p-2 ${sev.color.split(' ').filter(c => c.startsWith('bg-')).join(' ')}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-text">{alert.title}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${sev.color}`}>
              {sev.label}
            </span>
            <span className="rounded-full bg-text-muted/15 px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
              {typeLabel}
            </span>
            {alert.resolved && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
                Résolue
              </span>
            )}
          </div>

          {(alert.username || alert.user_id) && (
            <div className="flex items-center gap-3 mb-2 text-xs text-text-muted">
              <span className="font-medium text-text">{alert.username ?? alert.user_id?.slice(0, 8)}</span>
            </div>
          )}

          {alert.description && (
            <p className="text-sm text-text-secondary mb-2">{alert.description}</p>
          )}

          {ctx && Object.keys(ctx).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(ctx).slice(0, 8).map(([k, v]) => (
                <span key={k} className="rounded bg-surface px-2 py-0.5 text-[11px] text-text-muted font-mono">
                  {k}: <span className="text-text">{typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}</span>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-text-muted">
              {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true, locale: fr })}
              {' · '}
              {format(new Date(alert.created_at), 'dd MMM HH:mm', { locale: fr })}
            </span>
            {!alert.resolved && (
              <button
                onClick={onResolve}
                className="flex items-center gap-1 rounded-lg bg-success/15 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/25"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Résoudre
              </button>
            )}
          </div>
        </div>

        {!alert.resolved && (
          <button onClick={onResolve} className="rounded-lg p-1 text-text-muted hover:bg-surface-lighter">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
