import { useEffect, useState, useCallback } from 'react';
import {
  Vault, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Lock, CheckCircle2, X, Loader2, AlertTriangle, Coins, Gamepad2,
  ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, ArrowRight,
  Wallet, TrendingUp, Smartphone, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface TreasuryRow {
  balance: number;
  total_received?: number;
  total_paid_out?: number;
  total_earned?: number;
  total_withdrawn?: number;
  total_deposited?: number;
  updated_at: string;
}

interface MovementRow {
  id: string;
  game_type: string;
  game_id: string | null;
  user_id: string | null;
  movement_type: string;
  amount: number;
  pot_total: number | null;
  edge_pct: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface FreemoTxRow {
  id: string;
  user_id: string;
  reference: string;
  transaction_type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  payer_or_receiver: string | null;
  message: string | null;
  created_at: string;
}

interface GameStat {
  game_type: string;
  bets_in: number;       // somme treasury_place_bet
  payouts_out: number;   // somme apply_game_payout (90%)
  house_cut: number;     // somme house_cut (10%)
  refunds_out: number;   // somme refund (match nul)
  net_profit: number;    // bets_in - payouts_out - refunds_out
  count: number;         // nombre de mouvements
}

const movementLabels: Record<string, string> = {
  loss_collect: 'Mise → caisse',
  payout: 'Paiement gagnant',
  house_cut: 'Commission 10%',
  refund: 'Remboursement (match nul)',
  jackpot: 'Jackpot',
  adjustment: 'Ajustement',
};

const gameLabels: Record<string, string> = {
  aviator: 'Aviator',
  apple_fortune: 'Apple Fortune',
  mines: 'Mines',
  solitaire: 'Solitaire',
  coinflip: 'Pile ou Face',
  cora_dice: 'Cora Dice',
  checkers: 'Dames',
  blackjack: 'Blackjack',
  roulette: 'Roulette',
  ludo_v2: 'Ludo',
  fantasy: 'Fantasy',
  system: 'Système',
};

type ModalType = 'withdraw' | 'deposit' | 'to_game' | 'to_admin' |
                 'admin_to_wallet' | 'wallet_to_admin' | null;
type Tab = 'overview' | 'movements' | 'players';

function formatRelativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'à l\'instant';
  const min = Math.floor(seconds / 60);
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

interface ReconcileResult {
  consistent: boolean;
  diff: number;
  user_coins: number;
  treasury_balance: number;
  admin_balance: number;
  total_in_system: number;
  deposits_total: number;
  withdrawals_total: number;
  checked_at: string;
}

export default function TreasuryPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [game, setGame] = useState<TreasuryRow | null>(null);
  const [admin, setAdmin] = useState<TreasuryRow | null>(null);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [freemoTxs, setFreemoTxs] = useState<FreemoTxRow[]>([]);
  const [adminWallet, setAdminWallet] = useState<number>(0);
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);

  const loadReconcile = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('reconcile_money_system');
      if (data) setReconcile(data as ReconcileResult);
    } catch (e) {
      console.error('Reconcile error:', e);
    }
  }, []);

  const runManualReconcile = async () => {
    setReconciling(true);
    await loadReconcile();
    setReconciling(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [gameRes, adminRes, mvRes, freemoRes, walletRes] = await Promise.all([
      supabase.from('game_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('admin_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('treasury_movements').select('*')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('freemopay_transactions').select('*')
        .order('created_at', { ascending: false }).limit(200),
      supabase.rpc('get_super_admin_wallet'),
    ]);
    if (gameRes.data) setGame(gameRes.data as TreasuryRow);
    if (adminRes.data) setAdmin(adminRes.data as TreasuryRow);
    if (mvRes.data) setMovements(mvRes.data as MovementRow[]);
    if (freemoRes.data) setFreemoTxs(freemoRes.data as FreemoTxRow[]);
    if (walletRes.data && typeof walletRes.data === 'object') {
      const w = walletRes.data as { coins?: number };
      setAdminWallet(w.coins ?? 0);
    }
    await loadReconcile();
    setLoading(false);
  }, [loadReconcile]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    load();
    const sub = supabase
      .channel('treasury-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_treasury' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'treasury_movements' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'freemopay_transactions' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'freemopay_transactions' }, load)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [isSuperAdmin, load]);

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Cette section est réservée au <strong>super administrateur</strong>.</p>
        </div>
      </div>
    );
  }

  // ── Calcul des stats par jeu ──
  const gameStats: GameStat[] = (() => {
    const map = new Map<string, GameStat>();
    for (const m of movements) {
      if (!map.has(m.game_type)) {
        map.set(m.game_type, {
          game_type: m.game_type, bets_in: 0, payouts_out: 0,
          house_cut: 0, refunds_out: 0, net_profit: 0, count: 0,
        });
      }
      const s = map.get(m.game_type)!;
      s.count++;
      switch (m.movement_type) {
        case 'loss_collect': s.bets_in += m.amount; break;
        case 'payout': s.payouts_out += m.amount; break;
        case 'house_cut': s.house_cut += m.amount; break;
        case 'refund': s.refunds_out += m.amount; break;
      }
      s.net_profit = s.bets_in - s.payouts_out - s.refunds_out;
    }
    return Array.from(map.values()).sort((a, b) => b.net_profit - a.net_profit);
  })();

  // ── Stats globales ──
  const totalBetsIn = gameStats.reduce((s, g) => s + g.bets_in, 0);
  const totalPayoutsOut = gameStats.reduce((s, g) => s + g.payouts_out, 0);
  const totalHouseCut = gameStats.reduce((s, g) => s + g.house_cut, 0);
  const totalRefunds = gameStats.reduce((s, g) => s + g.refunds_out, 0);
  const totalProfit = totalBetsIn - totalPayoutsOut - totalRefunds;

  const totalDeposits = freemoTxs
    .filter(t => t.transaction_type === 'DEPOSIT' && t.status === 'SUCCESS')
    .reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = freemoTxs
    .filter(t => t.transaction_type === 'WITHDRAW' && t.status === 'SUCCESS')
    .reduce((s, t) => s + t.amount, 0);

  const filteredMovements = gameFilter === 'all'
    ? movements
    : movements.filter(m => m.game_type === gameFilter);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* RECONCILIATION BANNER */}
      {reconcile && (
        <div className={`card-plugbet relative overflow-hidden p-4 ${
          reconcile.consistent ? 'card-glow-green' : 'card-glow-red pulse-danger'
        }`}>
          <span className={`absolute left-0 top-0 h-full w-[3px] ${
            reconcile.consistent ? 'bg-primary' : 'bg-danger'
          }`} />
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              reconcile.consistent ? 'bg-primary/15 text-primary' : 'bg-danger/15 text-danger'
            }`}>
              {reconcile.consistent ? <ShieldCheck className="h-5 w-5" strokeWidth={2.5} /> : <ShieldAlert className="h-5 w-5" strokeWidth={2.5} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-wider ${
                reconcile.consistent ? 'text-primary' : 'text-danger'
              }`}>
                {reconcile.consistent ? 'Système réconcilié' : 'Imbalance détecté'}
              </p>
              <p className={`hero-number text-lg ${reconcile.consistent ? 'text-text' : 'text-danger'}`}>
                {reconcile.consistent
                  ? 'Comptabilité conforme'
                  : `Diff : ${reconcile.diff.toLocaleString()} coins`}
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Total système <strong className="text-text">{reconcile.total_in_system.toLocaleString()}</strong>
                {' · '}
                Dépôts cumulés <strong className="text-text">{reconcile.deposits_total.toLocaleString()}</strong>
                {' · '}
                Vérifié {formatRelativeTime(reconcile.checked_at)}
              </p>
            </div>
            <button
              onClick={runManualReconcile}
              disabled={reconciling}
              className="flex items-center gap-2 rounded-xl border border-border/40 bg-surface/50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-text-secondary hover:text-text hover:border-primary/30 disabled:opacity-50 transition-colors"
            >
              {reconciling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Réconcilier
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-warning">
            Plugbet · Vault
          </p>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <Vault className="h-7 w-7 text-warning" strokeWidth={2} />
            <h1 className="hero-number text-3xl text-text">Trésorerie</h1>
            <span className="rounded-md bg-warning/15 border border-warning/30 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-warning">
              Super Admin
            </span>
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            Caisse & profits — commissions 10% uniforme sur tous les jeux
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 rounded-xl border border-border/40 bg-surface-light/50 px-4 py-2 text-sm font-semibold text-text-secondary hover:border-primary/30 hover:text-text transition-colors">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* WALLET ADMIN BAR */}
      <div className="card-plugbet card-glow-green relative overflow-hidden p-5">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-center gap-4 flex-wrap">
          <div className="logo-gradient flex h-11 w-11 items-center justify-center rounded-xl">
            <Wallet className="h-5 w-5 text-surface" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
              Mon wallet personnel · Super admin
            </p>
            <p className="mt-1 text-xs text-text-secondary leading-relaxed">
              Pont Mobile Money : pour <strong className="text-text">déposer</strong> du vrai argent, fais un dépôt Freemopay sur l'app mobile puis clique <strong className="text-text">Déposer</strong>.
              Pour <strong className="text-text">retirer</strong>, clique <strong className="text-text">Retirer</strong> puis fais un retrait Freemopay sur le mobile.
            </p>
          </div>
          <p className="hero-number text-3xl text-text">
            {adminWallet.toLocaleString()}
            <span className="ml-2 text-sm font-semibold uppercase tracking-wider text-text-secondary">coins</span>
          </p>
        </div>
      </div>

      {/* TWO MAIN TREASURY CARDS */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* CAISSE JEU */}
        <div className="card-plugbet relative overflow-hidden p-6 transition-transform hover:-translate-y-0.5">
          <span className="absolute left-0 top-0 h-full w-[3px] bg-info opacity-70" />
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-info/10 blur-3xl" />
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-info/15 text-info">
                <Gamepad2 className="h-5 w-5" strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-info">Caisse du jeu</p>
                <p className="text-xs text-text-secondary">Mises perdues — jeux solo</p>
              </div>
            </div>
          </div>
          <p className="hero-number text-4xl text-text mb-4">
            {(game?.balance ?? 0).toLocaleString()}
            <span className="ml-2 text-sm font-semibold uppercase tracking-wider text-text-secondary">coins</span>
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-border/40 bg-surface/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Mises (cumul)</p>
              <p className="display-number text-base text-primary mt-0.5">+{(game?.total_received ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-surface/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Gains payés</p>
              <p className="display-number text-base text-danger mt-0.5">−{(game?.total_paid_out ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <button
            onClick={() => setModal('to_admin')}
            disabled={!game || game.balance <= 0}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-info/30 bg-info/10 py-2.5 text-sm font-bold uppercase tracking-wider text-info hover:bg-info/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
            Transférer vers admin
          </button>
        </div>

        {/* CAISSE SUPER ADMIN */}
        <div className="card-plugbet card-glow-warning relative overflow-hidden p-6 transition-transform hover:-translate-y-0.5">
          <span className="absolute left-0 top-0 h-full w-[3px] bg-warning opacity-70" />
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-warning/10 blur-3xl" />
          <div className="relative flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning/15 text-warning">
                <Coins className="h-5 w-5" strokeWidth={2.5} />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-warning">Caisse super admin</p>
                <p className="text-xs text-text-secondary">Profits — commissions multijoueur</p>
              </div>
            </div>
          </div>
          <p className="hero-number text-4xl text-text mb-4">
            {(admin?.balance ?? 0).toLocaleString()}
            <span className="ml-2 text-sm font-semibold uppercase tracking-wider text-text-secondary">coins</span>
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-border/40 bg-surface/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Encaissé</p>
              <p className="display-number text-sm text-primary mt-0.5">+{(admin?.total_earned ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-surface/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Retiré</p>
              <p className="display-number text-sm text-info mt-0.5">−{(admin?.total_withdrawn ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-border/40 bg-surface/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">Déposé</p>
              <p className="display-number text-sm text-text mt-0.5">+{(admin?.total_deposited ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => setModal('admin_to_wallet')}
              disabled={!admin || admin.balance <= 0}
              className="flex items-center justify-center gap-1 rounded-xl bg-warning py-2.5 text-xs font-semibold text-white hover:bg-warning/80 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Sortir des coins de la caisse vers ton wallet personnel (puis retire en Mobile Money via le mobile)"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Retirer
            </button>
            <button
              onClick={() => setModal('wallet_to_admin')}
              disabled={adminWallet <= 0}
              className="flex items-center justify-center gap-1 rounded-xl bg-success/15 border border-success/30 py-2.5 text-xs font-semibold text-success hover:bg-success/25 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Envoyer des coins de ton wallet (rechargé via Mobile Money sur le mobile) vers la caisse admin"
            >
              <ArrowUpFromLine className="h-3.5 w-3.5" />
              Déposer
            </button>
            <button
              onClick={() => setModal('to_game')}
              disabled={!admin || admin.balance <= 0}
              className="flex items-center justify-center gap-1 rounded-xl bg-info/15 border border-info/30 py-2.5 text-xs font-semibold text-info hover:bg-info/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              → Jeu
            </button>
          </div>
        </div>
      </div>

      {/* GLOBAL STATS — flux d'argent */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<ArrowDownCircle className="h-5 w-5" />}
          label="Mises encaissées (jeux)"
          value={totalBetsIn}
          color="success"
        />
        <StatCard
          icon={<ArrowUpCircle className="h-5 w-5" />}
          label="Gains payés (jeux)"
          value={totalPayoutsOut}
          color="info"
          negative
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Profit net total"
          value={totalProfit}
          color={totalProfit >= 0 ? 'success' : 'danger'}
        />
        <StatCard
          icon={<Smartphone className="h-5 w-5" />}
          label="Dépôts joueurs"
          value={totalDeposits}
          color="success"
          subtitle="Mobile Money"
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Retraits joueurs"
          value={totalWithdrawals}
          color="warning"
          negative
          subtitle="Mobile Money"
        />
      </div>

      {/* TABS */}
      <div className="border-b border-border/30">
        <div className="flex gap-1">
          {([
            { id: 'overview', label: 'Vue par jeu', icon: <Gamepad2 className="h-4 w-4" /> },
            { id: 'movements', label: 'Mouvements treasury', icon: <ArrowLeftRight className="h-4 w-4" /> },
            { id: 'players', label: 'Dépôts/Retraits joueurs', icon: <Smartphone className="h-4 w-4" /> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB: VUE PAR JEU */}
      {tab === 'overview' && (
        <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
          {gameStats.length === 0 ? (
            <div className="p-12 text-center">
              <Gamepad2 className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
              <p className="font-semibold text-text">Aucun mouvement enregistré</p>
              <p className="mt-2 text-sm text-text-muted">Les stats par jeu apparaîtront ici dès la première partie.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-border/20 bg-surface">
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th className="px-4 py-3">Jeu</th>
                  <th className="px-4 py-3 text-right">Mises encaissées</th>
                  <th className="px-4 py-3 text-right">Gains payés</th>
                  <th className="px-4 py-3 text-right">Refunds</th>
                  <th className="px-4 py-3 text-right">Commission 10%</th>
                  <th className="px-4 py-3 text-right">Profit net</th>
                  <th className="px-4 py-3 text-right">Mouvements</th>
                </tr>
              </thead>
              <tbody>
                {gameStats.map(g => (
                  <tr key={g.game_type} className="border-b border-border/10 hover:bg-surface-lighter">
                    <td className="px-4 py-3 font-semibold text-text">
                      {gameLabels[g.game_type] ?? g.game_type}
                    </td>
                    <td className="px-4 py-3 text-right text-success">+{g.bets_in.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-info">−{g.payouts_out.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-text-muted">−{g.refunds_out.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-warning">+{g.house_cut.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-bold ${g.net_profit >= 0 ? 'text-success' : 'text-danger'}`}>
                      {g.net_profit >= 0 ? '+' : ''}{g.net_profit.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-text-muted">{g.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border/30 bg-surface font-bold">
                <tr>
                  <td className="px-4 py-3 text-text">TOTAL</td>
                  <td className="px-4 py-3 text-right text-success">+{totalBetsIn.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-info">−{totalPayoutsOut.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-text-muted">−{totalRefunds.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-warning">+{totalHouseCut.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right ${totalProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                    {totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted">{movements.length}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* TAB: MOUVEMENTS */}
      {tab === 'movements' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-text-muted">Filtrer :</span>
            <select
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              className="rounded-lg border border-border/30 bg-surface-light px-3 py-1.5 text-sm text-text"
            >
              <option value="all">Tous les jeux</option>
              {Object.keys(gameLabels).map(g => (
                <option key={g} value={g}>{gameLabels[g]}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted ml-auto">{filteredMovements.length} mouvements</span>
          </div>
          {filteredMovements.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
              <Vault className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
              <p className="font-semibold text-text">Aucun mouvement</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-border/20 bg-surface">
                  <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Jeu</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Game ID</th>
                    <th className="px-4 py-3 text-right">Pot total</th>
                    <th className="px-4 py-3 text-right">Edge</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map(m => {
                    const isIncome = ['loss_collect', 'house_cut'].includes(m.movement_type);
                    return (
                      <tr key={m.id} className="border-b border-border/10 hover:bg-surface-lighter">
                        <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                          {format(new Date(m.created_at), 'dd MMM HH:mm:ss', { locale: fr })}
                        </td>
                        <td className="px-4 py-3 text-sm text-text">
                          {gameLabels[m.game_type] ?? m.game_type}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            isIncome ? 'bg-success/15 text-success' : 'bg-info/15 text-info'
                          }`}>
                            {isIncome ? <ArrowDownCircle className="h-3 w-3" /> : <ArrowUpCircle className="h-3 w-3" />}
                            {movementLabels[m.movement_type] ?? m.movement_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted font-mono truncate max-w-[120px]">
                          {m.game_id?.slice(0, 8) ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-text-muted">
                          {m.pot_total ? m.pot_total.toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-text-muted">
                          {m.edge_pct ? `${(m.edge_pct * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${isIncome ? 'text-success' : 'text-info'}`}>
                          {isIncome ? '+' : '−'}{m.amount.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: DÉPÔTS/RETRAITS JOUEURS */}
      {tab === 'players' && (
        <div>
          {freemoTxs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
              <Smartphone className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
              <p className="font-semibold text-text">Aucune transaction Mobile Money</p>
              <p className="mt-2 text-sm text-text-muted">Les dépôts et retraits via Freemopay apparaîtront ici.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
              <table className="w-full">
                <thead className="border-b border-border/20 bg-surface">
                  <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Téléphone</th>
                    <th className="px-4 py-3">Référence</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {freemoTxs.map(t => {
                    const isDeposit = t.transaction_type === 'DEPOSIT';
                    const statusColor = t.status === 'SUCCESS' ? 'success' :
                                        t.status === 'FAILED' ? 'danger' : 'warning';
                    return (
                      <tr key={t.id} className="border-b border-border/10 hover:bg-surface-lighter">
                        <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                          {format(new Date(t.created_at), 'dd MMM HH:mm', { locale: fr })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            isDeposit ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                          }`}>
                            {isDeposit ? <ArrowDownCircle className="h-3 w-3" /> : <ArrowUpCircle className="h-3 w-3" />}
                            {isDeposit ? 'Dépôt' : 'Retrait'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase bg-${statusColor}/15 text-${statusColor}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text font-mono">
                          {t.payer_or_receiver ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-text-muted font-mono truncate max-w-[140px]">
                          {t.reference}
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${
                          t.status !== 'SUCCESS' ? 'text-text-muted' :
                          isDeposit ? 'text-success' : 'text-warning'
                        }`}>
                          {t.status !== 'SUCCESS' ? '' : (isDeposit ? '+' : '−')}
                          {t.amount.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Action modals */}
      {modal && (
        <ActionModal
          type={modal}
          gameBalance={game?.balance ?? 0}
          adminBalance={admin?.balance ?? 0}
          walletBalance={adminWallet}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

// ── StatCard component ──
function StatCard({ icon, label, value, color, subtitle, negative }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'success' | 'info' | 'warning' | 'danger';
  subtitle?: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/20 bg-surface-light p-4">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg bg-${color}/15 p-2 text-${color}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-muted truncate">{label}</p>
          <p className={`mt-0.5 font-bold text-${color}`}>
            {negative && value > 0 ? '−' : value < 0 ? '−' : '+'}
            {Math.abs(value).toLocaleString()}
          </p>
          {subtitle && <p className="text-[10px] text-text-muted">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function ActionModal({ type, gameBalance, adminBalance, walletBalance, onClose, onSuccess }: {
  type: ModalType;
  gameBalance: number;
  adminBalance: number;
  walletBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const config = {
    withdraw:         { title: 'Retirer des profits (compte)',           rpc: 'admin_treasury_withdraw',         max: adminBalance,  color: 'warning' },
    deposit:          { title: 'Déposer dans la caisse admin (compte)',  rpc: 'admin_treasury_deposit',          max: 999999999,     color: 'success' },
    to_game:          { title: 'Renflouer la caisse du jeu',             rpc: 'treasury_transfer_admin_to_game', max: adminBalance,  color: 'info' },
    to_admin:         { title: 'Récupérer depuis la caisse du jeu',      rpc: 'treasury_transfer_game_to_admin', max: gameBalance,   color: 'info' },
    admin_to_wallet:  { title: 'Caisse admin → Mon wallet',              rpc: 'admin_treasury_to_wallet',        max: adminBalance,  color: 'success' },
    wallet_to_admin:  { title: 'Mon wallet → Caisse admin',              rpc: 'wallet_to_admin_treasury',        max: walletBalance, color: 'info' },
  }[type!]!;

  // Note d'aide selon le type d'opération
  const helpText: Record<string, string> = {
    admin_to_wallet: 'Les coins seront transférés vers ton wallet personnel. Tu pourras ensuite les retirer en vrai argent via Freemopay sur l\'app mobile.',
    wallet_to_admin: 'Les coins de ton wallet personnel iront alimenter la caisse admin. Avant cette opération, fais un dépôt Freemopay via l\'app mobile pour avoir des coins.',
    withdraw: 'Note comptable uniquement — décrémente la caisse admin sans transférer d\'argent. Pour du vrai argent, utilise plutôt "Caisse admin → Mon wallet".',
    deposit: 'Note comptable uniquement — incrémente la caisse admin sans recevoir d\'argent. Pour du vrai argent, utilise plutôt "Wallet → Caisse admin".',
  };

  const handle = async () => {
    setError('');
    const n = parseInt(amount, 10);
    if (isNaN(n) || n <= 0) { setError('Montant invalide'); return; }
    if (n > config.max) { setError('Montant supérieur au solde disponible'); return; }

    setLoading(true);
    const { data, error: rpcErr } = await supabase.rpc(config.rpc, {
      p_amount: n,
      p_description: description.trim() || null,
    });
    setLoading(false);

    if (rpcErr) { setError(rpcErr.message); return; }
    if (data?.success === false) { setError(data.error ?? 'Erreur'); return; }
    setSuccess(true);
    setTimeout(onSuccess, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/30 bg-surface-light shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/20 p-5">
          <h3 className="font-bold text-text">{config.title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Help text contextuel pour les nouvelles opérations */}
          {helpText[type!] && (
            <div className="rounded-xl border border-info/20 bg-info/5 p-3">
              <p className="text-xs text-text-muted">{helpText[type!]}</p>
            </div>
          )}

          {type !== 'deposit' && (
            <div className={`rounded-xl border p-3 ${
              type === 'to_admin' || type === 'wallet_to_admin' ? 'bg-info/5 border-info/20' :
              type === 'admin_to_wallet' ? 'bg-success/5 border-success/20' :
              'bg-warning/5 border-warning/20'
            }`}>
              <p className="text-xs text-text-muted">Solde disponible</p>
              <p className={`text-2xl font-bold ${
                type === 'to_admin' || type === 'wallet_to_admin' ? 'text-info' :
                type === 'admin_to_wallet' ? 'text-success' : 'text-warning'
              }`}>
                {config.max.toLocaleString()} coins
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 border border-success/20 p-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Opération effectuée !
            </div>
          )}

          {type !== 'deposit' && (
            <div className="flex gap-2">
              {[0.25, 0.5, 0.75, 1].map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(Math.floor(config.max * p)))}
                  className="flex-1 rounded-lg border border-border/30 px-2 py-1.5 text-xs font-medium text-text-muted hover:border-primary hover:text-primary"
                >
                  {p === 1 ? 'Tout' : `${p * 100}%`}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">Montant</label>
            <input
              type="number" min="1" max={config.max} value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className={`w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-lg font-bold text-text focus:outline-none focus:border-${config.color}`}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">Description (optionnel)</label>
            <input
              type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Salaire mensuel"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:outline-none focus:border-primary"
            />
          </div>

          <button
            onClick={handle}
            disabled={loading || success}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 ${
              type === 'withdraw' ? 'bg-warning hover:bg-warning/80' :
              type === 'deposit' ? 'bg-success hover:bg-success/80' :
              'bg-info hover:bg-info/80'
            }`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> :
             type === 'withdraw' ? <ArrowDownToLine className="h-4 w-4" /> :
             type === 'deposit' ? <ArrowUpFromLine className="h-4 w-4" /> :
             <ArrowLeftRight className="h-4 w-4" />}
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
