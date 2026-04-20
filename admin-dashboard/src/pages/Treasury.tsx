import { useEffect, useState, useCallback } from 'react';
import {
  Vault, TrendingUp, TrendingDown, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Lock, CheckCircle2, X, Loader2, AlertTriangle, Coins, Gamepad2,
  ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, ArrowRight,
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

interface TxRow {
  id: string;
  treasury_type: 'game' | 'admin';
  type: 'earning' | 'payout' | 'commission' | 'withdrawal' | 'deposit' | 'transfer_to_game' | 'transfer_to_admin';
  amount: number;
  game_type: string | null;
  source: string | null;
  description: string | null;
  admin_id: string | null;
  user_id: string | null;
  created_at: string;
}

const typeLabels: Record<string, string> = {
  earning: 'Gain',
  payout: 'Paiement gagnant',
  commission: 'Commission',
  withdrawal: 'Retrait',
  deposit: 'Dépôt',
  transfer_to_game: 'Transfert → Jeu',
  transfer_to_admin: 'Transfert → Admin',
};

type ModalType = 'withdraw' | 'deposit' | 'to_game' | 'to_admin' | null;

export default function TreasuryPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [game, setGame] = useState<TreasuryRow | null>(null);
  const [admin, setAdmin] = useState<TreasuryRow | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'game' | 'admin'>('all');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalType>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [gameRes, adminRes, txRes] = await Promise.all([
      supabase.from('game_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('admin_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('treasury_transactions').select('*')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (gameRes.data) setGame(gameRes.data as TreasuryRow);
    if (adminRes.data) setAdmin(adminRes.data as TreasuryRow);
    if (txRes.data) setTxs(txRes.data as TxRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    load();
    const sub = supabase
      .channel('treasury-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_treasury' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_treasury' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'treasury_transactions' }, load)
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

  const filteredTxs = filter === 'all' ? txs : txs.filter(t => t.treasury_type === filter);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Vault className="h-6 w-6 text-warning" />
            <h1 className="text-2xl font-bold text-text">Trésorerie</h1>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              Super Admin
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Caisse du jeu (solo) et profits du fondateur (commissions)
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 rounded-lg border border-border/30 px-4 py-2 text-sm text-text-muted hover:bg-surface-lighter hover:text-text">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </div>

      {/* Two main treasury cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* CAISSE JEU */}
        <div className="rounded-2xl border border-info/30 bg-gradient-to-br from-info/15 to-info/5 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-info/20 p-2"><Gamepad2 className="h-5 w-5 text-info" /></div>
              <div>
                <p className="text-sm font-medium text-info">Caisse du jeu</p>
                <p className="text-xs text-text-muted">Liquidités pour payer les gagnants en solo</p>
              </div>
            </div>
          </div>
          <p className="text-4xl font-black text-text mb-3">
            {(game?.balance ?? 0).toLocaleString()} <span className="text-base text-text-muted">coins</span>
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-surface/50 p-2.5">
              <p className="text-text-muted">Mises perdues (cumul)</p>
              <p className="font-bold text-success">+{(game?.total_received ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-surface/50 p-2.5">
              <p className="text-text-muted">Gains payés (cumul)</p>
              <p className="font-bold text-danger">−{(game?.total_paid_out ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <button
            onClick={() => setModal('to_admin')}
            disabled={!game || game.balance <= 0}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-info/15 border border-info/30 py-2.5 text-sm font-semibold text-info hover:bg-info/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowRight className="h-4 w-4" />
            Transférer vers caisse admin
          </button>
        </div>

        {/* CAISSE SUPER ADMIN */}
        <div className="rounded-2xl border border-warning/30 bg-gradient-to-br from-warning/15 to-warning/5 p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-warning/20 p-2"><Coins className="h-5 w-5 text-warning" /></div>
              <div>
                <p className="text-sm font-medium text-warning">Caisse super admin</p>
                <p className="text-xs text-text-muted">Profits — Commissions multijoueur</p>
              </div>
            </div>
          </div>
          <p className="text-4xl font-black text-text mb-3">
            {(admin?.balance ?? 0).toLocaleString()} <span className="text-base text-text-muted">coins</span>
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-surface/50 p-2.5">
              <p className="text-text-muted">Encaissé</p>
              <p className="font-bold text-success">+{(admin?.total_earned ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-surface/50 p-2.5">
              <p className="text-text-muted">Retiré</p>
              <p className="font-bold text-info">−{(admin?.total_withdrawn ?? 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-surface/50 p-2.5">
              <p className="text-text-muted">Déposé</p>
              <p className="font-bold text-text">+{(admin?.total_deposited ?? 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              onClick={() => setModal('withdraw')}
              disabled={!admin || admin.balance <= 0}
              className="flex items-center justify-center gap-1 rounded-xl bg-warning py-2.5 text-xs font-semibold text-white hover:bg-warning/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Retirer
            </button>
            <button
              onClick={() => setModal('deposit')}
              className="flex items-center justify-center gap-1 rounded-xl bg-success/15 border border-success/30 py-2.5 text-xs font-semibold text-success hover:bg-success/25"
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

      {/* Commission rates info */}
      <div className="rounded-xl border border-border/20 bg-surface-light p-4">
        <p className="text-sm font-semibold text-text mb-3">Taux de commission par jeu</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-surface p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-muted">Jeux à 10%</span>
              <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-bold text-info">10%</span>
            </div>
            <p className="text-xs text-text">Cora Dice • Blackjack • Roulette • Pile ou Face • Solitaire</p>
          </div>
          <div className="rounded-lg bg-surface p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-muted">Jeux à 15%</span>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning">15%</span>
            </div>
            <p className="text-xs text-text">Ludo • Dames • Fantasy Premier League</p>
          </div>
        </div>
      </div>

      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text">Historique</h2>
          <div className="flex gap-1 rounded-lg border border-border/30 bg-surface-light p-1">
            {(['all', 'game', 'admin'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1 text-xs font-medium ${
                  filter === f ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {f === 'all' ? 'Toutes' : f === 'game' ? 'Caisse jeu' : 'Caisse admin'}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filteredTxs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
            <Vault className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
            <p className="font-semibold text-text">Aucune transaction</p>
            <p className="mt-2 text-sm text-text-muted">Les mouvements apparaîtront ici en temps réel.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border/20 bg-surface">
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Caisse</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Jeu</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {filteredTxs.map(tx => {
                  const isIncome = ['earning', 'commission', 'deposit', 'transfer_to_admin'].includes(tx.type);
                  const isOutgoing = ['payout', 'withdrawal', 'transfer_to_game'].includes(tx.type);
                  return (
                    <tr key={tx.id} className="border-b border-border/10 hover:bg-surface-lighter">
                      <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                        {format(new Date(tx.created_at), 'dd MMM HH:mm', { locale: fr })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                          tx.treasury_type === 'admin' ? 'bg-warning/15 text-warning' : 'bg-info/15 text-info'
                        }`}>
                          {tx.treasury_type === 'admin' ? 'ADMIN' : 'JEU'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          isIncome ? 'bg-success/15 text-success' : isOutgoing ? 'bg-info/15 text-info' : 'bg-text-muted/15 text-text-muted'
                        }`}>
                          {isIncome ? <ArrowDownCircle className="h-3 w-3" /> : <ArrowUpCircle className="h-3 w-3" />}
                          {typeLabels[tx.type] ?? tx.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted capitalize">{tx.game_type ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-text max-w-xs truncate">{tx.description ?? tx.source ?? '—'}</td>
                      <td className={`px-4 py-3 text-right font-bold ${isIncome ? 'text-success' : 'text-info'}`}>
                        {isIncome ? '+' : '−'}{tx.amount.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action modals */}
      {modal && (
        <ActionModal
          type={modal}
          gameBalance={game?.balance ?? 0}
          adminBalance={admin?.balance ?? 0}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function ActionModal({ type, gameBalance, adminBalance, onClose, onSuccess }: {
  type: ModalType;
  gameBalance: number;
  adminBalance: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const config = {
    withdraw:   { title: 'Retirer des profits',                rpc: 'admin_treasury_withdraw',         max: adminBalance, color: 'warning' },
    deposit:    { title: 'Déposer dans la caisse admin',       rpc: 'admin_treasury_deposit',          max: 999999999,    color: 'success' },
    to_game:    { title: 'Renflouer la caisse du jeu',         rpc: 'treasury_transfer_admin_to_game', max: adminBalance, color: 'info' },
    to_admin:   { title: 'Récupérer depuis la caisse du jeu',  rpc: 'treasury_transfer_game_to_admin', max: gameBalance,  color: 'info' },
  }[type!]!;

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
          {type !== 'deposit' && (
            <div className={`rounded-xl border p-3 ${
              type === 'to_admin' ? 'bg-info/5 border-info/20' : 'bg-warning/5 border-warning/20'
            }`}>
              <p className="text-xs text-text-muted">Solde disponible</p>
              <p className={`text-2xl font-bold ${type === 'to_admin' ? 'text-info' : 'text-warning'}`}>
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

// Re-export for icons
export { TrendingUp, TrendingDown };
