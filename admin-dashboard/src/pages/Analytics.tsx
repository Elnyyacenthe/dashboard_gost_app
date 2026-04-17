import { useState, useEffect } from 'react';
import { Trophy, Target, TrendingUp, Coins } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';
import type { LeaderboardEntry } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const RANK_ORDER = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'];
const RANK_COLORS: Record<string, string> = {
  Bronze: '#cd7f32', Silver: '#94a3b8', Gold: '#eab308',
  Platinum: '#22d3ee', Diamond: '#3b82f6', Legend: '#f97316',
};
// Classes Tailwind statiques pour éviter les inline styles JSX
const RANK_TEXT: Record<string, string> = {
  Bronze: 'text-amber-700', Silver: 'text-slate-400', Gold: 'text-yellow-400',
  Platinum: 'text-cyan-400', Diamond: 'text-blue-500', Legend: 'text-orange-400',
};

type SortKey = 'xp' | 'coins' | 'total_wins';

export default function Analytics() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [rankStats, setRankStats] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<SortKey>('xp');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Top 10 par critère sélectionné
        const { data: top } = await supabase
          .from('user_profiles')
          .select('id, username, coins, xp, rank, total_wins, games_played, games_won')
          .order(sortBy, { ascending: false })
          .limit(10);

        const entries: LeaderboardEntry[] = (top ?? []).map(u => ({
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

        // Distribution des rangs
        const { data: allProfiles } = await supabase
          .from('user_profiles')
          .select('rank');

        const dist: Record<string, number> = {};
        allProfiles?.forEach(p => {
          const r = p.rank ?? 'Bronze';
          dist[r] = (dist[r] ?? 0) + 1;
        });
        setRankStats(dist);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sortBy]);

  const activeRanks = RANK_ORDER.filter(r => rankStats[r]);
  const totalPlayers = Object.values(rankStats).reduce((a, b) => a + b, 0);

  const barData = {
    labels: activeRanks,
    datasets: [{
      label: 'Joueurs',
      data: activeRanks.map(r => rankStats[r]),
      backgroundColor: activeRanks.map(r => (RANK_COLORS[r] ?? '#94a3b8') + 'bb'),
      borderColor: activeRanks.map(r => RANK_COLORS[r] ?? '#94a3b8'),
      borderWidth: 2, borderRadius: 8,
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Statistiques</h1>
        <p className="text-sm text-text-muted">Analyse des joueurs de ton application</p>
      </div>

      {/* Stats globales par rang */}
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
              <Bar data={barData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', borderColor: '#475569', borderWidth: 1, titleColor: '#f1f5f9', bodyColor: '#94a3b8', cornerRadius: 12 } },
                scales: {
                  x: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8' } },
                  y: { grid: { color: 'rgba(71,85,105,0.2)' }, ticks: { color: '#94a3b8' } },
                },
              }} />
            </div>
          </>
        )}
      </div>

      {/* Leaderboard */}
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

      {/* Cards stats globales */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Joueurs Bronze" value={rankStats['Bronze'] ?? 0} icon={<Target className="h-5 w-5" />} />
        <StatsCard title="Joueurs Gold+" value={(rankStats['Gold'] ?? 0) + (rankStats['Platinum'] ?? 0) + (rankStats['Diamond'] ?? 0) + (rankStats['Legend'] ?? 0)} icon={<Trophy className="h-5 w-5" />} accent />
        <StatsCard title="Meilleur XP" value={leaderboard[0]?.xp.toLocaleString() ?? '0'} icon={<TrendingUp className="h-5 w-5" />} />
        <StatsCard title="Meilleur solde" value={`${leaderboard.find(p => p.coins === Math.max(...leaderboard.map(l => l.coins)))?.coins.toLocaleString() ?? 0} coins`} icon={<Coins className="h-5 w-5" />} />
      </div>
    </div>
  );
}
