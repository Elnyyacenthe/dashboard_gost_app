// ============================================================
// AUDIT - Tracabilite complete des mouvements d'argent
// ============================================================
import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Lock, Loader2, RefreshCw, Search, Scale,
  ArrowDownCircle, ArrowUpCircle, AlertTriangle, CheckCircle2,
  TrendingUp, Wallet, Vault, User, Smartphone,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface MovementRow {
  id: string;
  game_type: string;
  user_id: string | null;
  movement_type: string;
  amount: number;
  game_id: string | null;
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
  created_at: string;
}

interface UserRow {
  id: string;
  username: string | null;
  coins: number;
}

interface AdminTreasury {
  balance: number;
  total_earned: number;
  total_withdrawn: number;
  total_deposited: number;
}

interface GameTreasury {
  balance: number;
  total_received: number;
  total_paid_out: number;
}

const movementLabels: Record<string, string> = {
  loss_collect: 'Mise reçue',
  payout: 'Paiement gagnant',
  house_cut: 'Commission 10%',
  refund: 'Remboursement',
  jackpot: 'Jackpot',
  adjustment: 'Ajustement',
};

export default function AuditPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [freemoTxs, setFreemoTxs] = useState<FreemoTxRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [admin, setAdmin] = useState<AdminTreasury | null>(null);
  const [gameTreasury, setGameTreasury] = useState<GameTreasury | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [mvRes, fmRes, uRes, aRes, gRes] = await Promise.all([
      supabase.from('treasury_movements').select('*')
        .order('created_at', { ascending: false }).limit(10000),
      supabase.from('kpay_transactions').select('*')
        .order('created_at', { ascending: false }).limit(2000),
      supabase.from('user_profiles').select('id, username, coins').limit(5000),
      supabase.from('admin_treasury').select('*').eq('id', 1).maybeSingle(),
      supabase.from('game_treasury').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (mvRes.data) setMovements(mvRes.data as MovementRow[]);
    if (fmRes.data) setFreemoTxs(fmRes.data as FreemoTxRow[]);
    if (uRes.data) setUsers(uRes.data as UserRow[]);
    if (aRes.data) setAdmin(aRes.data as AdminTreasury);
    if (gRes.data) setGameTreasury(gRes.data as GameTreasury);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    load();
  }, [isSuperAdmin, load]);

  // ── Map user_id -> username pour affichage ──
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach(u => m.set(u.id, u.username ?? '(sans nom)'));
    return m;
  }, [users]);

  // ── Calculs zero-sum ──
  const totalUserCoins = users.reduce((s, u) => s + (u.coins ?? 0), 0);
  const adminBalance = admin?.balance ?? 0;
  const gameBalance = gameTreasury?.balance ?? 0;
  const totalSystemCoins = totalUserCoins + adminBalance + gameBalance;

  // Real money entered/exited via Mobile Money (succès uniquement)
  const realMoneyIn = freemoTxs
    .filter(t => t.transaction_type === 'DEPOSIT' && t.status === 'SUCCESS')
    .reduce((s, t) => s + t.amount, 0);
  const realMoneyOut = freemoTxs
    .filter(t => t.transaction_type === 'WITHDRAW' && t.status === 'SUCCESS')
    .reduce((s, t) => s + t.amount, 0);

  const expectedCoins = realMoneyIn - realMoneyOut;
  const discrepancy = totalSystemCoins - expectedCoins;
  const isBalanced = Math.abs(discrepancy) < 1; // Toleration 1 coin pour arrondis

  // ── Filtrage user search ──
  const filteredUsers = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return users
      .filter(u => (u.username ?? '').toLowerCase().includes(q) || u.id.includes(q))
      .slice(0, 10);
  }, [users, search]);

  // ── Mouvements filtrés pour le user sélectionné ──
  const userMovements = useMemo(() => {
    if (!selectedUser) return [];
    return movements.filter(m => m.user_id === selectedUser.id);
  }, [movements, selectedUser]);

  const userFreemoTxs = useMemo(() => {
    if (!selectedUser) return [];
    return freemoTxs.filter(t => t.user_id === selectedUser.id);
  }, [freemoTxs, selectedUser]);

  // ── Stats user sélectionné ──
  const userStats = useMemo(() => {
    if (!selectedUser) return null;
    const betsLost = userMovements
      .filter(m => m.movement_type === 'loss_collect')
      .reduce((s, m) => s + m.amount, 0);
    const wins = userMovements
      .filter(m => m.movement_type === 'payout')
      .reduce((s, m) => s + m.amount, 0);
    const refunds = userMovements
      .filter(m => m.movement_type === 'refund')
      .reduce((s, m) => s + m.amount, 0);
    const deposits = userFreemoTxs
      .filter(t => t.transaction_type === 'DEPOSIT' && t.status === 'SUCCESS')
      .reduce((s, t) => s + t.amount, 0);
    const withdrawals = userFreemoTxs
      .filter(t => t.transaction_type === 'WITHDRAW' && t.status === 'SUCCESS')
      .reduce((s, t) => s + t.amount, 0);
    return { betsLost, wins, refunds, deposits, withdrawals };
  }, [selectedUser, userMovements, userFreemoTxs]);

  // ── Mouvements admin (adjustments + transfers) ──
  const adminActions = useMemo(() =>
    movements.filter(m => m.game_type === 'system' || m.movement_type === 'adjustment'),
    [movements]
  );

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-warning" />
            <h1 className="text-2xl font-bold text-text">Comptabilité & Audit</h1>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
              Super Admin
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Traçabilité complète des mouvements d'argent — caisses, joueurs, Mobile Money
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

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* ZERO-SUM CHECK */}
          <div className={`rounded-2xl border p-6 ${
            isBalanced
              ? 'border-success/30 bg-gradient-to-br from-success/10 to-success/5'
              : 'border-danger/30 bg-gradient-to-br from-danger/10 to-danger/5'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              {isBalanced ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-danger" />
              )}
              <div>
                <h2 className="text-lg font-bold text-text">
                  {isBalanced ? 'Système équilibré ✓' : 'Discrépance détectée ⚠️'}
                </h2>
                <p className="text-xs text-text-muted">
                  Vérification que tous les coins du système viennent bien d'un dépôt Mobile Money réel
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 text-sm">
              <BalanceCard
                icon={<User className="h-4 w-4" />}
                label="Coins joueurs (somme)"
                value={totalUserCoins}
                color="info"
              />
              <BalanceCard
                icon={<Vault className="h-4 w-4" />}
                label="Caisse super admin"
                value={adminBalance}
                color="warning"
              />
              <BalanceCard
                icon={<Wallet className="h-4 w-4" />}
                label="Caisse jeu"
                value={gameBalance}
                color="info"
              />
              <BalanceCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Total système"
                value={totalSystemCoins}
                color={isBalanced ? 'success' : 'danger'}
                highlight
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
              <BalanceCard
                icon={<ArrowDownCircle className="h-4 w-4" />}
                label="Vrai argent entré (K-Pay deposits)"
                value={realMoneyIn}
                color="success"
              />
              <BalanceCard
                icon={<ArrowUpCircle className="h-4 w-4" />}
                label="Vrai argent sorti (K-Pay withdrawals)"
                value={realMoneyOut}
                color="warning"
              />
              <BalanceCard
                icon={<Scale className="h-4 w-4" />}
                label="Coins attendus (in - out)"
                value={expectedCoins}
                color="info"
                highlight
              />
            </div>

            {!isBalanced && (
              <div className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-4">
                <p className="text-sm font-semibold text-danger">
                  Discrépance : {discrepancy > 0 ? '+' : ''}{discrepancy.toLocaleString()} coins
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {discrepancy > 0
                    ? 'Le système contient plus de coins qu\'il ne devrait. Possibles causes : bug de création d\'argent, dépôts admin manuels (sans vrai argent).'
                    : 'Le système contient moins de coins qu\'il ne devrait. Possibles causes : retrait admin manuel sans transfert réel, perte de données.'}
                </p>
              </div>
            )}
          </div>

          {/* RECHERCHE PAR UTILISATEUR */}
          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            <div className="flex items-center gap-2 mb-4">
              <Search className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-text">Traçabilité par utilisateur</h2>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Rechercher par username ou ID..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedUser(null); }}
                className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none"
              />
              {filteredUsers.length > 0 && !selectedUser && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-border/30 bg-surface-light shadow-xl max-h-64 overflow-y-auto">
                  {filteredUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => { setSelectedUser(u); setSearch(u.username ?? u.id); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-lighter border-b border-border/10"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text">{u.username ?? '(sans nom)'}</span>
                        <span className="text-xs text-text-muted">{u.coins.toLocaleString()} coins</span>
                      </div>
                      <p className="text-[10px] text-text-muted font-mono truncate">{u.id}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUser && userStats && (
              <div className="mt-6 space-y-4">
                <div className="flex items-center gap-3 rounded-xl bg-surface p-4">
                  <div className="rounded-full bg-primary/15 h-10 w-10 flex items-center justify-center text-primary font-bold">
                    {(selectedUser.username ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-text">{selectedUser.username ?? '(sans nom)'}</p>
                    <p className="text-xs text-text-muted font-mono">{selectedUser.id}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-text-muted">Solde actuel</p>
                    <p className="text-2xl font-black text-primary">{selectedUser.coins.toLocaleString()}</p>
                  </div>
                </div>

                {/* Stats user */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <BalanceCard label="Mises perdues" value={userStats.betsLost} color="danger" icon={<ArrowUpCircle className="h-4 w-4" />} />
                  <BalanceCard label="Gains reçus" value={userStats.wins} color="success" icon={<ArrowDownCircle className="h-4 w-4" />} />
                  <BalanceCard label="Refunds" value={userStats.refunds} color="info" icon={<RefreshCw className="h-4 w-4" />} />
                  <BalanceCard label="Dépôts MM" value={userStats.deposits} color="success" icon={<Smartphone className="h-4 w-4" />} />
                  <BalanceCard label="Retraits MM" value={userStats.withdrawals} color="warning" icon={<Smartphone className="h-4 w-4" />} />
                </div>

                {/* Liste mouvements user */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-text">
                    Historique ({userMovements.length} mouvements jeux + {userFreemoTxs.length} Mobile Money)
                  </h3>
                  <div className="rounded-xl border border-border/20 overflow-hidden max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-surface sticky top-0">
                        <tr className="text-left text-xs uppercase text-text-muted">
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2 text-right">Montant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...userMovements.map(m => ({
                            id: m.id, date: m.created_at, source: m.game_type,
                            type: movementLabels[m.movement_type] ?? m.movement_type,
                            amount: m.movement_type === 'payout' || m.movement_type === 'refund'
                              ? m.amount : -m.amount,
                          })),
                          ...userFreemoTxs.map(t => ({
                            id: t.id, date: t.created_at, source: 'Mobile Money',
                            type: t.transaction_type === 'DEPOSIT' ? 'Dépôt MM' : 'Retrait MM',
                            amount: t.status !== 'SUCCESS' ? 0 :
                                    t.transaction_type === 'DEPOSIT' ? t.amount : -t.amount,
                          })),
                        ]
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .slice(0, 100)
                          .map(row => (
                            <tr key={row.id} className="border-b border-border/10 hover:bg-surface-lighter">
                              <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">
                                {format(new Date(row.date), 'dd MMM HH:mm', { locale: fr })}
                              </td>
                              <td className="px-3 py-2 text-xs text-text">{row.source}</td>
                              <td className="px-3 py-2 text-xs text-text">{row.type}</td>
                              <td className={`px-3 py-2 text-right font-bold ${
                                row.amount > 0 ? 'text-success' : row.amount < 0 ? 'text-danger' : 'text-text-muted'
                              }`}>
                                {row.amount > 0 ? '+' : ''}{row.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ACTIONS ADMIN — caisse <-> wallet */}
          <div>
            <h2 className="mb-3 text-lg font-bold text-text">
              Actions super admin ({adminActions.length})
            </h2>
            {adminActions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-8 text-center text-sm text-text-muted">
                Aucune action admin enregistrée pour l'instant
              </div>
            ) : (
              <div className="rounded-2xl border border-border/20 bg-surface-light overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface">
                    <tr className="text-left text-xs uppercase text-text-muted">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminActions.slice(0, 50).map(m => {
                      const meta = m.metadata ?? {};
                      const action = (meta as { action?: string }).action ?? m.movement_type;
                      const desc = (meta as { description?: string }).description ?? '—';
                      return (
                        <tr key={m.id} className="border-b border-border/10 hover:bg-surface-lighter">
                          <td className="px-4 py-3 text-xs text-text-muted whitespace-nowrap">
                            {format(new Date(m.created_at), 'dd MMM HH:mm', { locale: fr })}
                          </td>
                          <td className="px-4 py-3 text-text">{action}</td>
                          <td className="px-4 py-3 text-xs text-text-muted">
                            {m.user_id ? (userMap.get(m.user_id) ?? m.user_id.slice(0, 8)) : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-text-muted">{desc}</td>
                          <td className={`px-4 py-3 text-right font-bold ${m.amount > 0 ? 'text-success' : 'text-danger'}`}>
                            {m.amount > 0 ? '+' : ''}{m.amount.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BalanceCard({ icon, label, value, color, highlight }: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  color: 'success' | 'info' | 'warning' | 'danger';
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${
      highlight ? `bg-${color}/10 border-${color}/30` : 'bg-surface/50 border-border/20'
    }`}>
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        {icon && <span className={`text-${color}`}>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 font-bold text-${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}
