import { useState, useEffect } from 'react';
import { Users, Coins, Trophy, Gamepad2, TrendingUp, Star, Activity } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';
import type { DashboardKPIs, UserProfile } from '../types';

const GAMES_META: Record<string, { label: string; emoji: string; color: string }> = {
  aviator:       { label: 'Aviator',       emoji: '✈️', color: '#ef4444' },
  apple_fortune: { label: 'Apple Fortune', emoji: '🍏', color: '#22c55e' },
  mines:         { label: 'Mines',         emoji: '💣', color: '#a855f7' },
  solitaire:     { label: 'Solitaire',     emoji: '🃏', color: '#f59e0b' },
  coinflip:      { label: 'Pile/Face',     emoji: '🪙', color: '#eab308' },
  cora_dice:     { label: 'Cora Dice',     emoji: '🎲', color: '#06b6d4' },
  checkers:      { label: 'Dames',         emoji: '♟️', color: '#64748b' },
  blackjack:     { label: 'Blackjack',     emoji: '🂡', color: '#dc2626' },
  roulette:      { label: 'Roulette',      emoji: '🎯', color: '#16a34a' },
  ludo_v2:       { label: 'Ludo',          emoji: '🎮', color: '#3b82f6' },
  fantasy:       { label: 'Fantasy',       emoji: '⚽', color: '#10b981' },
};

interface MovementRow {
  game_type: string;
  user_id: string | null;
  movement_type: string;
  amount: number;
  game_id: string | null;
  created_at: string;
}

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);

const chartBase = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#1e293b', borderColor: '#475569', borderWidth: 1,
      titleColor: '#f1f5f9', bodyColor: '#94a3b8', cornerRadius: 12, padding: 12,
    },
  },
  scales: {
    x: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
    y: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
  },
};

const RANK_ORDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'];
const RANK_COLORS: Record<string, string> = {
  Bronze: '#cd7f32', Silver: '#94a3b8', Gold: '#eab308',
  Platinum: '#22d3ee', Diamond: '#3b82f6', Legend: '#f97316',
};
// Classes Tailwind statiques pour éviter les inline styles
const RANK_TEXT: Record<string, string> = {
  Bronze: 'text-amber-700', Silver: 'text-slate-400', Gold: 'text-yellow-400',
  Platinum: 'text-cyan-400', Diamond: 'text-blue-500', Legend: 'text-orange-400',
};

interface GameRoundStat {
  game_type: string;
  label: string;
  color: string;
  rounds: number;
  bets_in: number;
}

export default function Overview() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [topPlayers, setTopPlayers] = useState<UserProfile[]>([]);
  const [rankDist, setRankDist] = useState<Record<string, number>>({});
  const [coinsBuckets, setCoinsBuckets] = useState<number[]>([0, 0, 0, 0]);
  const [gameStats, setGameStats] = useState<GameRoundStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [{ data: players }, { data: top }, { data: movements }] = await Promise.all([
          supabase.from('user_profiles').select('id, coins, xp, rank, total_wins, games_played, last_seen'),
          supabase.from('user_profiles').select('*').order('xp', { ascending: false }).limit(5),
          supabase.from('treasury_movements').select('*').limit(10000),
        ]);

        if (!players) return;

        const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const active7d  = players.filter(p => p.last_seen && p.last_seen >= lastWeek).length;
        const totalCoins = players.reduce((s, p) => s + (p.coins ?? 0), 0);
        const totalGames = players.reduce((s, p) => s + (p.games_played ?? 0), 0);
        const totalWins  = players.reduce((s, p) => s + (p.total_wins ?? 0), 0);

        const ranks: Record<string, number> = {};
        const buckets = [0, 0, 0, 0];

        players.forEach(p => {
          ranks[p.rank ?? 'Bronze'] = (ranks[p.rank ?? 'Bronze'] ?? 0) + 1;
          const c = p.coins ?? 0;
          if (c < 1000) buckets[0]++;
          else if (c < 5000) buckets[1]++;
          else if (c < 10000) buckets[2]++;
          else buckets[3]++;
        });

        const topRank = RANK_ORDER.slice().reverse().find(r => (ranks[r] ?? 0) > 0) ?? 'Bronze';

        setKpis({ total_players: players.length, active_players_7d: active7d, total_coins: totalCoins, top_rank: topRank, total_games_played: totalGames, total_wins: totalWins });
        setRankDist(ranks);
        setCoinsBuckets(buckets);
        setTopPlayers((top ?? []) as UserProfile[]);

        // Stats par jeu depuis treasury_movements
        const gameMap = new Map<string, { ids: Set<string>; bets: number }>();
        for (const m of (movements ?? []) as MovementRow[]) {
          if (!m.game_type || m.game_type === 'system') continue;
          if (!gameMap.has(m.game_type)) {
            gameMap.set(m.game_type, { ids: new Set(), bets: 0 });
          }
          const e = gameMap.get(m.game_type)!;
          if (m.game_id) e.ids.add(m.game_id);
          if (m.movement_type === 'loss_collect') e.bets += m.amount;
        }
        const gs: GameRoundStat[] = Array.from(gameMap.entries()).map(([gt, v]) => ({
          game_type: gt,
          label: GAMES_META[gt]?.label ?? gt,
          color: GAMES_META[gt]?.color ?? '#94a3b8',
          rounds: v.ids.size,
          bets_in: v.bets,
        })).sort((a, b) => b.rounds - a.rounds);
        setGameStats(gs);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const activeRanks = RANK_ORDER.filter(r => rankDist[r]);
  const rankChart = {
    labels: activeRanks,
    datasets: [{
      label: 'Joueurs',
      data: activeRanks.map(r => rankDist[r]),
      backgroundColor: activeRanks.map(r => (RANK_COLORS[r] ?? '#94a3b8') + '99'),
      borderColor: activeRanks.map(r => RANK_COLORS[r] ?? '#94a3b8'),
      borderWidth: 2, borderRadius: 8,
    }],
  };

  const coinsChart = {
    labels: ['< 1 000', '1k – 5k', '5k – 10k', '10k+'],
    datasets: [{
      label: 'Joueurs',
      data: coinsBuckets,
      borderColor: '#00E676',
      backgroundColor: 'rgba(0, 230, 118, 0.12)',
      borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 5,
      pointBackgroundColor: '#00E676',
      pointBorderColor: '#040810',
      pointBorderWidth: 2,
    }],
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
            Plugbet · Live data
          </p>
          <h1 className="hero-number text-3xl text-text">Overview</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Données réelles, en temps réel — joueurs, coins, parties, rangs.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5">
          <span className="live-dot h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">Live</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Total joueurs inscrits"
          value={(kpis?.total_players ?? 0).toLocaleString()}
          icon={<Users className="h-5 w-5" strokeWidth={2.2} />}
          variant="green" accent
        />
        <StatsCard
          title="Actifs (7 derniers jours)"
          value={(kpis?.active_players_7d ?? 0).toLocaleString()}
          icon={<TrendingUp className="h-5 w-5" strokeWidth={2.2} />}
          change={kpis ? `${Math.round((kpis.active_players_7d / Math.max(kpis.total_players, 1)) * 100)}% du total` : ''}
          changeType="up"
          variant="blue"
        />
        <StatsCard
          title="Coins en circulation"
          value={(kpis?.total_coins ?? 0).toLocaleString()}
          icon={<Coins className="h-5 w-5" strokeWidth={2.2} />}
          variant="warning"
        />
        <StatsCard
          title="Parties jouées (total)"
          value={(kpis?.total_games_played ?? 0).toLocaleString()}
          icon={<Gamepad2 className="h-5 w-5" strokeWidth={2.2} />}
          variant="purple"
        />
        <StatsCard
          title="Total victoires"
          value={(kpis?.total_wins ?? 0).toLocaleString()}
          icon={<Trophy className="h-5 w-5" strokeWidth={2.2} />}
          change={kpis?.total_games_played ? `${Math.round((kpis.total_wins / Math.max(kpis.total_games_played, 1)) * 100)}% win rate` : '—'}
          changeType="up"
          variant="orange"
        />
        <StatsCard
          title="Rang le plus élevé"
          value={kpis?.top_rank ?? 'N/A'}
          icon={<Star className="h-5 w-5" strokeWidth={2.2} />}
          variant="green" accent
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-plugbet p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Distribution des rangs</h3>
            <span className="rounded-md bg-info/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info">
              {activeRanks.length} rangs
            </span>
          </div>
          <div className="h-64">
            {activeRanks.length > 0 ? <Bar data={rankChart} options={chartBase} /> : (
              <div className="flex h-full items-center justify-center text-text-muted text-sm">Aucun joueur enregistré</div>
            )}
          </div>
        </div>

        <div className="card-plugbet p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-text-secondary">Répartition des soldes</h3>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              Coins
            </span>
          </div>
          <div className="h-64">
            <Line data={coinsChart} options={chartBase} />
          </div>
        </div>
      </div>

      {/* ACTIVITÉ PAR JEU */}
      {gameStats.length > 0 && (
        <div className="card-plugbet p-6">
          <div className="mb-5 flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-bold text-text">Activité par jeu</h3>
            <span className="ml-auto rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              {gameStats.length} actifs
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gameStats.map(g => {
              const meta = GAMES_META[g.game_type];
              return (
                <div key={g.game_type}
                  className="flex items-center gap-3 rounded-xl border border-border/40 bg-surface/50 p-3 transition-all hover:border-primary/30 hover:bg-surface-lighter">
                  <span className="text-2xl">{meta?.emoji ?? '🎮'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-text truncate">{g.label}</p>
                    <p className="text-[11px] text-text-secondary">
                      <span className="font-bold text-primary">{g.rounds}</span> parties ·{' '}
                      <span className="font-bold text-warning">{g.bets_in.toLocaleString()}</span> coins
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card-plugbet p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-text">Top 5 joueurs par XP</h3>
          <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
            Leaderboard
          </span>
        </div>
        {topPlayers.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">Aucun joueur enregistré pour l'instant.</p>
        ) : (
          <div className="space-y-1.5">
            {topPlayers.map((p, idx) => {
              const podium =
                idx === 0 ? { bg: 'bg-warning/15 text-warning border-warning/30', medal: '🥇' } :
                idx === 1 ? { bg: 'bg-info/15 text-info border-info/30', medal: '🥈' } :
                idx === 2 ? { bg: 'bg-orange/15 text-orange border-orange/30', medal: '🥉' } :
                { bg: 'bg-surface-lighter text-text-secondary border-border/40', medal: '' };
              return (
                <div key={p.id}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-transparent p-3 transition-all hover:border-primary/20 hover:bg-surface-lighter">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold ${podium.bg}`}>
                      {podium.medal || `#${idx + 1}`}
                    </span>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-extrabold text-primary">
                      {(p.username ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-text truncate">{p.username ?? 'Joueur'}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] font-bold ${RANK_TEXT[p.rank ?? 'Bronze'] ?? 'text-slate-400'}`}>
                          {p.rank ?? 'Bronze'}
                        </span>
                        <span className="text-[11px] text-text-secondary">
                          {p.games_played ?? 0} parties · {p.total_wins ?? 0} victoires
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="display-number text-base text-primary">{(p.xp ?? 0).toLocaleString()} XP</p>
                    <p className="text-[11px] text-text-secondary">{(p.coins ?? 0).toLocaleString()} coins</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
