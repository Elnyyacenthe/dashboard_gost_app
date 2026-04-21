import { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle, CheckCircle2, Search, RefreshCw, Shield,
  TrendingUp, Coins, Activity, X, Loader2,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

type Severity = 'low' | 'medium' | 'high' | 'critical';
type AlertType = 'high_winrate' | 'large_winnings' | 'frequent_withdrawals' | 'win_streak';

interface Alert {
  id: string;
  user_id: string;
  alert_type: AlertType;
  severity: Severity;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
  username: string | null;
  email: string | null;
  coins: number | null;
  kyc_verified: boolean | null;
}

const sevCfg: Record<Severity, { color: string; label: string }> = {
  low:      { color: 'bg-info/15 text-info border-info/30',         label: 'Faible' },
  medium:   { color: 'bg-warning/15 text-warning border-warning/30', label: 'Moyen' },
  high:     { color: 'bg-danger/15 text-danger border-danger/30',   label: 'Élevé' },
  critical: { color: 'bg-danger/30 text-danger border-danger',       label: 'Critique' },
};

const typeIcons: Record<AlertType, React.ReactNode> = {
  high_winrate:          <TrendingUp className="h-4 w-4" />,
  large_winnings:        <Coins className="h-4 w-4" />,
  frequent_withdrawals:  <Activity className="h-4 w-4" />,
  win_streak:            <TrendingUp className="h-4 w-4" />,
};

export default function AlertsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'unresolved' | 'resolved' | 'all'>('unresolved');
  const [scanResult, setScanResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_alerts_view')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) console.error('Load alerts:', error);
    if (data) setAlerts(data as Alert[]);
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
    const { data, error } = await supabase.rpc('scan_for_fraud_patterns');
    setScanning(false);
    if (error) {
      setScanResult(`Erreur: ${error.message}`);
    } else {
      setScanResult(`${data ?? 0} nouvelle(s) alerte(s) détectée(s)`);
      load();
    }
    setTimeout(() => setScanResult(null), 4000);
  };

  const resolve = async (id: string) => {
    await supabase.rpc('resolve_admin_alert', { p_alert_id: id });
    load();
  };

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
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
    .filter(a => !search || a.username?.toLowerCase().includes(search.toLowerCase()) || a.title.toLowerCase().includes(search.toLowerCase()));

  const stats = {
    unresolved: alerts.filter(a => !a.resolved).length,
    critical:   alerts.filter(a => !a.resolved && a.severity === 'critical').length,
    high:       alerts.filter(a => !a.resolved && a.severity === 'high').length,
    today:      alerts.filter(a => new Date(a.created_at) > new Date(Date.now() - 86400000)).length,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" />
            <h1 className="text-2xl font-bold text-text">Alertes anti-fraude</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">Détection automatique de patterns suspects</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runScan}
            disabled={scanning}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Lancer un scan
          </button>
          <button onClick={load} className="flex items-center gap-2 rounded-lg border border-border/30 px-4 py-2 text-sm text-text-muted hover:bg-surface-lighter hover:text-text">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {scanResult && (
        <div className="rounded-xl bg-success/10 border border-success/30 p-3 text-sm text-success">
          {scanResult}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Non résolues" value={stats.unresolved} icon={<AlertTriangle />} color="text-warning" bg="bg-warning/10" />
        <StatCard label="Critiques" value={stats.critical} icon={<AlertTriangle />} color="text-danger" bg="bg-danger/10" />
        <StatCard label="Sévérité élevée" value={stats.high} icon={<TrendingUp />} color="text-danger" bg="bg-danger/10" />
        <StatCard label="Dernières 24h" value={stats.today} icon={<Activity />} color="text-info" bg="bg-info/10" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher joueur ou titre..."
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
      </div>

      {/* Alerts */}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success/70" />
          <p className="font-semibold text-text">Aucune alerte {filter === 'unresolved' ? 'en attente' : ''}</p>
          <p className="mt-2 text-sm text-text-muted">
            Cliquez sur "Lancer un scan" pour détecter de nouveaux patterns suspects.
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
    <div className="rounded-xl border border-border/20 bg-surface-light p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted">{label}</p>
          <p className="text-2xl font-bold text-text mt-1">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${bg} ${color}`}>{icon}</div>
      </div>
    </div>
  );
}

function AlertRow({ alert, onResolve }: { alert: Alert; onResolve: () => void }) {
  const sev = sevCfg[alert.severity];
  const icon = typeIcons[alert.alert_type] ?? <AlertTriangle className="h-4 w-4" />;

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
            {alert.resolved && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
                Résolue
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mb-2 text-xs text-text-muted">
            <span className="font-medium text-text">{alert.username ?? 'Inconnu'}</span>
            {alert.email && <span>• {alert.email}</span>}
            {alert.coins != null && <span>• {alert.coins.toLocaleString()} coins</span>}
            {alert.kyc_verified && <span className="text-success">• ✓ KYC</span>}
          </div>

          {alert.description && (
            <p className="text-sm text-text-secondary mb-2">{alert.description}</p>
          )}

          {alert.metadata && Object.keys(alert.metadata).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(alert.metadata).map(([k, v]) => (
                <span key={k} className="rounded bg-surface px-2 py-0.5 text-[11px] text-text-muted font-mono">
                  {k}: <span className="text-text">{String(v)}</span>
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
