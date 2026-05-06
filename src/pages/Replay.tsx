import { useState, useCallback } from 'react';
import {
  History, Search, Loader2, Shield, Dices, Move, X,
  Trophy, Clock, Flag, RefreshCw, Eye,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

type GameType = 'ludo_v2' | 'cora_dice';

interface GameEvent {
  id: number | string;
  game_id: string;
  user_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  turn_number: number | null;
  created_at: string;
  username?: string | null;
}

const eventIcons: Record<string, React.ReactNode> = {
  game_started:           <Trophy className="h-4 w-4" />,
  roll_dice:              <Dices className="h-4 w-4" />,
  cora_roll_submitted:    <Dices className="h-4 w-4" />,
  play_move:              <Move className="h-4 w-4" />,
  skip_turn:              <X className="h-4 w-4" />,
  forfeit:                <Flag className="h-4 w-4" />,
  cora_forfeited:         <Flag className="h-4 w-4" />,
  timeout:                <Clock className="h-4 w-4" />,
  cleanup_stale:          <RefreshCw className="h-4 w-4" />,
  idle_forfeit_claimed:   <Flag className="h-4 w-4" />,
  player_joined:          <Trophy className="h-4 w-4" />,
};

const eventColors: Record<string, string> = {
  game_started:         'border-success/30 bg-success/5',
  roll_dice:            'border-info/30 bg-info/5',
  cora_roll_submitted:  'border-info/30 bg-info/5',
  play_move:            'border-primary/30 bg-primary/5',
  skip_turn:            'border-text-muted/30 bg-surface',
  forfeit:              'border-warning/30 bg-warning/5',
  cora_forfeited:       'border-warning/30 bg-warning/5',
  timeout:              'border-warning/30 bg-warning/5',
  cleanup_stale:        'border-danger/30 bg-danger/5',
  idle_forfeit_claimed: 'border-warning/30 bg-warning/5',
  player_joined:        'border-success/30 bg-success/5',
};

const eventLabels: Record<string, string> = {
  game_started:         'Partie démarrée',
  roll_dice:            'Dé lancé',
  cora_roll_submitted:  'Lancer Cora',
  play_move:            'Coup joué',
  skip_turn:            'Tour passé',
  forfeit:              'Forfait',
  cora_forfeited:       'Forfait',
  timeout:              'Timeout',
  cleanup_stale:        'Cleanup auto',
  idle_forfeit_claimed: 'Victoire AFK réclamée',
  player_joined:        'Joueur rejoint',
};

export default function ReplayPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [gameType, setGameType] = useState<GameType>('ludo_v2');
  const [gameId, setGameId] = useState('');
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentGames, setRecentGames] = useState<{ id: string; created_at: string; status: string; winner_id?: string | null }[]>([]);

  const loadRecentGames = useCallback(async (gt: GameType) => {
    const table = gt === 'ludo_v2' ? 'ludo_v2_games' : 'cora_games';
    const { data } = await supabase
      .from(table)
      .select('id, created_at, status' + (gt === 'ludo_v2' ? ', winner_id' : ', winner_ids'))
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) {
      setRecentGames((data as Array<{ id: string; created_at: string; status: string; winner_id?: string; winner_ids?: string[] }>).map(g => ({
        id: g.id,
        created_at: g.created_at,
        status: g.status,
        winner_id: g.winner_id ?? (g.winner_ids?.[0] ?? null),
      })));
    }
  }, []);

  const loadEvents = async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setEvents([]);

    try {
      let data: GameEvent[] = [];
      if (gameType === 'ludo_v2') {
        const { data: rows, error } = await supabase
          .from('ludo_v2_events')
          .select('*')
          .eq('game_id', id)
          .order('created_at', { ascending: true })
          .limit(2000);
        if (error) throw error;
        data = (rows ?? []) as GameEvent[];
      } else {
        // Cora utilise une RPC
        const { data: rows, error } = await supabase.rpc('cora_replay_game', { p_game_id: id });
        if (error) throw error;
        data = ((rows ?? []) as Array<{ event_id: number; event_type: string; user_id: string | null; payload: Record<string, unknown>; created_at: string }>).map(r => ({
          id: r.event_id,
          game_id: id,
          user_id: r.user_id,
          event_type: r.event_type,
          payload: r.payload,
          turn_number: null,
          created_at: r.created_at,
        }));
      }

      // Enrich avec usernames
      const userIds = [...new Set(data.map(e => e.user_id).filter(Boolean))] as string[];
      let usernames: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, username')
          .in('id', userIds);
        if (profiles) {
          usernames = (profiles as { id: string; username: string | null }[])
            .reduce<Record<string, string>>((acc, p) => {
              acc[p.id] = p.username ?? 'Joueur';
              return acc;
            }, {});
        }
      }

      setEvents(data.map(e => ({
        ...e,
        username: e.user_id ? (usernames[e.user_id] ?? 'Joueur') : null,
      })));
    } catch (e) {
      const err = e as Error;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Shield className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Section réservée au super admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center gap-2">
          <History className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-text">Replay de partie</h1>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Audit complet d'une partie : timeline de tous les events (dés, coups, captures, forfaits) pour résoudre les litiges.
        </p>
      </div>

      {/* Choix du jeu */}
      <div className="rounded-2xl border border-border/30 bg-surface-light p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium text-text">Type de jeu :</span>
          <div className="flex gap-1 rounded-lg border border-border/30 bg-surface p-1">
            {(['ludo_v2', 'cora_dice'] as GameType[]).map(g => (
              <button
                key={g}
                onClick={() => { setGameType(g); setEvents([]); setRecentGames([]); }}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  gameType === g ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {g === 'ludo_v2' ? 'Ludo' : 'Cora Dice'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={gameId}
              onChange={e => setGameId(e.target.value)}
              placeholder="Game ID (UUID, ex: a1b2c3d4-...)"
              className="w-full rounded-lg border border-border/30 bg-surface pl-10 pr-4 py-2 text-sm text-text font-mono placeholder:text-text-muted focus:border-primary focus:outline-none"
            />
          </div>
          <button
            onClick={() => loadEvents(gameId)}
            disabled={loading || !gameId}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Charger
          </button>
          <button
            onClick={() => loadRecentGames(gameType)}
            className="flex items-center gap-2 rounded-lg border border-border/30 bg-surface px-4 py-2 text-sm text-text-muted hover:bg-surface-lighter hover:text-text"
          >
            <RefreshCw className="h-4 w-4" />
            Lister récents
          </button>
        </div>
      </div>

      {/* Liste des games récents (si chargée) */}
      {recentGames.length > 0 && (
        <div className="rounded-2xl border border-border/20 bg-surface-light p-4">
          <h3 className="text-sm font-semibold text-text-muted mb-3">20 dernières parties</h3>
          <div className="grid gap-2">
            {recentGames.map(g => (
              <button
                key={g.id}
                onClick={() => { setGameId(g.id); loadEvents(g.id); }}
                className="flex items-center gap-3 rounded-lg border border-border/20 bg-surface p-2 text-left hover:bg-surface-lighter"
              >
                <span className="font-mono text-xs text-text-muted truncate flex-1">{g.id}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  g.status === 'finished' ? 'bg-success/15 text-success' :
                  g.status === 'cancelled' ? 'bg-warning/15 text-warning' :
                  'bg-info/15 text-info'
                }`}>{g.status}</span>
                <span className="text-xs text-text-muted">
                  {formatDistanceToNow(new Date(g.created_at), { addSuffix: true, locale: fr })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Timeline events */}
      {events.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-text">Timeline ({events.length} events)</h2>
            <span className="text-xs text-text-muted font-mono">{gameId.slice(0, 16)}...</span>
          </div>
          <div className="space-y-2">
            {events.map((e, idx) => (
              <EventRow key={String(e.id)} event={e} index={idx + 1} prevEvent={idx > 0 ? events[idx - 1] : null} />
            ))}
          </div>
        </div>
      )}

      {!loading && events.length === 0 && gameId && !error && (
        <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
          <p className="font-semibold text-text">Aucun event</p>
          <p className="mt-2 text-sm text-text-muted">
            Vérifie le game_id, ou la partie n'a pas généré d'events (versions anciennes pré-tracking).
          </p>
        </div>
      )}
    </div>
  );
}

function EventRow({ event, index, prevEvent }: {
  event: GameEvent;
  index: number;
  prevEvent: GameEvent | null;
}) {
  const icon = eventIcons[event.event_type] ?? <History className="h-4 w-4" />;
  const color = eventColors[event.event_type] ?? 'border-border/20 bg-surface';
  const label = eventLabels[event.event_type] ?? event.event_type;

  // Calcul du delta avec event précédent
  const deltaMs = prevEvent
    ? new Date(event.created_at).getTime() - new Date(prevEvent.created_at).getTime()
    : null;

  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-lighter font-bold text-xs text-text-muted shrink-0">
          {index}
        </div>
        <div className="rounded-lg bg-surface p-1.5 shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text text-sm">{label}</span>
            {event.username && (
              <span className="text-xs text-text-muted">par <span className="text-text">{event.username}</span></span>
            )}
            {event.turn_number !== null && (
              <span className="rounded bg-text-muted/15 px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
                tour {event.turn_number}
              </span>
            )}
          </div>

          {Object.keys(event.payload).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(event.payload).slice(0, 6).map(([k, v]) => (
                <span key={k} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted font-mono">
                  {k}: <span className="text-text">{typeof v === 'object' ? JSON.stringify(v).slice(0, 25) : String(v).slice(0, 25)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-right text-xs text-text-muted shrink-0">
          <div>{format(new Date(event.created_at), 'HH:mm:ss', { locale: fr })}</div>
          {deltaMs !== null && (
            <div className="text-[10px] opacity-70">
              {deltaMs < 1000 ? `+${deltaMs}ms` : `+${(deltaMs / 1000).toFixed(1)}s`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
