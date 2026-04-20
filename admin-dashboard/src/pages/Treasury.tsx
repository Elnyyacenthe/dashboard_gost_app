import { useEffect, useState, useCallback } from 'react';
import {
  Vault, TrendingUp, TrendingDown, ArrowDownToLine, RefreshCw,
  Shield, Lock, CheckCircle2, X, Loader2, AlertTriangle,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface TreasuryState {
  balance: number;
  total_earned: number;
  total_withdrawn: number;
  updated_at: string;
}

interface TxRow {
  id: string;
  type: 'earning' | 'withdrawal';
  amount: number;
  source: string;
  description: string | null;
  admin_id: string | null;
  user_id: string | null;
  created_at: string;
}

const sourceLabels: Record<string, string> = {
  mines_loss: 'Mines — Joueur a perdu',
  aviator_crash: 'Aviator — Crash',
  apple_fortune_loss: 'Apple Fortune — Pomme pourrie',
  roulette_loss: 'Roulette — Maison gagne',
  blackjack_loss: 'Blackjack — Dealer gagne',
  manual_withdraw: 'Retrait manuel',
};

export default function TreasuryPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [treasuryRes, txRes] = await Promise.all([
      supabase.from('project_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('treasury_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (treasuryRes.data) setTreasury(treasuryRes.data as TreasuryState);
    if (txRes.data) setTxs(txRes.data as TxRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    load();
    const sub = supabase
      .channel('treasury-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_treasury' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'treasury_transactions' }, load)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [isSuperAdmin, load]);

  if (authLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Accès refusé si pas super_admin
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">
            Cette section est réservée au <strong>super administrateur</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Vault className="h-6 w-6 text-warning" />
            <h1 className="text-2xl font-bold text-text">Trésorerie du projet</h1>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              Super Admin
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Profits générés par la maison — différents de votre compte joueur
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 rounded-lg border border-border/30 px-4 py-2 text-sm text-text-muted hover:bg-surface-lighter hover:text-text"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <button
            onClick={() => setShowWithdrawModal(true)}
            disabled={!treasury || treasury.balance <= 0}
            className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white hover:bg-warning/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Retirer des profits
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-info/20 bg-info/5 p-4">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="text-sm text-text-muted">
          <p className="mb-1 font-medium text-text">Comptes séparés</p>
          <p>
            La <strong>caisse projet</strong> contient les profits générés par la house edge
            (joueurs qui perdent aux jeux). C'est différent de votre <strong>caisse joueur</strong>
            qui contient vos coins personnels pour jouer. Seul vous (super admin) pouvez voir et
            retirer ces profits depuis ce panneau.
          </p>
        </div>
      </div>

      {/* Main stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="col-span-full rounded-2xl border border-warning/30 bg-gradient-to-br from-warning/15 to-warning/5 p-8">
          <div className="flex items-center gap-2 mb-2">
            <Vault className="h-5 w-5 text-warning" />
            <p className="text-sm font-medium text-warning">Solde actuel de la trésorerie</p>
          </div>
          <p className="text-5xl font-black text-text">
            {(treasury?.balance ?? 0).toLocaleString()} <span className="text-2xl text-text-muted">coins</span>
          </p>
          {treasury && (
            <p className="mt-2 text-xs text-text-muted">
              Dernière maj : {format(new Date(treasury.updated_at), 'dd MMM yyyy HH:mm', { locale: fr })}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-success/20 bg-surface-light p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-lg bg-success/10 p-2">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <p className="text-sm text-text-muted">Total encaissé (cumulé)</p>
          </div>
          <p className="text-2xl font-bold text-text">
            {(treasury?.total_earned ?? 0).toLocaleString()} <span className="text-sm text-text-muted">coins</span>
          </p>
        </div>

        <div className="rounded-2xl border border-info/20 bg-surface-light p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-lg bg-info/10 p-2">
              <TrendingDown className="h-5 w-5 text-info" />
            </div>
            <p className="text-sm text-text-muted">Total retiré</p>
          </div>
          <p className="text-2xl font-bold text-text">
            {(treasury?.total_withdrawn ?? 0).toLocaleString()} <span className="text-sm text-text-muted">coins</span>
          </p>
        </div>

        <div className="rounded-2xl border border-border/20 bg-surface-light p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <ArrowDownCircle className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm text-text-muted">Gains récents (24h)</p>
          </div>
          <p className="text-2xl font-bold text-text">
            {txs
              .filter(t => t.type === 'earning' && new Date(t.created_at) > new Date(Date.now() - 86400000))
              .reduce((s, t) => s + t.amount, 0)
              .toLocaleString()}
            <span className="text-sm text-text-muted"> coins</span>
          </p>
        </div>
      </div>

      {/* History */}
      <div>
        <h2 className="mb-4 text-lg font-bold text-text">Historique des transactions</h2>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : txs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
            <Vault className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
            <p className="font-semibold text-text">Aucune transaction</p>
            <p className="mt-2 text-sm text-text-muted">
              Les gains de la maison apparaîtront ici quand les joueurs perdront aux jeux.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border/20 bg-surface">
                <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {txs.map(tx => (
                  <tr key={tx.id} className="border-b border-border/10 hover:bg-surface-lighter transition-colors">
                    <td className="px-5 py-3 text-sm text-text-muted">
                      {format(new Date(tx.created_at), 'dd MMM HH:mm', { locale: fr })}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        tx.type === 'earning' ? 'bg-success/15 text-success' : 'bg-info/15 text-info'
                      }`}>
                        {tx.type === 'earning' ? <ArrowDownCircle className="h-3 w-3" /> : <ArrowUpCircle className="h-3 w-3" />}
                        {tx.type === 'earning' ? 'Gain' : 'Retrait'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-text">
                      {sourceLabels[tx.source] ?? tx.source}
                      {tx.description && (
                        <span className="block text-xs text-text-muted mt-0.5">{tx.description}</span>
                      )}
                    </td>
                    <td className={`px-5 py-3 text-right font-bold ${
                      tx.type === 'earning' ? 'text-success' : 'text-info'
                    }`}>
                      {tx.type === 'earning' ? '+' : '−'}{tx.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Withdraw modal */}
      {showWithdrawModal && treasury && (
        <WithdrawModal
          balance={treasury.balance}
          onClose={() => setShowWithdrawModal(false)}
          onSuccess={() => { setShowWithdrawModal(false); load(); }}
        />
      )}
    </div>
  );
}

function WithdrawModal({ balance, onClose, onSuccess }: {
  balance: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleWithdraw = async () => {
    setError('');
    const n = parseInt(amount, 10);
    if (isNaN(n) || n <= 0) { setError('Montant invalide'); return; }
    if (n > balance) { setError('Solde insuffisant'); return; }

    setLoading(true);
    const { data, error: rpcErr } = await supabase.rpc('treasury_withdraw', {
      p_amount: n,
      p_description: description.trim() || null,
    });
    setLoading(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    if (data?.success === false) {
      setError(data.error ?? 'Erreur inconnue');
      return;
    }
    setSuccess(true);
    setTimeout(onSuccess, 1500);
  };

  const quickAmounts = [
    { label: '25%', val: Math.floor(balance * 0.25) },
    { label: '50%', val: Math.floor(balance * 0.50) },
    { label: '75%', val: Math.floor(balance * 0.75) },
    { label: 'Tout', val: balance },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border/30 bg-surface-light shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/20 p-5">
          <div className="flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-warning" />
            <h3 className="font-bold text-text">Retirer des profits</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-warning/5 border border-warning/20 p-3">
            <p className="text-xs text-text-muted">Solde disponible</p>
            <p className="text-2xl font-bold text-warning">{balance.toLocaleString()} coins</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" /> {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 border border-success/20 p-3 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Retrait effectué avec succès !
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">Raccourcis</label>
            <div className="flex gap-2">
              {quickAmounts.map(q => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setAmount(String(q.val))}
                  className="flex-1 rounded-lg border border-border/30 px-2 py-1.5 text-xs font-medium text-text-muted hover:border-warning/40 hover:text-warning"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">
              Montant à retirer
            </label>
            <input
              type="number"
              min="1"
              max={balance}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-lg font-bold text-text focus:border-warning focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">
              Description (optionnel)
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Retrait mensuel profits"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-warning focus:outline-none"
            />
          </div>

          <button
            onClick={handleWithdraw}
            disabled={loading || success}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-warning py-3 text-sm font-semibold text-white hover:bg-warning/80 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
            Confirmer le retrait
          </button>
        </div>
      </div>
    </div>
  );
}
