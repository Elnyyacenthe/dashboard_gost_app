// ============================================================
// Slots.tsx — Stats Big Win 777
// ============================================================
// Lit directement la table public.slot_spins (audit chaque spin).
// Affiche : volume, RTP reel, jackpots, top joueurs, dernieres parties.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Coins, Sparkles, Users, TrendingDown, Cherry, Award } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface SpinRow {
  id: string;
  user_id: string;
  bet_amount: number;
  reels: string[];
  multiplier: number;
  payout: number;
  is_jackpot: boolean;
  created_at: string;
}

interface UserMini {
  id: string;
  username: string | null;
}

const SYMBOL_EMOJI: Record<string, string> = {
  cherry: '🍒',
  lemon: '🍋',
  orange: '🍊',
  grape: '🍇',
  bell: '🔔',
  bar: 'BAR',
  seven: '7️⃣',
  blank: '·',
};

export default function SlotsPage() {
  const [spins, setSpins] = useState<SpinRow[]>([]);
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let from = '1970-01-01T00:00:00Z';
      const now = Date.now();
      if (range === '24h') from = new Date(now - 24 * 3600_000).toISOString();
      else if (range === '7d') from = new Date(now - 7 * 24 * 3600_000).toISOString();
      else if (range === '30d') from = new Date(now - 30 * 24 * 3600_000).toISOString();

      const { data: spinRows, error } = await supabase
        .from('slot_spins')
        .select('*')
        .gte('created_at', from)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) throw error;

      const rows = (spinRows ?? []) as SpinRow[];
      setSpins(rows);

      // Resoudre les noms d'utilisateur (top joueurs uniquement, pour limiter)
      const ids = Array.from(new Set(rows.map(r => r.user_id))).slice(0, 50);
      if (ids.length > 0) {
        const { data: usrs } = await supabase
          .from('user_profiles')
          .select('id, username')
          .in('id', ids);
        const m = new Map<string, string>();
        for (const u of (usrs ?? []) as UserMini[]) {
          m.set(u.id, u.username ?? u.id.slice(0, 6));
        }
        setUsers(m);
      }
    } catch (e) {
      console.error('Slots fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Agregats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalSpins = spins.length;
    const wagered = spins.reduce((s, r) => s + r.bet_amount, 0);
    const paid = spins.reduce((s, r) => s + r.payout, 0);
    const wins = spins.filter(r => r.payout > 0).length;
    const jackpots = spins.filter(r => r.is_jackpot).length;
    const uniquePlayers = new Set(spins.map(r => r.user_id)).size;
    const houseProfit = wagered - paid;
    const rtp = wagered > 0 ? (paid / wagered) * 100 : 0;
    const winRate = totalSpins > 0 ? (wins / totalSpins) * 100 : 0;

    // Top 10 joueurs par volume wagere
    const perUser = new Map<string, { spins: number; wagered: number; payout: number }>();
    for (const r of spins) {
      const e = perUser.get(r.user_id) ?? { spins: 0, wagered: 0, payout: 0 };
      e.spins += 1;
      e.wagered += r.bet_amount;
      e.payout += r.payout;
      perUser.set(r.user_id, e);
    }
    const topPlayers = Array.from(perUser.entries())
      .map(([uid, v]) => ({ uid, ...v, net: v.payout - v.wagered }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10);

    return { totalSpins, wagered, paid, wins, jackpots, uniquePlayers, houseProfit, rtp, winRate, topPlayers };
  }, [spins]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">🎰 Big Win 777</h1>
          <p className="text-sm text-text-muted">
            Machine à sous 3 rouleaux · Mise libre 10-1000 FCFA · Source <code className="text-xs">slot_spins</code>
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

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Spins joués"
          value={stats.totalSpins.toLocaleString()}
          icon={<Cherry className="h-5 w-5" />}
          variant="violet"
          change={`${stats.uniquePlayers} joueurs uniques`}
        />
        <StatsCard
          title="Misé"
          value={`${stats.wagered.toLocaleString()} FCFA`}
          icon={<Coins className="h-5 w-5" />}
          variant="amber"
          change={`Moy. ${stats.totalSpins > 0 ? Math.round(stats.wagered / stats.totalSpins) : 0} FCFA / spin`}
        />
        <StatsCard
          title="Payé aux joueurs"
          value={`${stats.paid.toLocaleString()} FCFA`}
          icon={<Award className="h-5 w-5" />}
          variant="cyan"
          change={`${stats.wins} gains (${stats.winRate.toFixed(1)}%)`}
          changeType={stats.winRate > 35 ? 'up' : 'neutral'}
        />
        <StatsCard
          title="Entrée caisse (perte joueurs)"
          value={`${stats.houseProfit.toLocaleString()} FCFA`}
          icon={<TrendingDown className="h-5 w-5" />}
          variant={stats.houseProfit >= 0 ? 'green' : 'rose'}
          change={`= Misé − Payé · RTP réel ${stats.rtp.toFixed(1)}% (cible ~78%)`}
          changeType={stats.rtp > 95 ? 'down' : stats.rtp < 60 ? 'up' : 'neutral'}
          accent
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
              Chaque spin perdu envoie la mise dans <code className="text-[10px]">game_treasury</code> (caisse principale).
              Chaque gain en sort. Le delta ci-dessous est l'argent net que la maison conserve.
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

      {/* Sub KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Jackpots 7-7-7"
          value={stats.jackpots}
          icon={<Sparkles className="h-5 w-5" />}
          variant="rose"
          change={
            stats.totalSpins > 0
              ? `1 sur ${Math.round(stats.totalSpins / Math.max(1, stats.jackpots))} spins`
              : 'aucun spin'
          }
        />
        <StatsCard
          title="Taux de gain"
          value={`${stats.winRate.toFixed(1)}%`}
          icon={<Users className="h-5 w-5" />}
          variant="blue"
          change={`${stats.wins} gains sur ${stats.totalSpins} spins`}
        />
        <StatsCard
          title="Mise moyenne"
          value={`${stats.totalSpins > 0 ? Math.round(stats.wagered / stats.totalSpins) : 0} FCFA`}
          icon={<Coins className="h-5 w-5" />}
          variant="amber"
        />
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
                        <span className="font-semibold text-text">{users.get(p.uid) ?? p.uid.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right">{p.spins}</td>
                    <td className="py-2 text-right text-amber-600">{p.wagered.toLocaleString()}</td>
                    <td className="py-2 text-right text-cyan-600">{p.payout.toLocaleString()}</td>
                    <td className={`py-2 text-right font-bold ${p.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {p.net >= 0 ? '+' : ''}
                      {p.net.toLocaleString()}
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
                  <th className="py-2 text-center">Rouleaux</th>
                  <th className="py-2 text-right">Mise</th>
                  <th className="py-2 text-right">×</th>
                  <th className="py-2 text-right">Gain</th>
                </tr>
              </thead>
              <tbody>
                {spins.slice(0, 50).map(s => (
                  <tr
                    key={s.id}
                    className={`border-b border-border/10 last:border-0 ${
                      s.is_jackpot ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="py-2 text-xs text-text-muted">
                      {new Date(s.created_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 text-xs">
                      {users.get(s.user_id) ?? s.user_id.slice(0, 8)}
                    </td>
                    <td className="py-2 text-center font-mono">
                      {s.reels.map(r => SYMBOL_EMOJI[r] ?? r).join(' ')}
                    </td>
                    <td className="py-2 text-right">{s.bet_amount}</td>
                    <td className={`py-2 text-right font-bold ${s.multiplier > 0 ? 'text-emerald-600' : 'text-text-muted'}`}>
                      ×{s.multiplier}
                    </td>
                    <td className={`py-2 text-right font-bold ${s.is_jackpot ? 'text-amber-600' : s.payout > 0 ? 'text-emerald-600' : 'text-text-muted'}`}>
                      {s.payout > 0 ? `+${s.payout}` : '—'}
                      {s.is_jackpot && <span className="ml-1 text-[10px]">JACKPOT</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
