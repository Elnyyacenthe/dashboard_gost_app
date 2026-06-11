// ============================================================
// Bets.tsx — Paris sportifs (tickets)
// ============================================================
// Source : tables public.bets + public.bet_selections (RPC place_bet).
// Affiche : volume, taux de settlement, gains/pertes, tickets en cours.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Ticket, TrendingUp, TrendingDown, Clock, Award } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import TicketLookup from '../components/TicketLookup';
import { supabase } from '../lib/supabaseClient';

interface BetRow {
  id: string;
  user_id: string;
  bet_type: 'simple' | 'combine';
  stake: number;
  total_odds: number;
  potential_payout: number;
  status: 'pending' | 'won' | 'lost' | 'void' | 'cashed_out';
  actual_payout: number | null;
  is_virtual: boolean;
  created_at: string;
  settled_at: string | null;
}

interface UserMini { id: string; username: string | null; }

export default function BetsPage() {
  const [bets, setBets] = useState<BetRow[]>([]);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [statusFilter, setStatusFilter] = useState<'all' | BetRow['status']>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'real' | 'virtual'>('all');
  const [missing, setMissing] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      let from = '1970-01-01T00:00:00Z';
      const now = Date.now();
      if (range === '24h') from = new Date(now - 24 * 3600_000).toISOString();
      else if (range === '7d') from = new Date(now - 7 * 24 * 3600_000).toISOString();
      else if (range === '30d') from = new Date(now - 30 * 24 * 3600_000).toISOString();

      const { data, error } = await supabase
        .from('bets')
        .select('*')
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) {
        if (error.message.includes('does not exist') || error.code === 'PGRST205') {
          setMissing(true);
        } else {
          console.error(error);
        }
        return;
      }
      const rows = (data ?? []) as BetRow[];
      setBets(rows);

      const ids = Array.from(new Set(rows.map(r => r.user_id))).slice(0, 100);
      if (ids.length > 0) {
        const { data: usrs } = await supabase.from('user_profiles').select('id, username').in('id', ids);
        const m = new Map<string, string>();
        for (const u of (usrs ?? []) as UserMini[]) m.set(u.id, u.username ?? u.id.slice(0, 6));
        setUsers(m);
      }
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetch(); }, [fetch]);

  // ── Helper d'agregation reuse pour tout et par segment V/R ─
  const aggregateBets = (rows: BetRow[]) => {
    const total = rows.length;
    const wagered = rows.reduce((s, b) => s + b.stake, 0);
    const pending = rows.filter(b => b.status === 'pending').length;
    const won = rows.filter(b => b.status === 'won').length;
    const lost = rows.filter(b => b.status === 'lost').length;
    const voided = rows.filter(b => b.status === 'void').length;
    const wonPaid = rows.filter(b => b.status === 'won').reduce((s, b) => s + (b.actual_payout ?? 0), 0);
    const pendingStakeAtRisk = rows.filter(b => b.status === 'pending').reduce((s, b) => s + b.stake, 0);
    const lostStakeKept = rows.filter(b => b.status === 'lost').reduce((s, b) => s + b.stake, 0);
    const houseProfit = lostStakeKept - wonPaid;
    const uniqueBettors = new Set(rows.map(b => b.user_id)).size;
    const combineCount = rows.filter(b => b.bet_type === 'combine').length;
    const simpleCount = rows.filter(b => b.bet_type === 'simple').length;
    const settled = won + lost + voided;
    const winRate = settled > 0 ? (won / settled) * 100 : 0;
    return {
      total, wagered, pending, won, lost, voided, wonPaid,
      pendingStakeAtRisk, lostStakeKept, houseProfit, uniqueBettors,
      combineCount, simpleCount, settled, winRate,
    };
  };

  // ── Agregats ─────────────────────────────────────────────
  const stats = useMemo(() => aggregateBets(bets), [bets]);
  // Splits virtuel vs reel — pour les bandeaux comparatifs
  const realStats = useMemo(
    () => aggregateBets(bets.filter(b => !b.is_virtual)),
    [bets],
  );
  const virtualStats = useMemo(
    () => aggregateBets(bets.filter(b => b.is_virtual)),
    [bets],
  );

  const filtered = useMemo(() => {
    let out = bets;
    if (statusFilter !== 'all') out = out.filter(b => b.status === statusFilter);
    if (typeFilter === 'real') out = out.filter(b => !b.is_virtual);
    else if (typeFilter === 'virtual') out = out.filter(b => b.is_virtual);
    return out;
  }, [bets, statusFilter, typeFilter]);

  const statusPill = (s: BetRow['status']) => {
    const map: Record<BetRow['status'], { bg: string; text: string; label: string }> = {
      pending:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'EN COURS' },
      won:         { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'GAGNÉ' },
      lost:        { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'PERDU' },
      void:        { bg: 'bg-slate-100',   text: 'text-slate-700',   label: 'ANNULÉ' },
      cashed_out:  { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'CASHED OUT' },
    };
    const v = map[s];
    return <span className={`rounded px-2 py-0.5 text-[10px] font-black ${v.bg} ${v.text}`}>{v.label}</span>;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">🎯 Paris sportifs</h1>
          <p className="text-sm text-text-muted">
            Tickets de paris · Source <code className="text-xs">bets</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['24h', '7d', '30d', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                range === r ? 'bg-primary text-white' : 'bg-surface-lighter text-text-muted hover:bg-surface'
              }`}
            >
              {r === 'all' ? 'Tout' : r}
            </button>
          ))}
          <button onClick={fetch} className="flex items-center gap-2 rounded-xl border border-border/30 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-lighter">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Lookup ticket par code (support client) */}
      <TicketLookup />

      {missing ? (
        <div className="exec-card border-l-4 border-amber-500 p-5">
          <p className="font-bold text-amber-700">Tables paris non déployées</p>
          <p className="text-sm text-text-muted mt-1">
            Les tables <code>bets</code> et <code>bet_selections</code> n'existent pas. Exécute :
          </p>
          <pre className="mt-2 rounded bg-surface-lighter p-2 text-xs">supabase/migrations/zz_20260602_paris_place_bet.sql</pre>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Tickets"
              value={stats.total}
              icon={<Ticket className="h-5 w-5" />}
              variant="blue"
              change={`${stats.uniqueBettors} parieurs uniques`}
            />
            <StatsCard
              title="Misé total"
              value={`${stats.wagered.toLocaleString()} FCFA`}
              icon={<TrendingUp className="h-5 w-5" />}
              variant="amber"
              change={`${stats.simpleCount} simples · ${stats.combineCount} combinés`}
            />
            <StatsCard
              title="Payé aux gagnants"
              value={`${stats.wonPaid.toLocaleString()} FCFA`}
              icon={<Award className="h-5 w-5" />}
              variant="cyan"
              change={`${stats.won} tickets · ${stats.winRate.toFixed(1)}% de réussite`}
            />
            <StatsCard
              title="Entrée caisse (mises perdues)"
              value={`${stats.houseProfit.toLocaleString()} FCFA`}
              icon={<TrendingDown className="h-5 w-5" />}
              variant={stats.houseProfit >= 0 ? 'green' : 'rose'}
              change={`= ${stats.lostStakeKept.toLocaleString()} perdues − ${stats.wonPaid.toLocaleString()} payées`}
              accent
            />
          </div>

          {/* Sub KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatsCard
              title="En attente settlement"
              value={stats.pending}
              icon={<Clock className="h-5 w-5" />}
              variant="amber"
              change={`${stats.pendingStakeAtRisk.toLocaleString()} FCFA bloqués`}
            />
            <StatsCard
              title="Réglés"
              value={stats.settled}
              icon={<Award className="h-5 w-5" />}
              variant="green"
              change={`${stats.won} gagnés · ${stats.lost} perdus · ${stats.voided} annulés`}
            />
            <StatsCard
              title="Taux de réussite"
              value={`${stats.winRate.toFixed(1)}%`}
              icon={<TrendingUp className="h-5 w-5" />}
              variant="violet"
              change="sur tickets réglés"
            />
          </div>

          {/* Bandeau cashflow */}
          <div className="exec-card border-l-4 border-emerald-500 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Flux d'argent paris sportifs
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  Chaque ticket perdu envoie la mise en caisse. Chaque gagnant en sort. Le delta = argent net conservé.
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-text-muted">Net période</p>
                <p className={`text-2xl font-black ${stats.houseProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {stats.houseProfit >= 0 ? '+' : ''}{stats.houseProfit.toLocaleString()} FCFA
                </p>
              </div>
            </div>
          </div>

          {/* Split Reels vs Virtuels */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Paris reels */}
            <div className="exec-card p-5 border-l-4 border-blue-500">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700">
                    🏟️ Paris RÉELS
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Matchs reels (StatPal / Sports)
                  </p>
                </div>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {realStats.total} tickets
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <p className="text-[10px] text-text-muted">Misé</p>
                  <p className="text-lg font-black text-amber-600">{realStats.wagered.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Payé</p>
                  <p className="text-lg font-black text-cyan-600">{realStats.wonPaid.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Net caisse</p>
                  <p className={`text-lg font-black ${realStats.houseProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {realStats.houseProfit >= 0 ? '+' : ''}{realStats.houseProfit.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <span className="text-text-muted">
                  {realStats.pending} en attente
                </span>
                <span className="text-text-muted">·</span>
                <span className="text-emerald-700">{realStats.won} gagnés</span>
                <span className="text-text-muted">·</span>
                <span className="text-rose-700">{realStats.lost} perdus</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">
                  {realStats.uniqueBettors} joueurs
                </span>
              </div>
            </div>

            {/* Paris virtuels */}
            <div className="exec-card p-5 border-l-4 border-violet-500">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-violet-700">
                    🤖 Paris VIRTUELS
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Matchs simulés (Virtual Matches)
                  </p>
                </div>
                <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
                  {virtualStats.total} tickets
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <p className="text-[10px] text-text-muted">Misé</p>
                  <p className="text-lg font-black text-amber-600">{virtualStats.wagered.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Payé</p>
                  <p className="text-lg font-black text-cyan-600">{virtualStats.wonPaid.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-muted">Net caisse</p>
                  <p className={`text-lg font-black ${virtualStats.houseProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {virtualStats.houseProfit >= 0 ? '+' : ''}{virtualStats.houseProfit.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                <span className="text-text-muted">
                  {virtualStats.pending} en attente
                </span>
                <span className="text-text-muted">·</span>
                <span className="text-emerald-700">{virtualStats.won} gagnés</span>
                <span className="text-text-muted">·</span>
                <span className="text-rose-700">{virtualStats.lost} perdus</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">
                  {virtualStats.uniqueBettors} joueurs
                </span>
              </div>
            </div>
          </div>

          {/* Liste tickets */}
          <div className="exec-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-text">Tickets récents</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filtre Reel / Virtuel */}
                <div className="flex items-center gap-1">
                  {([
                    { v: 'all',     l: 'Tous',     cls: 'text-text-muted'  },
                    { v: 'real',    l: '🏟️ Réels',   cls: 'text-blue-700'    },
                    { v: 'virtual', l: '🤖 Virtuels', cls: 'text-violet-700' },
                  ] as const).map(t => (
                    <button
                      key={t.v}
                      onClick={() => setTypeFilter(t.v)}
                      className={`rounded px-2 py-1 text-[10px] font-bold ${
                        typeFilter === t.v
                          ? 'bg-primary text-white'
                          : `bg-surface-lighter ${t.cls} hover:bg-surface`
                      }`}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
                <span className="text-text-muted">|</span>
                {/* Filtre statut */}
                <div className="flex items-center gap-1">
                  {(['all', 'pending', 'won', 'lost', 'void'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${
                        statusFilter === s ? 'bg-primary text-white' : 'bg-surface-lighter text-text-muted hover:bg-surface'
                      }`}
                    >
                      {s === 'all' ? 'Tous' : s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-text-muted">Aucun ticket sur la période/filtre.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30 text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="py-2 text-left">Quand</th>
                      <th className="py-2 text-left">Joueur</th>
                      <th className="py-2 text-left">Type</th>
                      <th className="py-2 text-right">Mise</th>
                      <th className="py-2 text-right">Cote</th>
                      <th className="py-2 text-right">Gain pot.</th>
                      <th className="py-2 text-right">Gain réel</th>
                      <th className="py-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 100).map(b => (
                      <tr key={b.id} className="border-b border-border/10 last:border-0">
                        <td className="py-2 text-xs text-text-muted">
                          {new Date(b.created_at).toLocaleString('fr-FR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2 text-xs">{users.get(b.user_id) ?? b.user_id.slice(0, 8)}</td>
                        <td className="py-2 text-xs">
                          {b.bet_type === 'combine' ? 'Combiné' : 'Simple'}
                          {b.is_virtual && <span className="ml-1 rounded bg-violet-100 px-1 text-[9px] text-violet-700">V</span>}
                        </td>
                        <td className="py-2 text-right">{b.stake}</td>
                        <td className="py-2 text-right text-amber-600">×{b.total_odds.toFixed(2)}</td>
                        <td className="py-2 text-right">{b.potential_payout.toLocaleString()}</td>
                        <td className={`py-2 text-right font-bold ${
                          b.status === 'won' ? 'text-emerald-600' :
                          b.status === 'lost' ? 'text-rose-600' :
                          'text-text-muted'
                        }`}>
                          {b.actual_payout != null ? b.actual_payout.toLocaleString() : '—'}
                        </td>
                        <td className="py-2">{statusPill(b.status)}</td>
                      </tr>
                    ))}
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
