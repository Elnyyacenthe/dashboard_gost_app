import { useState, useEffect, useMemo } from 'react';
import { Trophy, Target, TrendingUp, Coins, Gamepad2, BarChart3 } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';
import type { LeaderboardEntry } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

const RANK_ORDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'];
const RANK_COLORS: Record<string, string> = {
  Bronze: '#cd7f32', Silver: '#94a3b8', Gold: '#eab308',
  Platinum: '#22d3ee', Diamond: '#3b82f6', Legend: '#f97316',
};
const RANK_TEXT: Record<string, string> = {
  Bronze: 'text-amber-700', Silver: 'text-slate-400', Gold: 'text-yellow-400',
  Platinum: 'text-cyan-400', Diamond: 'text-blue-500', Legend: 'text-orange-400',
};

const GAMES_META: Record<string, { label: string; emoji: string; color: string }> = {
  aviator:       { label: 'Aviator',         emoji: '✈️', color: '#ef4444' },
  apple_fortune: { label: 'Apple Fortune',   emoji: '🍏', color: '#22c55e' },
  mines:         { label: 'Mines',           emoji: '💣', color: '#a855f7' },
  solitaire:     { label: 'Solitaire',       emoji: '🃏', color: '#f59e0b' },
  coinflip:      { label: 'Pile ou Face',    emoji: '🪙', color: '#eab308' },
  cora_dice:     { label: 'Cora Dice',       emoji: '🎲', color: '#06b6d4' },
  checkers:      { label: 'Dames',           emoji: '♟️', color: '#64748b' },
  blackjack:     { label: 'Blackjack',       emoji: '🂡', color: '#dc2626' },
  roulette:      { label: 'Roulette',        emoji: '🎯', color: '#16a34a' },
  ludo_v2:       { label: 'Ludo',            emoji: '🎮', color: '#3b82f6' },
  fantasy:       { label: 'Fantasy',         emoji: '⚽', color: '#10b981' },
};

interface MovementRow {
  game_type: string;
  user_id: string | null;
  movement_type: string;
  amount: number;
  game_id: string | null;
  created_at: string;
}

type SortKey = 'xp' | 'coins' | 'total_wins';

const chartTooltip = {
  backgroundColor: '#1e293b', borderColor: '#475569', borderWidth: 1,
  titleColor: '#f1f5f9', bodyColor: '#94a3b8', cornerRadius: 12, padding: 12,
};

const chartScales = {
  x: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
  y: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
};

export default function Analytics() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [rankStats, setRankStats] = useState<Record<string, number>>({});
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('xp');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [topRes, rankRes, mvRes] = await Promise.all([
          supabase.from('user_profiles')
            .select('id, username, coins, xp, rank, total_wins, games_played, games_won')
            .order(sortBy, { ascending: false })
            .limit(10),
          supabase.from('user_profiles').select('rank'),
          supabase.from('treasury_movements').select('*')
            .order('created_at', { ascending: false }).limit(10000),
        ]);

        const entries: LeaderboardEntry[] = (topRes.data ?? []).map(u => ({
          id: u.id,
          username: u.username ?? 'Joueur',
          coins: u.coins ?? 0,
          xp: u.xp ?? 0,
          rank: u.rank ?? 'Bronze',
          total_wins: u.total_wins ?? 0,
          games_played: u.games_played ?? 0,
          win_rate: (u.games_played ?? 0) > 0
            ? Math.round(((u.games_won ?? 0) / (u.games_played ?? 1)) * 100)
            : 0,
        }));
        setLeaderboard(entries);

        const dist: Record<string, number> = {};
        rankRes.data?.forEach(p => {
          const r = p.rank ?? 'Bronze';
          dist[r] = (dist[r] ?? 0) + 1;
        });
        setRankStats(dist);

        if (mvRes.data) setMovements(mvRes.data as MovementRow[]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sortBy]);

  // ── Stats par jeu ──
  const gameStats = useMemo(() => {
    const map = new Map<string, {
      gameIds: Set<string>;
      players: Set<string>;
      bets_in: number;
      payouts_out: number;
      house_cut: number;
    }>();
    for (const m of movements) {
      if (!m.game_type || m.game_type === 'system') continue;
      if (!map.has(m.game_type)) {
        map.set(m.game_type, {
          gameIds: new Set(), players: new Set(),
          bets_in: 0, payouts_out: 0, house_cut: 0,
        });
      }
      const e = map.get(m.game_type)!;
      if (m.game_id) e.gameIds.add(m.game_id);
      if (m.user_id) e.players.add(m.user_id);
      if (m.movement_type === 'loss_collect') e.bets_in += m.amount;
      if (m.movement_type === 'payout') e.payouts_out += m.amount;
      if (m.movement_type === 'house_cut') e.house_cut += m.amount;
    }
    return Array.from(map.entries()).map(([gt, v]) => ({
      game_type: gt,
      label: GAMES_META[gt]?.label ?? gt,
      color: GAMES_META[gt]?.color ?? '#94a3b8',
      rounds: v.gameIds.size,
      players: v.players.size,
      bets_in: v.bets_in,
      payouts_out: v.payouts_out,
      house_cut: v.house_cut,
      net_profit: v.bets_in - v.payouts_out,
    })).sort((a, b) => b.rounds - a.rounds);
  }, [movements]);

  // ── Activité par jour (7 derniers jours) ──
  const activityByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      const key = d.toISOString().slice(0, 10);
      days[key] = 0;
    }
    for (const m of movements) {
      if (m.movement_type !== 'loss_collect') continue;
      const key = m.created_at.slice(0, 10);
      if (key in days) days[key]++;
    }
    return days;
  }, [movements]);

  const activeRanks = RANK_ORDER.filter(r => rankStats[r]);
  const totalPlayers = Object.values(rankStats).reduce((a, b) => a + b, 0);

  const rankBarData = {
    labels: activeRanks,
    datasets: [{
      label: 'Joueurs',
      data: activeRanks.map(r => rankStats[r]),
      backgroundColor: activeRanks.map(r => (RANK_COLORS[r] ?? '#94a3b8') + 'bb'),
      borderColor: activeRanks.map(r => RANK_COLORS[r] ?? '#94a3b8'),
      borderWidth: 2, borderRadius: 8,
    }],
  };

  // ── Chart : parties par jeu ──
  const gameRoundsData = {
    labels: gameStats.map(g => g.label),
    datasets: [{
      label: 'Parties',
      data: gameStats.map(g => g.rounds),
      backgroundColor: gameStats.map(g => g.color + 'cc'),
      borderColor: gameStats.map(g => g.color),
      borderWidth: 2, borderRadius: 6,
    }],
  };

  // ── Chart : profit par jeu ──
  const gameProfitData = {
    labels: gameStats.map(g => g.label),
    datasets: [{
      label: 'Profit net',
      data: gameStats.map(g => g.net_profit),
      backgroundColor: gameStats.map(g => g.net_profit >= 0 ? '#22c55ecc' : '#ef4444cc'),
      borderColor: gameStats.map(g => g.net_profit >= 0 ? '#22c55e' : '#ef4444'),
      borderWidth: 2, borderRadius: 6,
    }],
  };

  // ── Chart : volume par jeu (doughnut) ──
  const gameVolumeData = {
    labels: gameStats.filter(g => g.bets_in > 0).map(g => g.label),
    datasets: [{
      data: gameStats.filter(g => g.bets_in > 0).map(g => g.bets_in),
      backgroundColor: gameStats.filter(g => g.bets_in > 0).map(g => g.color + 'cc'),
      borderColor: '#0f172a', borderWidth: 2,
    }],
  };

  // ── Chart : activité par jour ──
  const activityData = {
    labels: Object.keys(activityByDay).map(d => {
      const date = new Date(d);
      return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    }),
    datasets: [{
      label: 'Mises placées',
      data: Object.values(activityByDay),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.15)',
      borderWidth: 2, fill: true, tension: 0.4,
      pointRadius: 4, pointBackgroundColor: '#f97316',
    }],
  };

  const sortLabels: Record<SortKey, string> = {
    xp: 'XP', coins: 'Coins', total_wins: 'Victoires',
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const totalRounds = gameStats.reduce((s, g) => s + g.rounds, 0);
  const totalBets = gameStats.reduce((s, g) => s + g.bets_in, 0);
  const totalProfit = gameStats.reduce((s, g) => s + g.net_profit, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Statistiques</h1>
        <p className="text-sm text-text-muted">Analyse globale — joueurs et activité par jeu</p>
      </div>

      {/* CARDS GLOBAUX */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Joueurs Bronze" value={rankStats['Bronze'] ?? 0} icon={<Target className="h-5 w-5" />} />
        <StatsCard title="Joueurs Gold+" value={(rankStats['Gold'] ?? 0) + (rankStats['Platinum'] ?? 0) + (rankStats['Diamond'] ?? 0) + (rankStats['Legend'] ?? 0)} icon={<Trophy className="h-5 w-5" />} accent />
        <StatsCard title="Total parties (rounds)" value={totalRounds.toLocaleString()} icon={<Gamepad2 className="h-5 w-5" />} />
        <StatsCard title="Profit net système" value={totalProfit.toLocaleString()} icon={<Coins className="h-5 w-5" />} change={totalBets > 0 ? `${((totalProfit / totalBets) * 100).toFixed(1)}% du wagered` : ''} changeType={totalProfit >= 0 ? 'up' : 'down'} />
      </div>

      {/* ACTIVITÉ DERNIÈRE SEMAINE */}
      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-text">Activité — 7 derniers jours</h3>
        </div>
        <div className="h-56">
          <Line data={activityData} options={{
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: chartTooltip },
            scales: chartScales,
          }} />
        </div>
      </div>

      {/* STATS PAR JEU - TROIS CHARTS */}
      {gameStats.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            <h3 className="mb-3 text-sm font-semibold text-text-muted">Parties par jeu</h3>
            <div className="h-64">
              <Bar data={gameRoundsData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: chartTooltip },
                scales: chartScales, indexAxis: 'y' as const,
              }} />
            </div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            <h3 className="mb-3 text-sm font-semibold text-text-muted">Profit net par jeu</h3>
            <div className="h-64">
              <Bar data={gameProfitData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: chartTooltip },
                scales: chartScales, indexAxis: 'y' as const,
              }} />
            </div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            <h3 className="mb-3 text-sm font-semibold text-text-muted">Volume miser (répartition)</h3>
            <div className="h-64 flex items-center justify-center">
              {gameVolumeData.labels.length > 0 ? (
                <Doughnut data={gameVolumeData} options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { position: 'bottom' as const, labels: { color: '#94a3b8', font: { size: 10 }, padding: 10, boxWidth: 10 } },
                    tooltip: chartTooltip,
                  },
                }} />
              ) : (
                <p className="text-text-muted text-sm">Aucune donnée</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* RÉPARTITION PAR RANG */}
      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        <h3 className="mb-4 text-lg font-semibold text-text">Répartition par rang</h3>
        {activeRanks.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Aucun joueur enregistré.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-6">
              {RANK_ORDER.map(r => (
                <div key={r} className="rounded-xl border border-border/20 bg-surface p-3 text-center">
                  <p className={`text-lg font-bold ${RANK_TEXT[r] ?? 'text-slate-400'}`}>
                    {rankStats[r] ?? 0}
                  </p>
                  <p className="text-xs text-text-muted">{r}</p>
                  <p className={`text-xs opacity-60 ${RANK_TEXT[r] ?? 'text-slate-400'}`}>
                    {totalPlayers > 0 ? Math.round(((rankStats[r] ?? 0) / totalPlayers) * 100) : 0}%
                  </p>
                </div>
              ))}
            </div>
            <div className="h-52">
              <Bar data={rankBarData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: chartTooltip },
                scales: chartScales,
              }} />
            </div>
          </>
        )}
      </div>

      {/* LEADERBOARD */}
      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-text">Leaderboard — Top 10</h3>
          <div className="flex gap-1 rounded-xl bg-surface border border-border/20 p-1">
            {(Object.keys(sortLabels) as SortKey[]).map(k => (
              <button type="button" key={k} onClick={() => setSortBy(k)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  sortBy === k ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
                }`}>
                {sortLabels[k]}
              </button>
            ))}
          </div>
        </div>

        {leaderboard.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Aucun joueur enregistré.</p>
        ) : (
          <div className="space-y-2">
            {leaderboard.map((player, idx) => (
              <div key={player.id} className={`flex items-center justify-between rounded-xl p-3 transition-colors hover:bg-surface-lighter ${idx < 3 ? 'border border-primary/10 bg-primary/5' : ''}`}>
                <div className="flex items-center gap-4">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    idx === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    idx === 1 ? 'bg-gray-300/20 text-gray-300' :
                    idx === 2 ? 'bg-amber-600/20 text-amber-500' : 'bg-surface-lighter text-text-muted'
                  }`}>{idx + 1}</span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {player.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-text">{player.username}</p>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span className={RANK_TEXT[player.rank] ?? 'text-slate-400'}>{player.rank}</span>
                      <span>{player.games_played} parties</span>
                      <span>{player.win_rate}% winrate</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {sortBy === 'xp' && <p className="font-bold text-primary">{player.xp.toLocaleString()} <span className="text-xs text-text-muted">XP</span></p>}
                  {sortBy === 'coins' && <p className="font-bold text-primary">{player.coins.toLocaleString()} <span className="text-xs text-text-muted">coins</span></p>}
                  {sortBy === 'total_wins' && <p className="font-bold text-primary">{player.total_wins} <span className="text-xs text-text-muted">victoires</span></p>}
                  <div className="flex justify-end gap-3 text-xs text-text-muted mt-0.5">
                    {sortBy !== 'xp' && <span>{player.xp.toLocaleString()} XP</span>}
                    {sortBy !== 'coins' && <span>{player.coins.toLocaleString()} coins</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-export for icons used elsewhere
export { TrendingUp };
