import { useState, useEffect } from 'react';
import { Gamepad2, Trophy, TrendingUp, Users, RefreshCw, Dice5, Crown, Spade, Swords } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface GameStat {
  label: string;
  icon: React.ReactNode;
  color: string;
  total_games: number;
  total_wins: number;
  win_rate: number;
  active_players: number;
}

interface UserRow {
  games_played: number | null;
  games_won: number | null;
  total_wins: number | null;
  xp: number | null;
  cora_games: number | null;
  cora_wins: number | null;
  dames_games: number | null;
  dames_wins: number | null;
  solitary_games: number | null;
  ludo_games: number | null;
}

export default function GamesPage() {
  const [stats, setStats] = useState<GameStat[]>([]);
  const [global, setGlobal] = useState<GameStat | null>(null);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('games_played, games_won, total_wins, xp, cora_games, cora_wins, dames_games, dames_wins, solitary_games, ludo_games');

      if (!data) return;
      const rows = data as UserRow[];

      setTotalPlayers(rows.length);

      const sum = (key: keyof UserRow) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
      const activeOn = (key: keyof UserRow) => rows.filter(r => (r[key] ?? 0) > 0).length;
      const winRate = (wins: number, games: number) =>
        games > 0 ? Math.min(100, Math.round((wins / games) * 100)) : 0;

      // Stats globales (cumulées)
      const totalGames = sum('games_played');
      const totalWins  = sum('total_wins');
      setGlobal({
        label: 'Tous les jeux',
        icon: <Gamepad2 className="h-4 w-4" />,
        color: 'text-primary',
        total_games: totalGames,
        total_wins: totalWins,
        win_rate: winRate(totalWins, totalGames),
        active_players: activeOn('games_played'),
      });

      // Stats par jeu
      const coraGames = sum('cora_games');
      const coraWins  = sum('cora_wins');
      const damesGames = sum('dames_games');
      const damesWins  = sum('dames_wins');
      const solitaryGames = sum('solitary_games');
      const ludoGames  = sum('ludo_games');

      setStats([
        {
          label: 'Cora Dice', icon: <Dice5 className="h-4 w-4" />, color: 'text-success',
          total_games: coraGames, total_wins: coraWins,
          win_rate: winRate(coraWins, coraGames),
          active_players: activeOn('cora_games'),
        },
        {
          label: 'Dames', icon: <Crown className="h-4 w-4" />, color: 'text-warning',
          total_games: damesGames, total_wins: damesWins,
          win_rate: winRate(damesWins, damesGames),
          active_players: activeOn('dames_games'),
        },
        {
          label: 'Ludo', icon: <Swords className="h-4 w-4" />, color: 'text-info',
          total_games: ludoGames, total_wins: 0,
          win_rate: 0,
          active_players: activeOn('ludo_games'),
        },
        {
          label: 'Solitaire', icon: <Spade className="h-4 w-4" />, color: 'text-danger',
          total_games: solitaryGames, total_wins: 0,
          win_rate: 0,
          active_players: activeOn('solitary_games'),
        },
      ]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStats(); }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Parties</h1>
          <p className="text-sm text-text-muted">Statistiques agrégées depuis les profils joueurs</p>
        </div>
        <button onClick={fetchStats}
          className="flex items-center gap-2 rounded-xl border border-border/30 px-4 py-2 text-sm text-text-muted transition-colors hover:bg-surface-lighter hover:text-text">
          <RefreshCw className="h-4 w-4" />
          Rafraîchir
        </button>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Stats globales */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Total joueurs inscrits" value={totalPlayers.toLocaleString()} icon={<Users className="h-5 w-5" />} accent />
            <StatsCard title="Joueurs ayant joué" value={(global?.active_players ?? 0).toLocaleString()} icon={<Gamepad2 className="h-5 w-5" />}
              change={totalPlayers > 0 ? `${Math.round(((global?.active_players ?? 0) / totalPlayers) * 100)}% du total` : ''} changeType="neutral" />
            <StatsCard title="Total parties jouées" value={(global?.total_games ?? 0).toLocaleString()} icon={<TrendingUp className="h-5 w-5" />} />
            <StatsCard title="Win rate global" value={`${global?.win_rate ?? 0}%`} icon={<Trophy className="h-5 w-5" />} />
          </div>

          {/* Stats par jeu */}
          <div>
            <h2 className="mb-4 text-lg font-bold text-text">Détail par jeu</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-border/20 bg-surface-light p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <div className={`rounded-lg bg-surface p-2 ${s.color}`}>{s.icon}</div>
                    <h3 className="font-bold text-text">{s.label}</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Parties jouées</span>
                      <span className="font-semibold text-text">{s.total_games.toLocaleString()}</span>
                    </div>
                    {s.total_wins > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Victoires</span>
                        <span className="font-semibold text-text">{s.total_wins.toLocaleString()}</span>
                      </div>
                    )}
                    {s.total_games > 0 && s.total_wins > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Win rate</span>
                        <span className="font-semibold text-success">{s.win_rate}%</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm pt-2 border-t border-border/20">
                      <span className="text-text-muted">Joueurs actifs</span>
                      <span className="font-semibold text-primary">{s.active_players}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
