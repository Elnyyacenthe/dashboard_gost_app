// ============================================================
// Wheel.tsx — Stats Plugbet Wheel
// ============================================================
// Lit directement la table public.wheel_spins (audit chaque spin)
// + public.wheel_free_spins (tours gratuits 2x/7x).
// Affiche : volume, RTP reel, free spins triggered, cascades,
// top joueurs, dernieres parties.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Coins, Sparkles, Users, TrendingDown, Award, Gift } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface SpinRow {
  id: string;
  user_id: string;
  bets: Record<string, number>;
  total_bet: number;
  segment: number;
  winning_tile: number;
  winnings: number;
  multiplier: number;
  is_free_spin: boolean;
  created_at: string;
}

interface FreeSpinRow {
  id: string;
  user_id: string;
  multiplier: number;
  cascade_depth: number;
  used: boolean;
  expires_at: string;
  created_at: string;
}

interface UserMini { id: string; username: string | null; }

function segmentLabel(seg: number, tile: number, isFs: boolean): string {
  if (seg === 48) return '2×';
  if (seg === 49) return '7×';
  if (tile === 0) return '?';
  return `${tile}${isFs ? '★' : ''}`;
}

export default function WheelPage() {
  const [spins, setSpins] = useState<SpinRow[]>([]);
  const [freeSpins, setFreeSpins] = useState<FreeSpinRow[]>([]);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [missing, setMissing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      let from = '1970-01-01T00:00:00Z';
      const now = Date.now();
      if (range === '24h') from = new Date(now - 24 * 3600_000).toISOString();
      else if (range === '7d') from = new Date(now - 7 * 24 * 3600_000).toISOString();
      else if (range === '30d') from = new Date(now - 30 * 24 * 3600_000).toISOString();

      const [spinRes, fsRes] = await Promise.all([
        supabase.from('wheel_spins').select('*')
          .gte('created_at', from)
          .order('created_at', { ascending: false }).limit(5000),
        supabase.from('wheel_free_spins').select('*')
          .gte('created_at', from)
          .order('created_at', { ascending: false }).limit(2000),
      ]);

      if (spinRes.error) {
        const msg = spinRes.error.message.toLowerCase();
        if (msg.includes('does not exist') || spinRes.error.code === 'PGRST205') {
          setMissing(true);
          return;
        }
        console.error('wheel_spins error', spinRes.error);
        return;
      }

      const rows = (spinRes.data ?? []) as SpinRow[];
      setSpins(rows);
      // wheel_free_spins peut ne pas exister si Phase 2 pas executee
      if (!fsRes.error) {
        setFreeSpins((fsRes.data ?? []) as FreeSpinRow[]);
      }

      const ids = Array.from(new Set(rows.map(r => r.user_id))).slice(0, 50);
      if (ids.length > 0) {
        const { data: usrs } = await supabase
          .from('user_profiles').select('id, username').in('id', ids);
        const m = new Map<string, string>();
        for (const u of (usrs ?? []) as UserMini[]) {
          m.set(u.id, u.username ?? u.id.slice(0, 6));
        }
        setUsers(m);
      }
    } catch (e) {
      console.error('Wheel fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Agregats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalSpins = spins.length;
    const realSpins = spins.filter(s => !s.is_free_spin).length;
    const freeSpinsExecuted = spins.filter(s => s.is_free_spin).length;
    const wagered = spins
      .filter(s => !s.is_free_spin)        // free spins ne debitent pas
      .reduce((sum, r) => sum + r.total_bet, 0);
    const paid = spins.reduce((sum, r) => sum + r.winnings, 0);
    const wins = spins.filter(r => r.winnings > 0).length;
    const fsTriggered = spins.filter(r => r.segment === 48 || r.segment === 49).length;
    const cascadeDeep = freeSpins.filter(f => f.cascade_depth >= 2).length;
    const uniquePlayers = new Set(spins.map(r => r.user_id)).size;
    const houseProfit = wagered - paid;
    const rtp = wagered > 0 ? (paid / wagered) * 100 : 0;
    const winRate = totalSpins > 0 ? (wins / totalSpins) * 100 : 0;
    const fsRate = realSpins > 0 ? (fsTriggered / realSpins) * 100 : 0;

    // Top 10 joueurs par volume wagere
    const perUser = new Map<string, { spins: number; wagered: number; payout: number; fs: number }>();
    for (const r of spins) {
      const e = perUser.get(r.user_id) ?? { spins: 0, wagered: 0, payout: 0, fs: 0 };
      e.spins += 1;
      if (!r.is_free_spin) e.wagered += r.total_bet;
      e.payout += r.winnings;
      if (r.is_free_spin) e.fs += 1;
      perUser.set(r.user_id, e);
    }
    const topPlayers = Array.from(perUser.entries())
      .map(([uid, v]) => ({ uid, ...v, net: v.payout - v.wagered }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10);

    return {
      totalSpins, realSpins, freeSpinsExecuted, wagered, paid, wins, fsTriggered,
      cascadeDeep, uniquePlayers, houseProfit, rtp, winRate, fsRate, topPlayers,
    };
  }, [spins, freeSpins]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">🎡 Plugbet Wheel</h1>
          <p className="text-sm text-text-muted">
            Roue 50 segments · Multi-mise libre 25-5000 · Source <code className="text-xs">wheel_spins</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['24h', '7d', '30d', 'all'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === r
                  ? 'bg-primary text-white'
                  : 'bg-surface-lighter text-text-muted hover:bg-surface'
              }`}
            >
              {r === 'all' ? 'Tout' : r}
            </button>
          ))}
          <button
            onClick={fetchData}
            className="flex items-center gap-2 rounded-xl border border-border/30 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-lighter hover:text-text"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Rafraîchir
          </button>
        </div>
      </div>

      {missing ? (
        <div className="exec-card border-l-4 border-amber-500 p-5">
          <p className="font-bold text-amber-700">Tables wheel non déployées</p>
          <p className="text-sm text-text-muted mt-1">Exécute dans Supabase SQL Editor :</p>
          <pre className="mt-2 rounded bg-surface-lighter p-2 text-xs">supabase/migrations/zz_20260604_wheel.sql{'\n'}supabase/migrations/zz_20260604_wheel_phase2.sql</pre>
        </div>
      ) : (
        <>
          {/* KPIs principaux */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Spins joués"
              value={stats.totalSpins.toLocaleString()}
              icon={<Sparkles className="h-5 w-5" />}
              variant="violet"
              change={`${stats.realSpins} payants + ${stats.freeSpinsExecuted} gratuits`}
            />
            <StatsCard
              title="Misé"
              value={`${stats.wagered.toLocaleString()} FCFA`}
              icon={<Coins className="h-5 w-5" />}
              variant="amber"
              change={`${stats.uniquePlayers} joueurs uniques`}
            />
            <StatsCard
              title="Payé aux joueurs"
              value={`${stats.paid.toLocaleString()} FCFA`}
              icon={<Award className="h-5 w-5" />}
              variant="cyan"
              change={`${stats.wins} gains (${stats.winRate.toFixed(1)}%)`}
            />
            <StatsCard
              title="Entrée caisse (perte joueurs)"
              value={`${stats.houseProfit.toLocaleString()} FCFA`}
              icon={<TrendingDown className="h-5 w-5" />}
              variant={stats.houseProfit >= 0 ? 'green' : 'rose'}
              change={`= Misé − Payé · RTP réel ${stats.rtp.toFixed(1)}% (cible ~82%)`}
              changeType={stats.rtp > 95 ? 'down' : stats.rtp < 60 ? 'up' : 'neutral'}
              accent
            />
          </div>

          {/* KPIs Phase 2 (free spins) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatsCard
              title="2× / 7× déclenchés"
              value={stats.fsTriggered}
              icon={<Gift className="h-5 w-5" />}
              variant="rose"
              change={
                stats.realSpins > 0
                  ? `${stats.fsRate.toFixed(1)}% des spins (cible ~4%)`
                  : 'aucun spin'
              }
            />
            <StatsCard
              title="Free spins exécutés"
              value={stats.freeSpinsExecuted}
              icon={<Sparkles className="h-5 w-5" />}
              variant="amber"
              change={
                stats.cascadeDeep > 0
                  ? `${stats.cascadeDeep} cascades 2+ niveaux`
                  : 'pas de cascade'
              }
            />
            <StatsCard
              title="Joueurs uniques"
              value={stats.uniquePlayers}
              icon={<Users className="h-5 w-5" />}
              variant="blue"
              change={`Moy. ${stats.uniquePlayers > 0 ? Math.round(stats.totalSpins / stats.uniquePlayers) : 0} spins / joueur`}
            />
          </div>

          {/* Bandeau cashflow */}
          <div className="exec-card border-l-4 border-emerald-500 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Flux d'argent vers le système
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  Chaque spin perdu envoie la mise dans <code className="text-[10px]">game_treasury</code>.
                  Les free spins (2×/7×) ne débitent rien mais peuvent grandement faire payer la maison si la mise hits.
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

          {/* Top joueurs */}
          <div className="exec-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">Top 10 joueurs · {range}</h2>
              <p className="text-xs text-text-muted">Trié par volume misé</p>
            </div>
            {stats.topPlayers.length === 0 ? (
              <p className="text-sm text-text-muted">Aucun spin sur la période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30 text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="py-2 text-left">Joueur</th>
                      <th className="py-2 text-right">Spins</th>
                      <th className="py-2 text-right">FS</th>
                      <th className="py-2 text-right">Misé</th>
                      <th className="py-2 text-right">Reçu</th>
                      <th className="py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPlayers.map((p, i) => (
                      <tr key={p.uid} className="border-b border-border/10 last:border-0">
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-muted">#{i + 1}</span>
                            <span className="font-semibold text-text">
                              {users.get(p.uid) ?? p.uid.slice(0, 8)}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 text-right">{p.spins}</td>
                        <td className="py-2 text-right text-rose-600">{p.fs > 0 ? p.fs : '—'}</td>
                        <td className="py-2 text-right text-amber-600">{p.wagered.toLocaleString()}</td>
                        <td className="py-2 text-right text-cyan-600">{p.payout.toLocaleString()}</td>
                        <td className={`py-2 text-right font-bold ${p.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {p.net >= 0 ? '+' : ''}{p.net.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Dernieres parties */}
          <div className="exec-card p-5">
            <h2 className="mb-3 text-lg font-bold text-text">Dernières parties</h2>
            {spins.length === 0 ? (
              <p className="text-sm text-text-muted">Aucun spin sur la période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30 text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="py-2 text-left">Quand</th>
                      <th className="py-2 text-left">Joueur</th>
                      <th className="py-2 text-center">Seg</th>
                      <th className="py-2 text-right">Misé</th>
                      <th className="py-2 text-right">×</th>
                      <th className="py-2 text-right">Gain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spins.slice(0, 50).map(s => {
                      const isSpecial = s.segment === 48 || s.segment === 49;
                      const segLabel = segmentLabel(s.segment, s.winning_tile, s.is_free_spin);
                      return (
                        <tr
                          key={s.id}
                          className={`border-b border-border/10 last:border-0 ${
                            isSpecial ? 'bg-rose-50/30' :
                            s.is_free_spin ? 'bg-amber-50/30' : ''
                          }`}
                        >
                          <td className="py-2 text-xs text-text-muted">
                            {new Date(s.created_at).toLocaleString('fr-FR', {
                              day: '2-digit', month: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 text-xs">
                            {users.get(s.user_id) ?? s.user_id.slice(0, 8)}
                          </td>
                          <td className="py-2 text-center">
                            <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${
                              isSpecial ? 'bg-rose-100 text-rose-700' :
                              s.is_free_spin ? 'bg-amber-100 text-amber-700' :
                              'bg-surface-lighter text-text-primary'
                            }`}>
                              {segLabel}
                            </span>
                          </td>
                          <td className="py-2 text-right">{s.is_free_spin ? '—' : s.total_bet}</td>
                          <td className="py-2 text-right font-bold">
                            {s.multiplier > 1 ? `×${s.multiplier}` : '—'}
                          </td>
                          <td className={`py-2 text-right font-bold ${s.winnings > 0 ? 'text-emerald-600' : 'text-text-muted'}`}>
                            {s.winnings > 0 ? `+${s.winnings}` : '—'}
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
