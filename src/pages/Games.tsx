import { useState, useEffect } from 'react';
import { Gamepad2, Trophy, TrendingUp, Users, RefreshCw, Info } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface GameStat {
  label: string;
  total_games: number;
  total_wins: number;
  win_rate: number;
  active_players: number;
}

// Les stats de jeu viennent des colonnes calculées sur user_profiles
// car les parties sont stockées localement (Hive) dans l'app Flutter
export default function GamesPage() {
  const [stats, setStats] = useState<GameStat[]>([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('games_played, games_won, total_wins, xp');

      if (!data) return;

      setTotalPlayers(data.length);

      // On agrège les stats globales depuis user_profiles
      const totalGames = data.reduce((s, p) => s + (p.games_played ?? 0), 0);
      const totalWins  = data.reduce((s, p) => s + (p.total_wins ?? 0), 0);
      const activePlayers = data.filter(p => (p.games_played ?? 0) > 0).length;

      // Note : les stats par jeu (Cora, Dames, Solitaire, Ludo) viennent
      // de Hive local dans l'app — non disponibles côté Supabase.
      // On affiche les stats globales disponibles.
      setStats([
        {
          label: 'Tous les jeux',
          total_games: totalGames,
          total_wins: totalWins,
          win_rate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0,
          active_players: activePlayers,
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

      {/* Bandeau info */}
      <div className="flex items-start gap-3 rounded-xl border border-info/20 bg-info/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="text-sm text-text-muted">
          <p className="font-medium text-text mb-1">Données de jeu partiellement disponibles</p>
          <p>Les parties actives en temps réel et les stats par jeu (Cora Dice, Dames, Solitaire, Ludo) sont stockées localement dans l'application (Hive). Seuls les totaux synchronisés dans <code className="rounded bg-surface px-1 py-0.5 text-xs text-primary">user_profiles</code> sont visibles ici.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Total joueurs inscrits" value={totalPlayers.toLocaleString()} icon={<Users className="h-5 w-5" />} accent />
            <StatsCard title="Joueurs ayant joué" value={(stats[0]?.active_players ?? 0).toLocaleString()} icon={<Gamepad2 className="h-5 w-5" />}
              change={totalPlayers > 0 ? `${Math.round(((stats[0]?.active_players ?? 0) / totalPlayers) * 100)}% du total` : ''} changeType="neutral" />
            <StatsCard title="Total parties jouées" value={(stats[0]?.total_games ?? 0).toLocaleString()} icon={<TrendingUp className="h-5 w-5" />} />
            <StatsCard title="Win rate global" value={`${stats[0]?.win_rate ?? 0}%`} icon={<Trophy className="h-5 w-5" />} />
          </div>

          {/* Pour avoir les stats par jeu, il faudra ajouter des colonnes dans Supabase */}
          <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-8 text-center">
            <Gamepad2 className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
            <p className="font-semibold text-text">Stats par jeu non disponibles</p>
            <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
              Pour voir les stats séparées par jeu (Cora Dice, Dames, Solitaire, Ludo),
              il faut ajouter des colonnes dans <code className="text-primary">user_profiles</code> :
            </p>
            <div className="mt-4 rounded-xl bg-surface p-4 text-left text-xs font-mono text-text-muted max-w-lg mx-auto">
              <p className="text-success">-- Ajouter dans Supabase SQL Editor :</p>
              <p>ALTER TABLE user_profiles</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS cora_games   INTEGER DEFAULT 0,</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS cora_wins    INTEGER DEFAULT 0,</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS dames_games  INTEGER DEFAULT 0,</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS dames_wins   INTEGER DEFAULT 0,</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS solitary_games INTEGER DEFAULT 0,</p>
              <p className="pl-4">ADD COLUMN IF NOT EXISTS ludo_games   INTEGER DEFAULT 0;</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
