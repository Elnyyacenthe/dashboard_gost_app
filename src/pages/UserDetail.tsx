// ============================================================
// USER DETAIL 360 - Vue complete d'un joueur pour le support
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, Coins, Gamepad2, Trophy, AlertTriangle,
  ShieldCheck, ShieldOff, Smartphone, MessageSquare, Loader2,
  TrendingUp, CheckCircle2, Activity, Eye, Plus, Minus, Lock,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface User360 {
  id: string;
  username: string | null;
  email: string | null;
  coins: number;
  xp: number;
  rank: string | null;
  games_played: number;
  total_wins: number;
  is_blocked: boolean;
  kyc_verified: boolean | null;
  kyc_full_name: string | null;
  created_at: string;
  last_seen: string | null;
  movement_count: number;
  bets_count: number;
  wins_count: number;
  total_bet: number;
  total_won: number;
  total_deposited: number;
  total_withdrawn: number;
  active_alerts: number;
  tickets_count: number;
}

interface Movement {
  id: string;
  game_type: string;
  game_id: string | null;
  movement_type: string;
  amount: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface FreemoTx {
  id: string;
  reference: string;
  transaction_type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  payer_or_receiver: string | null;
  created_at: string;
}

interface AlertRow {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string | null;
  resolved: boolean;
  created_at: string;
}

interface AuditEntry {
  id: number;
  admin_id: string;
  action: string;
  reason: string;
  amount: number | null;
  created_at: string;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  category: string;
  created_at: string;
}

type Tab = 'activity' | 'transactions' | 'mobile' | 'alerts' | 'tickets' | 'audit';

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, loading: authLoading } = useAuth();
  const [user, setUser] = useState<User360 | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [freemoTxs, setFreemoTxs] = useState<FreemoTx[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('activity');
  const [actionModal, setActionModal] = useState<'block' | 'unblock' | 'adjust' | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [u, mv, fm, al, tk, ad] = await Promise.all([
      supabase.from('admin_user_360_view').select('*').eq('id', id).maybeSingle(),
      supabase.from('treasury_movements').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(500),
      supabase.from('freemopay_transactions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(200),
      supabase.from('admin_alerts').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('support_tickets').select('id, subject, status, category, created_at').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('admin_actions_log').select('*').eq('target_user', id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (u.data) setUser(u.data as User360);
    if (mv.data) setMovements(mv.data as Movement[]);
    if (fm.data) setFreemoTxs(fm.data as FreemoTx[]);
    if (al.data) setAlerts(al.data as AlertRow[]);
    if (tk.data) setTickets(tk.data as Ticket[]);
    if (ad.data) setAudit(ad.data as AuditEntry[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (authLoading || loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="rounded-2xl border border-border/30 bg-surface-light p-12 text-center">
        <p className="text-text-muted">Utilisateur introuvable</p>
        <Link to="/dashboard/users" className="mt-4 inline-block text-primary hover:underline">← Retour</Link>
      </div>
    );
  }

  const winrate = user.games_played > 0 ? (user.total_wins / user.games_played * 100).toFixed(1) : '0';
  const netCoinsFlow = user.total_deposited - user.total_withdrawn;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="card-plugbet relative overflow-hidden p-5">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <button type="button" onClick={() => navigate(-1)} aria-label="Retour"
              className="rounded-xl border border-border/40 p-2 text-text-secondary hover:border-primary/30 hover:text-text transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <div className="logo-gradient flex h-16 w-16 items-center justify-center rounded-2xl">
              <span className="hero-number text-2xl text-surface">
                {(user.username ?? '?').charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
                Plugbet · Player 360
              </p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <h1 className="hero-number text-2xl text-text">{user.username ?? '(sans nom)'}</h1>
                {user.is_blocked && (
                  <span className="badge-danger rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">Bloqué</span>
                )}
                {user.kyc_verified && (
                  <span className="rounded-md bg-primary/15 border border-primary/30 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> KYC
                  </span>
                )}
                {user.active_alerts > 0 && (
                  <span className="rounded-md bg-warning/15 border border-warning/30 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {user.active_alerts}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-text-secondary">{user.email ?? '—'}</p>
              <p className="text-[10px] text-text-muted font-mono">{user.id}</p>
              <p className="mt-1 text-xs text-text-secondary">
                Inscrit {formatDistanceToNow(new Date(user.created_at), { addSuffix: true, locale: fr })}
                {user.last_seen && ` · Vu ${formatDistanceToNow(new Date(user.last_seen), { addSuffix: true, locale: fr })}`}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <button type="button"
              onClick={() => setActionModal(user.is_blocked ? 'unblock' : 'block')}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold uppercase tracking-wider transition-colors ${
                user.is_blocked
                  ? 'bg-primary/15 text-primary hover:bg-primary/25'
                  : 'bg-danger/15 text-danger hover:bg-danger/25'
              }`}
            >
              {user.is_blocked ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
              {user.is_blocked ? 'Débloquer' : 'Bloquer'}
            </button>
            {isSuperAdmin && (
              <button type="button"
                onClick={() => setActionModal('adjust')}
                className="flex items-center gap-2 rounded-xl bg-warning/15 px-3 py-2 text-sm font-bold uppercase tracking-wider text-warning hover:bg-warning/25 transition-colors"
              >
                <Coins className="h-4 w-4" />
                Ajuster coins
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={<Coins />} label="Solde actuel" value={user.coins.toLocaleString()} color="primary" big />
        <KpiCard icon={<Gamepad2 />} label="Parties jouées" value={user.games_played.toLocaleString()} color="info" />
        <KpiCard icon={<Trophy />} label="Win rate" value={`${winrate}%`} color="warning"
          sub={`${user.total_wins}/${user.games_played} victoires`} />
        <KpiCard
          icon={<TrendingUp />}
          label="Flux Mobile Money net"
          value={`${netCoinsFlow >= 0 ? '+' : ''}${netCoinsFlow.toLocaleString()}`}
          color={netCoinsFlow >= 0 ? 'success' : 'danger'}
          sub={`+${user.total_deposited.toLocaleString()} / -${user.total_withdrawn.toLocaleString()}`}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-border/40">
        <div className="flex gap-0.5 flex-wrap">
          {([
            { id: 'activity', label: 'Activité', count: user.bets_count + user.wins_count, icon: <Activity className="h-4 w-4" /> },
            { id: 'transactions', label: 'Mouvements', count: movements.length, icon: <Coins className="h-4 w-4" /> },
            { id: 'mobile', label: 'Mobile Money', count: freemoTxs.length, icon: <Smartphone className="h-4 w-4" /> },
            { id: 'alerts', label: 'Alertes', count: alerts.length, icon: <AlertTriangle className="h-4 w-4" /> },
            { id: 'tickets', label: 'Tickets', count: tickets.length, icon: <MessageSquare className="h-4 w-4" /> },
            { id: 'audit', label: 'Audit admin', count: audit.length, icon: <Eye className="h-4 w-4" /> },
          ] as { id: Tab; label: string; count: number; icon: React.ReactNode }[]).map(t => (
            <button type="button" key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 px-3 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
                tab === t.id ? 'text-primary' : 'text-text-secondary hover:text-text'
              }`}>
              {t.icon}{t.label}
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                tab === t.id ? 'bg-primary/15 text-primary' : 'bg-surface-lighter text-text-secondary'
              }`}>
                {t.count}
              </span>
              {tab === t.id && (
                <span className="active-indicator absolute -bottom-px left-2 right-2 h-0.5 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab contents */}
      {tab === 'activity' && <ActivityTab movements={movements} />}
      {tab === 'transactions' && <TransactionsTab movements={movements} />}
      {tab === 'mobile' && <MobileTab txs={freemoTxs} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} />}
      {tab === 'tickets' && <TicketsTab tickets={tickets} />}
      {tab === 'audit' && <AuditTab audit={audit} />}

      {actionModal && (
        <ActionModal
          type={actionModal}
          user={user}
          onClose={() => setActionModal(null)}
          onSuccess={() => { setActionModal(null); load(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Sub-components ───────────────────────────

function KpiCard({ icon, label, value, color, sub, big }: {
  icon: React.ReactNode; label: string; value: string; color: string; sub?: string; big?: boolean;
}) {
  return (
    <div className="card-plugbet relative overflow-hidden p-4 transition-transform hover:-translate-y-0.5">
      <span className={`absolute left-0 top-0 h-full w-[3px] bg-${color} opacity-60`} />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{label}</p>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-${color}/15 text-${color}`}>
          {icon}
        </span>
      </div>
      <p className={`hero-number mt-1 ${big ? 'text-2xl' : 'text-xl'} text-text`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-text-secondary">{sub}</p>}
    </div>
  );
}

function ActivityTab({ movements }: { movements: Movement[] }) {
  const games = movements.filter(m => ['loss_collect', 'payout', 'refund'].includes(m.movement_type));
  if (games.length === 0) {
    return <Empty msg="Aucune activité de jeu" />;
  }
  return (
    <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface border-b border-border/20">
          <tr className="text-left text-xs uppercase text-text-muted">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Jeu</th>
            <th className="px-4 py-3">Game ID</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3 text-right">Montant</th>
            <th className="px-4 py-3 text-right">Replay</th>
          </tr>
        </thead>
        <tbody>
          {games.slice(0, 100).map(m => {
            const isGain = m.movement_type === 'payout' || m.movement_type === 'refund';
            return (
              <tr key={m.id} className="border-b border-border/10 hover:bg-surface-lighter">
                <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                  {format(new Date(m.created_at), 'dd MMM HH:mm', { locale: fr })}
                </td>
                <td className="px-4 py-3 text-xs">{m.game_type}</td>
                <td className="px-4 py-3 text-xs font-mono text-text-muted">
                  {m.game_id ? m.game_id.slice(0, 8) : '—'}
                </td>
                <td className="px-4 py-3 text-xs">
                  {m.movement_type === 'loss_collect' ? 'Mise' : m.movement_type === 'payout' ? 'Gain' : 'Refund'}
                </td>
                <td className={`px-4 py-3 text-right font-bold ${isGain ? 'text-success' : 'text-danger'}`}>
                  {isGain ? '+' : '-'}{m.amount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {m.game_id && (
                    <Link to={`/dashboard/games/${m.game_id}/replay`}
                      className="text-xs text-primary hover:underline">Voir</Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionsTab({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) return <Empty msg="Aucun mouvement" />;
  return (
    <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface border-b border-border/20">
          <tr className="text-left text-xs uppercase text-text-muted">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {movements.slice(0, 200).map(m => (
            <tr key={m.id} className="border-b border-border/10 hover:bg-surface-lighter">
              <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                {format(new Date(m.created_at), 'dd MMM HH:mm:ss', { locale: fr })}
              </td>
              <td className="px-4 py-3 text-xs">{m.game_type}</td>
              <td className="px-4 py-3 text-xs">{m.movement_type}</td>
              <td className="px-4 py-3 text-right font-bold">
                {m.amount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileTab({ txs }: { txs: FreemoTx[] }) {
  if (txs.length === 0) return <Empty msg="Aucune transaction Mobile Money" />;
  return (
    <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface border-b border-border/20">
          <tr className="text-left text-xs uppercase text-text-muted">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Téléphone</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3">Référence</th>
            <th className="px-4 py-3 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {txs.map(t => (
            <tr key={t.id} className="border-b border-border/10">
              <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                {format(new Date(t.created_at), 'dd MMM HH:mm', { locale: fr })}
              </td>
              <td className="px-4 py-3 text-xs">
                {t.transaction_type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'}
              </td>
              <td className="px-4 py-3 text-xs font-mono">{t.payer_or_receiver ?? '—'}</td>
              <td className="px-4 py-3 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  t.status === 'SUCCESS' ? 'bg-success/15 text-success' :
                  t.status === 'FAILED' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
                }`}>{t.status}</span>
              </td>
              <td className="px-4 py-3 text-xs font-mono text-text-muted">{t.reference}</td>
              <td className={`px-4 py-3 text-right font-bold ${
                t.status !== 'SUCCESS' ? 'text-text-muted' :
                t.transaction_type === 'DEPOSIT' ? 'text-success' : 'text-warning'
              }`}>
                {t.status !== 'SUCCESS' ? '' : (t.transaction_type === 'DEPOSIT' ? '+' : '-')}
                {t.amount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertsTab({ alerts }: { alerts: AlertRow[] }) {
  if (alerts.length === 0) return <Empty msg="Aucune alerte" />;
  return (
    <div className="space-y-2">
      {alerts.map(a => (
        <div key={a.id} className={`rounded-xl border p-4 ${a.resolved ? 'opacity-50 border-border/20' : 'border-warning/30 bg-warning/5'}`}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`h-4 w-4 mt-0.5 ${a.resolved ? 'text-text-muted' : 'text-warning'}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-text">{a.title}</p>
                <span className="rounded-full bg-surface-lighter px-2 py-0.5 text-[10px] uppercase text-text-muted">
                  {a.severity}
                </span>
                {a.resolved && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              </div>
              {a.description && <p className="mt-1 text-xs text-text-muted">{a.description}</p>}
              <p className="mt-1 text-[10px] text-text-muted/60">
                {format(new Date(a.created_at), 'dd MMM HH:mm', { locale: fr })}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TicketsTab({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) return <Empty msg="Aucun ticket support" />;
  return (
    <div className="space-y-2">
      {tickets.map(t => (
        <Link key={t.id} to="/dashboard/support"
          className="flex items-center justify-between rounded-xl border border-border/20 bg-surface-light p-4 hover:border-primary/30">
          <div className="flex items-center gap-3 min-w-0">
            <MessageSquare className="h-4 w-4 text-text-muted shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-text truncate">{t.subject}</p>
              <p className="text-xs text-text-muted">{t.category} · {format(new Date(t.created_at), 'dd MMM yyyy', { locale: fr })}</p>
            </div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            t.status === 'open' ? 'bg-info/15 text-info' :
            t.status === 'answered' ? 'bg-warning/15 text-warning' : 'bg-surface-lighter text-text-muted'
          }`}>{t.status}</span>
        </Link>
      ))}
    </div>
  );
}

function AuditTab({ audit }: { audit: AuditEntry[] }) {
  if (audit.length === 0) return <Empty msg="Aucune action admin enregistrée" />;
  return (
    <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface border-b border-border/20">
          <tr className="text-left text-xs uppercase text-text-muted">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">Raison</th>
            <th className="px-4 py-3 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {audit.map(a => (
            <tr key={a.id} className="border-b border-border/10">
              <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                {format(new Date(a.created_at), 'dd MMM HH:mm', { locale: fr })}
              </td>
              <td className="px-4 py-3 text-xs font-semibold text-text">{a.action}</td>
              <td className="px-4 py-3 text-xs text-text-muted">{a.reason}</td>
              <td className="px-4 py-3 text-right text-xs font-bold">
                {a.amount != null ? a.amount.toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center text-sm text-text-muted">
      {msg}
    </div>
  );
}

// ─────────────────────────── Action modal ───────────────────────────

function ActionModal({ type, user, onClose, onSuccess }: {
  type: 'block' | 'unblock' | 'adjust';
  user: User360;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [delta, setDelta] = useState('');
  const [direction, setDirection] = useState<'add' | 'sub'>('add');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (reason.trim().length < 3) {
      setError('Raison obligatoire (3 caractères minimum)');
      return;
    }
    setLoading(true);
    try {
      if (type === 'block' || type === 'unblock') {
        const { data, error: e } = await supabase.rpc('admin_set_user_blocked', {
          p_user_id: user.id,
          p_blocked: type === 'block',
          p_reason: reason.trim(),
        });
        if (e) throw e;
        if (data?.success === false) throw new Error(data.error);
      } else if (type === 'adjust') {
        const n = parseInt(delta, 10);
        if (isNaN(n) || n <= 0) { setError('Montant invalide'); setLoading(false); return; }
        const { data, error: e } = await supabase.rpc('admin_adjust_user_coins', {
          p_user_id: user.id,
          p_delta: direction === 'add' ? n : -n,
          p_reason: reason.trim(),
        });
        if (e) throw e;
        if (data?.success === false) throw new Error(data.error);
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/30 bg-surface-light shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="border-b border-border/20 p-5">
          <h3 className="font-bold text-text">
            {type === 'block' ? 'Bloquer le joueur' : type === 'unblock' ? 'Débloquer le joueur' : 'Ajuster les coins'}
          </h3>
          <p className="mt-1 text-xs text-text-muted">{user.username}</p>
        </div>

        <div className="p-5 space-y-4">
          {type === 'adjust' && (
            <>
              <div className="flex gap-2">
                <button onClick={() => setDirection('add')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold ${
                    direction === 'add' ? 'bg-success text-white' : 'bg-surface text-text-muted'
                  }`}>
                  <Plus className="h-4 w-4" /> Créditer
                </button>
                <button onClick={() => setDirection('sub')}
                  className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold ${
                    direction === 'sub' ? 'bg-danger text-white' : 'bg-surface text-text-muted'
                  }`}>
                  <Minus className="h-4 w-4" /> Débiter
                </button>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-muted">Montant (coins)</label>
                <input type="number" min="1" value={delta} onChange={e => setDelta(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-lg font-bold text-text focus:outline-none focus:border-primary" />
              </div>
              <p className="text-xs text-text-muted">
                Solde actuel : <strong>{user.coins.toLocaleString()}</strong>
              </p>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Raison <span className="text-danger">*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Ex: Refund partie crashée game_id #abc"
              rows={3}
              className="w-full resize-none rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-primary" />
            <p className="mt-1 text-[11px] text-text-muted">Tracée dans admin_actions_log de manière permanente.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 rounded-xl border border-border/30 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface-lighter">
              Annuler
            </button>
            <button onClick={submit} disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirmer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Suppress unused import warning
void User;
