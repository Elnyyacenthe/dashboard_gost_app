import { useState, useEffect } from 'react';
import { Users, Coins, Trophy, Gamepad2, TrendingUp, Star } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';
import type { DashboardKPIs, UserProfile } from '../types';

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

export default function Overview() {
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [topPlayers, setTopPlayers] = useState<UserProfile[]>([]);
  const [rankDist, setRankDist] = useState<Record<string, number>>({});
  const [coinsBuckets, setCoinsBuckets] = useState<number[]>([0, 0, 0, 0]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: players } = await supabase
          .from('user_profiles')
          .select('id, coins, xp, rank, total_wins, games_played, last_seen');

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

        const { data: top } = await supabase
          .from('user_profiles')
          .select('*')
          .order('xp', { ascending: false })
          .limit(5);
        setTopPlayers((top ?? []) as UserProfile[]);
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
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.1)',
      borderWidth: 2, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#f97316',
    }],
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Overview</h1>
        <p className="text-sm text-text-muted">Données réelles de ton application</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard title="Total joueurs inscrits" value={(kpis?.total_players ?? 0).toLocaleString()} icon={<Users className="h-5 w-5" />} accent />
        <StatsCard title="Actifs (7 derniers jours)" value={(kpis?.active_players_7d ?? 0).toLocaleString()} icon={<TrendingUp className="h-5 w-5" />}
          change={kpis ? `${Math.round((kpis.active_players_7d / Math.max(kpis.total_players, 1)) * 100)}% du total` : ''} changeType="neutral" />
        <StatsCard title="Coins en circulation" value={(kpis?.total_coins ?? 0).toLocaleString()} icon={<Coins className="h-5 w-5" />} />
        <StatsCard title="Parties jouées (total)" value={(kpis?.total_games_played ?? 0).toLocaleString()} icon={<Gamepad2 className="h-5 w-5" />} />
        <StatsCard title="Total victoires" value={(kpis?.total_wins ?? 0).toLocaleString()} icon={<Trophy className="h-5 w-5" />}
          change={kpis?.total_games_played ? `${Math.round((kpis.total_wins / kpis.total_games_played) * 100)}% win rate global` : '—'} changeType="neutral" />
        <StatsCard title="Rang le plus élevé atteint" value={kpis?.top_rank ?? 'N/A'} icon={<Star className="h-5 w-5" />} accent />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
          <h3 className="mb-4 text-sm font-semibold text-text-muted">Distribution des rangs</h3>
          <div className="h-64">
            {activeRanks.length > 0 ? <Bar data={rankChart} options={chartBase} /> : (
              <div className="flex h-full items-center justify-center text-text-muted text-sm">Aucun joueur enregistré</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
          <h3 className="mb-4 text-sm font-semibold text-text-muted">Répartition des soldes de coins</h3>
          <div className="h-64">
            <Line data={coinsChart} options={chartBase} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        <h3 className="mb-4 text-lg font-semibold text-text">Top 5 joueurs par XP</h3>
        {topPlayers.length === 0 ? (
          <p className="py-8 text-center text-text-muted">Aucun joueur enregistré pour l'instant.</p>
        ) : (
          <div className="space-y-2">
            {topPlayers.map((p, idx) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl p-3 transition-colors hover:bg-surface-lighter">
                <div className="flex items-center gap-4">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    idx === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    idx === 1 ? 'bg-gray-300/20 text-gray-300' :
                    idx === 2 ? 'bg-amber-600/20 text-amber-500' : 'bg-surface-lighter text-text-muted'
                  }`}>{idx + 1}</span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                    {(p.username ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-text">{p.username ?? 'Joueur'}</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${RANK_TEXT[p.rank ?? 'Bronze'] ?? 'text-slate-400'}`}>{p.rank ?? 'Bronze'}</span>
                      <span className="text-xs text-text-muted">{p.games_played ?? 0} parties · {p.total_wins ?? 0} victoires</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">{(p.xp ?? 0).toLocaleString()} XP</p>
                  <p className="text-xs text-text-muted">{(p.coins ?? 0).toLocaleString()} coins</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
