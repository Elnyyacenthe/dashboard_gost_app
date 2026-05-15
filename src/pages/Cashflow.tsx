// ============================================================
// CASHFLOW — Evolution de la caisse + profits dans le temps
// ============================================================
// Croise kpay_transactions (cash reel Mobile Money) avec
// treasury_movements (coins internes mises/gains/commissions)
// pour reconstruire l'historique chronologique de la caisse et
// suivre les profits.
// ============================================================

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle,
  RefreshCw, Loader2, Lock, Coins, Wallet, Activity, Download,
  Calendar, DollarSign, ShieldAlert, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { format, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

// ============================================================
// TYPES
// ============================================================

interface FreemoTx {
  id: string;
  user_id: string;
  reference: string;
  transaction_type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  status: string;
  phone: string | null;
  created_at: string;
}

interface TreasuryMv {
  id: string;
  game_type: string;
  user_id: string | null;
  movement_type: string;
  amount: number;
  created_at: string;
}

interface AdminTreasuryRow {
  balance: number;
  total_earned: number;
  total_withdrawn: number;
  total_deposited: number;
}

interface GameTreasuryRow {
  balance: number;
  total_received: number;
  total_paid_out: number;
}

interface LedgerInvariant {
  total_user_coins: number;
  game_treasury: number;
  admin_treasury: number;
  total_system: number;
  expected_total: number;
  discrepancy: number;
  is_balanced: boolean;
}

interface SuspectDeposit {
  id: string;
  reference: string;
  user_id: string;
  amount: number;
  created_at: string;
  username?: string;
}

interface TimelineEvent {
  date: string;            // ISO date
  type: 'deposit' | 'withdraw' | 'bet' | 'payout' | 'commission' | 'refund';
  source: 'mobile_money' | 'treasury';
  amount: number;          // toujours positif
  delta_cash: number;      // impact sur caisse cash (entrées MM, sorties MM)
  delta_treasury: number;  // impact sur caisse interne (commissions, etc.)
  username?: string;
  reference?: string;
  game_type?: string;
}

type Period = '24h' | '7d' | '30d' | '90d' | 'all';

// Détection des transactions système internes (non K-Pay)
function isSystemTx(tx: FreemoTx): boolean {
  return tx.reference?.startsWith('SYSTEM_') || tx.phone === 'system';
}

const PERIOD_HOURS: Record<Period, number | null> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
  'all': null,
};

const PERIOD_LABEL: Record<Period, string> = {
  '24h': '24 dernières heures',
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '3 derniers mois',
  'all': 'Tout l\'historique',
};

// ============================================================
// COMPONENT
// ============================================================

export default function CashflowPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<Period>('30d');
  const [freemoTxs, setFreemoTxs] = useState<FreemoTx[]>([]);
  const [movements, setMovements] = useState<TreasuryMv[]>([]);
  const [adminTreasury, setAdminTreasury] = useState<AdminTreasuryRow | null>(null);
  const [gameTreasury, setGameTreasury] = useState<GameTreasuryRow | null>(null);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [invariant, setInvariant] = useState<LedgerInvariant | null>(null);
  const [suspectDeposits, setSuspectDeposits] = useState<SuspectDeposit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const hours = PERIOD_HOURS[period];
    const since = hours ? new Date(Date.now() - hours * 3600000).toISOString() : null;

    const freemoQ = supabase
      .from('kpay_transactions')
      .select('id, user_id, reference, transaction_type, amount, status, phone, created_at')
      .eq('status', 'SUCCESS')
      .order('created_at');

    const movsQ = supabase
      .from('treasury_movements')
      .select('id, game_type, user_id, movement_type, amount, created_at')
      .order('created_at');

    const [fmRes, mvRes, adminRes, gameRes, profilesRes, invariantRes, suspectRes] = await Promise.all([
      since ? freemoQ.gte('created_at', since) : freemoQ,
      since ? movsQ.gte('created_at', since) : movsQ,
      supabase.from('admin_treasury').select('balance, total_earned, total_withdrawn, total_deposited').eq('id', 1).maybeSingle(),
      supabase.from('game_treasury').select('balance, total_received, total_paid_out').eq('id', 1).maybeSingle(),
      supabase.from('user_profiles').select('id, username').limit(5000),
      // Zero-sum check (toujours global, pas filtré par période)
      supabase.from('ledger_invariant_view').select('*').maybeSingle(),
      // Dépôts SUCCESS sans crédit wallet (potentielle disparition)
      supabase.from('kpay_transactions')
        .select('id, reference, user_id, amount, created_at')
        .eq('transaction_type', 'DEPOSIT')
        .eq('status', 'SUCCESS')
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    setFreemoTxs((fmRes.data ?? []) as FreemoTx[]);
    setMovements((mvRes.data ?? []) as TreasuryMv[]);
    setAdminTreasury(adminRes.data as AdminTreasuryRow | null);
    setGameTreasury(gameRes.data as GameTreasuryRow | null);
    if (invariantRes.data) setInvariant(invariantRes.data as LedgerInvariant);

    const uMap: Record<string, string> = {};
    (profilesRes.data ?? []).forEach((p: { id: string; username: string | null }) => {
      uMap[p.id] = p.username ?? '?';
    });
    setUsernames(uMap);

    // Croiser deposits SUCCESS avec wallet_ledger pour détecter ceux non crédités
    const depositsSuccess = (suspectRes.data ?? []) as Array<{
      id: string; reference: string; user_id: string; amount: number; created_at: string;
    }>;
    if (depositsSuccess.length > 0) {
      const txIds = depositsSuccess.map(d => d.id);
      const { data: walletEntries } = await supabase
        .from('wallet_ledger')
        .select('ref_id')
        .eq('ref_type', 'kpay_tx')
        .in('ref_id', txIds);
      const creditedIds = new Set((walletEntries ?? []).map((w: { ref_id: string }) => w.ref_id));
      const suspects = depositsSuccess
        .filter(d => !creditedIds.has(d.id))
        // Ignore les très récents (< 5 min, peut être en cours)
        .filter(d => (Date.now() - new Date(d.created_at).getTime()) > 5 * 60_000)
        .map(d => ({ ...d, username: uMap[d.user_id] }));
      setSuspectDeposits(suspects);
    } else {
      setSuspectDeposits([]);
    }

    setLoading(false);
  }, [period]);

  useEffect(() => { if (isSuperAdmin) load(); }, [isSuperAdmin, load]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const sub = supabase
      .channel('cashflow-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kpay_transactions' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'treasury_movements' }, load)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [isSuperAdmin, load]);

  // ─── Construction de la timeline unifiée ──
  const timeline: TimelineEvent[] = useMemo(() => {
    const events: TimelineEvent[] = [];

    // Mobile Money : cash réel entrant/sortant
    for (const tx of freemoTxs) {
      const isDeposit = tx.transaction_type === 'DEPOSIT';
      events.push({
        date: tx.created_at,
        type: isDeposit ? 'deposit' : 'withdraw',
        source: 'mobile_money',
        amount: tx.amount,
        delta_cash: isDeposit ? tx.amount : -tx.amount,
        delta_treasury: 0,
        username: usernames[tx.user_id],
        reference: tx.reference,
      });
    }

    // Treasury movements internes (coins virtuels)
    for (const mv of movements) {
      if (mv.game_type === 'system') continue;
      let type: TimelineEvent['type'];
      let deltaTreasury = 0;
      switch (mv.movement_type) {
        case 'loss_collect':
          type = 'bet';
          deltaTreasury = mv.amount; // mise perdue → caisse jeu gagne
          break;
        case 'payout':
          type = 'payout';
          deltaTreasury = -mv.amount; // gain payé → caisse jeu perd
          break;
        case 'house_cut':
          type = 'commission';
          deltaTreasury = mv.amount; // commission → admin gagne
          break;
        case 'refund':
          type = 'refund';
          deltaTreasury = -mv.amount;
          break;
        default:
          continue;
      }
      events.push({
        date: mv.created_at,
        type,
        source: 'treasury',
        amount: mv.amount,
        delta_cash: 0,
        delta_treasury: deltaTreasury,
        username: mv.user_id ? usernames[mv.user_id] : undefined,
        game_type: mv.game_type,
      });
    }

    return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [freemoTxs, movements, usernames]);

  // ─── Séparation Mobile Money réel vs Système interne ──
  const realFreemoTxs = useMemo(() => freemoTxs.filter(t => !isSystemTx(t)), [freemoTxs]);
  const systemTxs = useMemo(() => freemoTxs.filter(t => isSystemTx(t)), [freemoTxs]);

  // ─── KPIs période (UNIQUEMENT cash réel Mobile Money) ──
  const stats = useMemo(() => {
    const deposits = realFreemoTxs
      .filter(t => t.transaction_type === 'DEPOSIT')
      .reduce((s, t) => s + t.amount, 0);
    const withdrawals = realFreemoTxs
      .filter(t => t.transaction_type === 'WITHDRAW')
      .reduce((s, t) => s + t.amount, 0);

    let commissions = 0;
    let payouts = 0;
    let bets = 0;
    let refunds = 0;
    for (const m of movements) {
      if (m.game_type === 'system') continue;
      switch (m.movement_type) {
        case 'house_cut': commissions += m.amount; break;
        case 'payout': payouts += m.amount; break;
        case 'loss_collect': bets += m.amount; break;
        case 'refund': refunds += m.amount; break;
      }
    }
    const grossProfit = bets - payouts - refunds;

    // Stats système (coins non couverts par du cash réel)
    const systemTotal = systemTxs.reduce((s, t) => s + t.amount, 0);

    return {
      deposits, withdrawals, commissions, payouts, bets, refunds, grossProfit,
      netCash: deposits - withdrawals,
      depositCount: realFreemoTxs.filter(t => t.transaction_type === 'DEPOSIT').length,
      withdrawCount: realFreemoTxs.filter(t => t.transaction_type === 'WITHDRAW').length,
      systemTotal,
      systemCount: systemTxs.length,
    };
  }, [realFreemoTxs, systemTxs, movements]);

  // ─── Évolution caisse cash cumulée (running balance) ──
  // Uniquement transactions Mobile Money RÉELLES (pas les SYSTEM_*)
  const cashEvolutionData = useMemo(() => {
    let running = 0;
    const points: { x: string; y: number }[] = [];
    const labels: string[] = [];
    const dataset: number[] = [];

    for (const tx of realFreemoTxs) {
      running += tx.transaction_type === 'DEPOSIT' ? tx.amount : -tx.amount;
      labels.push(format(new Date(tx.created_at), 'dd MMM HH:mm', { locale: fr }));
      dataset.push(running);
      points.push({ x: tx.created_at, y: running });
    }

    return {
      labels,
      datasets: [{
        label: 'Caisse Mobile Money (FCFA)',
        data: dataset,
        borderColor: '#7CCD3F',
        backgroundColor: 'rgba(124, 205, 63, 0.12)',
        borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 6,
        pointHoverBackgroundColor: '#7CCD3F',
      }],
    };
  }, [realFreemoTxs]);

  // ─── Flux quotidien : deposits vs withdrawals stacked ──
  // Uniquement cash réel (exclut SYSTEM_*)
  const dailyFlowData = useMemo(() => {
    const byDay = new Map<string, { dep: number; wd: number }>();

    for (const tx of realFreemoTxs) {
      const day = format(startOfDay(new Date(tx.created_at)), 'dd MMM', { locale: fr });
      if (!byDay.has(day)) byDay.set(day, { dep: 0, wd: 0 });
      const slot = byDay.get(day)!;
      if (tx.transaction_type === 'DEPOSIT') slot.dep += tx.amount;
      else slot.wd += tx.amount;
    }

    const sortedDays = Array.from(byDay.keys());
    return {
      labels: sortedDays,
      datasets: [
        {
          label: 'Dépôts',
          data: sortedDays.map(d => byDay.get(d)!.dep),
          backgroundColor: 'rgba(124, 205, 63, 0.75)',
          borderColor: '#5FAF2D',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Retraits',
          data: sortedDays.map(d => -byDay.get(d)!.wd), // négatif pour visual
          backgroundColor: 'rgba(239, 68, 68, 0.75)',
          borderColor: '#DC2626',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    };
  }, [freemoTxs]);

  // ─── Profit quotidien (commission - 0, on monitre les commissions) ──
  const dailyProfitData = useMemo(() => {
    const byDay = new Map<string, { profit: number }>();

    for (const m of movements) {
      if (m.game_type === 'system') continue;
      const day = format(startOfDay(new Date(m.created_at)), 'dd MMM', { locale: fr });
      if (!byDay.has(day)) byDay.set(day, { profit: 0 });
      const slot = byDay.get(day)!;
      if (m.movement_type === 'loss_collect') slot.profit += m.amount;
      if (m.movement_type === 'payout') slot.profit -= m.amount;
      if (m.movement_type === 'refund') slot.profit -= m.amount;
    }

    const sortedDays = Array.from(byDay.keys());
    return {
      labels: sortedDays,
      datasets: [{
        label: 'Profit net (FCFA)',
        data: sortedDays.map(d => byDay.get(d)!.profit),
        backgroundColor: sortedDays.map(d => byDay.get(d)!.profit >= 0 ? 'rgba(124, 205, 63, 0.75)' : 'rgba(239, 68, 68, 0.75)'),
        borderColor: sortedDays.map(d => byDay.get(d)!.profit >= 0 ? '#5FAF2D' : '#DC2626'),
        borderWidth: 1,
        borderRadius: 4,
      }],
    };
  }, [movements]);

  const chartOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0F172A', borderColor: '#1E293B', borderWidth: 1,
        titleColor: '#F8FAFC', bodyColor: '#CBD5E1', cornerRadius: 8, padding: 10,
      },
    },
    scales: {
      x: { grid: { color: 'rgba(148, 163, 184, 0.15)' }, ticks: { color: '#64748B', font: { size: 10 } } },
      y: { grid: { color: 'rgba(148, 163, 184, 0.15)' }, ticks: { color: '#64748B', font: { size: 10 } } },
    },
  }), []);

  const exportCsv = () => {
    const headers = ['Date', 'Type', 'Source', 'Montant', 'Delta caisse', 'Delta tresorerie', 'User', 'Ref/Jeu'];
    const rows = timeline.map(e => [
      format(new Date(e.date), 'yyyy-MM-dd HH:mm:ss', { locale: fr }),
      e.type,
      e.source,
      String(e.amount),
      String(e.delta_cash),
      String(e.delta_treasury),
      e.username ?? '',
      e.reference ?? e.game_type ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashflow_${period}_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Réservé au super admin.</p>
        </div>
      </div>
    );
  }

  const currentTotalCash = (adminTreasury?.balance ?? 0) + (gameTreasury?.balance ?? 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary-dark">
            Plugbet · Cashflow & profits
          </p>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <TrendingUp className="h-7 w-7 text-primary-dark" strokeWidth={2} />
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Évolution de la caisse
            </h1>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Suivi temps réel des entrées / sorties Mobile Money et de l'évolution des profits.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex gap-1 rounded-xl border border-border bg-white p-1">
            {(['24h', '7d', '30d', '90d', 'all'] as Period[]).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                  period === p
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-primary/30 hover:text-slate-900"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-primary/30 hover:text-slate-900"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Période active label */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Calendar className="h-3.5 w-3.5" />
        Période active : <strong className="text-slate-700">{PERIOD_LABEL[period]}</strong>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* ─── PANNEAU ANOMALIES & ARGENT DISPARU ──────────── */}
          <AnomalyPanel
            invariant={invariant}
            suspectDeposits={suspectDeposits}
          />

          {/* ─── COINS HÉRITAGE (transactions SYSTEM_*) ──────── */}
          {stats.systemCount > 0 && (
            <div className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Coins héritage (non couverts par cash réel)
                  </p>
                  <p className="mt-1 text-2xl font-extrabold text-slate-900">
                    {stats.systemTotal.toLocaleString()} coins
                    <span className="ml-2 text-sm font-semibold text-slate-500">
                      sur {stats.systemCount} transaction{stats.systemCount > 1 ? 's' : ''} SYSTEM
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                    Ces coins existent dans le système mais ne proviennent <strong>pas</strong> d'un dépôt Mobile Money.
                    Ce sont des opening balance / réconciliation initiale faites lors du déploiement du ledger.
                    Ils sont <strong>exclus</strong> des KPIs cash réel ci-dessous pour ne pas embrouiller la comptabilité.
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Pour <strong>les supprimer définitivement</strong>, exécuter <code className="rounded bg-white px-1 text-primary-dark">supabase_remove_system_openings.sql</code> dans Supabase SQL Editor.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ─── KPIs (Mobile Money RÉEL uniquement) ─────────── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<ArrowDownCircle className="h-5 w-5" />}
              label="Dépôts (cash entré)"
              value={stats.deposits}
              sub={`${stats.depositCount} transactions Mobile Money`}
              color="success"
            />
            <KpiCard
              icon={<ArrowUpCircle className="h-5 w-5" />}
              label="Retraits (cash sorti)"
              value={stats.withdrawals}
              sub={`${stats.withdrawCount} transactions Mobile Money`}
              color="danger"
              negative
            />
            <KpiCard
              icon={<DollarSign className="h-5 w-5" />}
              label="Flux net Mobile Money"
              value={stats.netCash}
              sub={stats.netCash >= 0 ? 'Entrées > sorties' : 'Sorties > entrées'}
              color={stats.netCash >= 0 ? 'success' : 'danger'}
              showSign
            />
            <KpiCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Profit net jeux (commissions)"
              value={stats.grossProfit}
              sub={`+${stats.commissions.toLocaleString()} commissions − ${stats.payouts.toLocaleString()} payouts`}
              color={stats.grossProfit >= 0 ? 'success' : 'danger'}
              showSign
            />
          </div>

          {/* ─── Caisse actuelle (snapshot) ──────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SnapshotCard
              icon={<Wallet className="h-5 w-5" />}
              label="Caisse super admin"
              value={adminTreasury?.balance ?? 0}
              sub={`Earned : +${(adminTreasury?.total_earned ?? 0).toLocaleString()} · Withdrawn : ${(adminTreasury?.total_withdrawn ?? 0).toLocaleString()}`}
              color="warning"
            />
            <SnapshotCard
              icon={<Coins className="h-5 w-5" />}
              label="Caisse jeu (mises encaissées)"
              value={gameTreasury?.balance ?? 0}
              sub={`Reçu : +${(gameTreasury?.total_received ?? 0).toLocaleString()} · Payé : −${(gameTreasury?.total_paid_out ?? 0).toLocaleString()}`}
              color="info"
            />
            <SnapshotCard
              icon={<Activity className="h-5 w-5" />}
              label="Total caisses (snapshot)"
              value={currentTotalCash}
              sub="Solde combiné admin + jeu maintenant"
              color="primary"
              highlight
            />
          </div>

          {/* ─── Évolution caisse cumulée ────────────────────── */}
          <div className="exec-card p-6">
            <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Évolution caisse Mobile Money</h3>
                <p className="text-xs text-slate-500">
                  Running balance : cumul des dépôts − retraits dans le temps
                </p>
              </div>
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary-dark">
                {freemoTxs.length} events
              </span>
            </div>
            <div className="h-72">
              {freemoTxs.length > 0
                ? <Line data={cashEvolutionData} options={chartOpts} />
                : <EmptyChart msg="Aucune transaction Mobile Money sur la période" />
              }
            </div>
          </div>

          {/* ─── Flux quotidien + Profit ─────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="exec-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Flux quotidien Mobile Money</h3>
                  <p className="text-xs text-slate-500">Dépôts (vert) vs retraits (rouge, négatif)</p>
                </div>
              </div>
              <div className="h-64">
                {dailyFlowData.labels.length > 0
                  ? <Bar data={dailyFlowData} options={chartOpts} />
                  : <EmptyChart msg="Aucun flux Mobile Money" />
                }
              </div>
            </div>

            <div className="exec-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Profit quotidien (jeux)</h3>
                  <p className="text-xs text-slate-500">Mises encaissées − gains payés − refunds</p>
                </div>
              </div>
              <div className="h-64">
                {dailyProfitData.labels.length > 0
                  ? <Bar data={dailyProfitData} options={chartOpts} />
                  : <EmptyChart msg="Aucune partie sur la période" />
                }
              </div>
            </div>
          </div>

          {/* ─── Timeline détaillée ──────────────────────────── */}
          <div className="exec-card overflow-hidden">
            <div className="border-b border-border px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">Timeline chronologique</h3>
                <p className="text-xs text-slate-500">
                  Chaque event avec son impact sur la caisse cash et la trésorerie
                </p>
              </div>
              <span className="text-xs text-slate-500">{timeline.length} events au total</span>
            </div>
            {timeline.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">
                Aucun event sur cette période.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Type</th>
                      <th className="px-4 py-3 text-left font-semibold">User / Source</th>
                      <th className="px-4 py-3 text-right font-semibold">Montant</th>
                      <th className="px-4 py-3 text-right font-semibold">Δ Cash MM</th>
                      <th className="px-4 py-3 text-right font-semibold">Δ Trésorerie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.slice().reverse().slice(0, 200).map((e, i) => (
                      <tr key={`${e.date}-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          {format(new Date(e.date), 'dd MMM HH:mm:ss', { locale: fr })}
                        </td>
                        <td className="px-4 py-2.5">
                          <EventBadge type={e.type} />
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          <span className="font-semibold text-slate-700">{e.username ?? '—'}</span>
                          {e.reference && (
                            <span className="ml-2 text-[10px] text-slate-400 font-mono">
                              {e.reference}
                            </span>
                          )}
                          {e.game_type && (
                            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {e.game_type}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-sm font-bold text-slate-900 tabular-nums">
                          {e.amount.toLocaleString()}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-sm font-bold tabular-nums ${
                          e.delta_cash > 0 ? 'text-emerald-600' :
                          e.delta_cash < 0 ? 'text-red-600' : 'text-slate-300'
                        }`}>
                          {e.delta_cash === 0 ? '—' : (e.delta_cash > 0 ? '+' : '') + e.delta_cash.toLocaleString()}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-sm font-bold tabular-nums ${
                          e.delta_treasury > 0 ? 'text-emerald-600' :
                          e.delta_treasury < 0 ? 'text-red-600' : 'text-slate-300'
                        }`}>
                          {e.delta_treasury === 0 ? '—' : (e.delta_treasury > 0 ? '+' : '') + e.delta_treasury.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {timeline.length > 200 && (
                  <div className="border-t border-border px-6 py-3 text-center text-xs text-slate-500">
                    Affichage des 200 events les plus récents. Export CSV pour la liste complète ({timeline.length} events).
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function KpiCard({ icon, label, value, sub, color, negative, showSign }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  color: 'success' | 'danger' | 'warning' | 'info' | 'primary';
  negative?: boolean;
  showSign?: boolean;
}) {
  const colorMap = {
    success: { bg: 'bg-emerald-50', text: 'text-emerald-700', iconBg: 'bg-emerald-100' },
    danger:  { bg: 'bg-red-50',     text: 'text-red-700',     iconBg: 'bg-red-100' },
    warning: { bg: 'bg-amber-50',   text: 'text-amber-700',   iconBg: 'bg-amber-100' },
    info:    { bg: 'bg-blue-50',    text: 'text-blue-700',    iconBg: 'bg-blue-100' },
    primary: { bg: 'bg-green-50',   text: 'text-green-700',   iconBg: 'bg-green-100' },
  }[color];

  const sign = showSign ? (value >= 0 ? '+' : '') : negative ? '−' : '';
  const displayValue = Math.abs(value);

  return (
    <div className="exec-card exec-card-hover p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 truncate">
            {label}
          </p>
          <p className={`hero-number text-2xl ${colorMap.text}`}>
            {sign}{displayValue.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500 truncate" title={sub}>{sub}</p>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colorMap.iconBg} ${colorMap.text}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function SnapshotCard({ icon, label, value, sub, color, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  color: 'success' | 'warning' | 'info' | 'primary';
  highlight?: boolean;
}) {
  const colorMap = {
    success: 'border-emerald-200 bg-emerald-50/30',
    warning: 'border-amber-200 bg-amber-50/30',
    info: 'border-blue-200 bg-blue-50/30',
    primary: 'border-green-300 bg-gradient-to-br from-green-50 to-emerald-50/40',
  }[color];

  return (
    <div className={`rounded-2xl border p-5 ${colorMap} ${highlight ? 'ring-1 ring-primary/30' : ''}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
        {icon} {label}
      </div>
      <p className={`hero-number mt-2 text-2xl text-slate-900`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function EventBadge({ type }: { type: TimelineEvent['type'] }) {
  const cfg = {
    deposit:    { bg: 'bg-emerald-100 text-emerald-700', label: 'Dépôt MM' },
    withdraw:   { bg: 'bg-red-100 text-red-700',         label: 'Retrait MM' },
    bet:        { bg: 'bg-amber-100 text-amber-700',     label: 'Mise' },
    payout:     { bg: 'bg-blue-100 text-blue-700',       label: 'Gain payé' },
    commission: { bg: 'bg-violet-100 text-violet-700',   label: 'Commission' },
    refund:     { bg: 'bg-slate-100 text-slate-600',     label: 'Refund' },
  }[type];
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      {msg}
    </div>
  );
}

function AnomalyPanel({ invariant, suspectDeposits }: {
  invariant: LedgerInvariant | null;
  suspectDeposits: SuspectDeposit[];
}) {
  const hasInvariantIssue = invariant && !invariant.is_balanced;
  const hasSuspectDeposits = suspectDeposits.length > 0;
  const allGood = !hasInvariantIssue && !hasSuspectDeposits;

  // Total argent potentiellement disparu (déposé mais pas crédité)
  const suspectTotal = suspectDeposits.reduce((s, d) => s + d.amount, 0);

  if (allGood && invariant) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-emerald-900">
            ✓ Système financier équilibré — aucune anomalie détectée
          </p>
          <p className="text-xs text-emerald-700">
            Tous les dépôts ont été correctement crédités · Total système = total attendu · Aucun argent disparu
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Discrépance ledger */}
      {hasInvariantIssue && invariant && (
        <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 pulse-glow">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
              <ShieldAlert className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                Argent disparu ou créé sans dépôt
              </p>
              <h3 className="hero-number text-2xl text-red-900">
                {invariant.discrepancy > 0 ? '+' : ''}
                {invariant.discrepancy.toLocaleString()} coins
              </h3>
              <p className="mt-1 text-sm text-red-800">
                {invariant.discrepancy > 0
                  ? <>Le système contient <strong>plus</strong> de coins que ce qui a été déposé. Possible bug de création monétaire, ou dépôts admin manuels.</>
                  : <>Le système contient <strong>moins</strong> de coins que ce qui a été déposé. <strong>Argent potentiellement disparu</strong>.</>}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
                <div className="rounded-lg bg-white/60 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total système</p>
                  <p className="font-bold text-slate-900">{invariant.total_system.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500">user + caisses</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total attendu</p>
                  <p className="font-bold text-slate-900">{invariant.expected_total.toLocaleString()}</p>
                  <p className="text-[10px] text-slate-500">deposits − withdrawals</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">Discrépance</p>
                  <p className="font-bold text-red-700">
                    {invariant.discrepancy > 0 ? '+' : ''}{invariant.discrepancy.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500">{invariant.discrepancy > 0 ? 'excédent' : 'manque'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dépôts SUCCESS sans crédit wallet (argent qui n'arrive pas en caisse) */}
      {hasSuspectDeposits && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Dépôts Mobile Money non arrivés en caisse
              </p>
              <h3 className="hero-number text-2xl text-amber-900">
                {suspectDeposits.length} transaction{suspectDeposits.length > 1 ? 's' : ''} · {suspectTotal.toLocaleString()} FCFA
              </h3>
              <p className="mt-1 text-sm text-amber-800">
                Ces dépôts sont marqués <strong>SUCCESS</strong> chez K-Pay mais <strong>n'ont pas crédité</strong> le wallet du user.
                L'argent a été pris par K-Pay mais n'est pas arrivé dans notre comptabilité.
              </p>
              <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-white/60 border border-amber-200">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 text-amber-800 text-[10px] uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">Date</th>
                      <th className="px-3 py-2 text-left font-bold">User</th>
                      <th className="px-3 py-2 text-left font-bold">Reference</th>
                      <th className="px-3 py-2 text-right font-bold">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspectDeposits.slice(0, 10).map(d => (
                      <tr key={d.id} className="border-t border-amber-100">
                        <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                          {format(new Date(d.created_at), 'dd MMM HH:mm', { locale: fr })}
                        </td>
                        <td className="px-3 py-1.5 font-semibold text-slate-900">
                          {d.username ?? d.user_id.slice(0, 8)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                          {d.reference}
                        </td>
                        <td className="px-3 py-1.5 text-right font-bold text-amber-900">
                          {d.amount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {suspectDeposits.length > 10 && (
                  <div className="px-3 py-2 text-center text-[10px] text-amber-700 border-t border-amber-200">
                    + {suspectDeposits.length - 10} autres dépôts suspects
                  </div>
                )}
              </div>
              <a
                href="/dashboard/finance"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 hover:underline"
              >
                Aller au Rapport Financier pour résoudre → Lancer reconcile ou créditer manuellement
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Unused imports cleanup
void TrendingDown;
