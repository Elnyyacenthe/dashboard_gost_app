// ============================================================
// GAME REPLAY - Timeline events d'une partie pour audit/litige
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Clock, Activity, AlertTriangle, Loader2, Play, Pause,
  ChevronLeft, ChevronRight, RotateCcw, Lock, Eye, Coins,
  GamepadIcon as Gamepad,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface ReplayEvent {
  id: number;
  game_id: string;
  game_type: string;
  event_type: string;
  user_id: string | null;
  username: string | null;
  payload: Record<string, unknown>;
  state_before: Record<string, unknown> | null;
  state_after: Record<string, unknown> | null;
  client_ts: string | null;
  server_ts: string;
  delta_seconds: number | null;
  clock_drift_seconds: number | null;
}

interface MovementSummary {
  movement_type: string;
  amount: number;
  user_id: string | null;
  created_at: string;
}

const eventColors: Record<string, string> = {
  game_start:      'bg-info/15 text-info border-info/30',
  bet_placed:      'bg-warning/15 text-warning border-warning/30',
  dice_roll:       'bg-primary/15 text-primary border-primary/30',
  move:            'bg-purple-500/15 text-purple-400 border-purple-500/30',
  turn_change:     'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  payout:          'bg-success/15 text-success border-success/30',
  refund:          'bg-info/15 text-info border-info/30',
  game_end:        'bg-success/15 text-success border-success/30',
  crash_detected:  'bg-danger/15 text-danger border-danger/30',
  stalled:         'bg-danger/15 text-danger border-danger/30',
  admin_refund:    'bg-warning/15 text-warning border-warning/30',
};

export default function GameReplay() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);

  const load = useCallback(async () => {
    if (!gameId) return;
    setLoading(true);
    const [eventsRes, movRes] = await Promise.all([
      supabase.from('game_replay_view').select('*').eq('game_id', gameId).order('server_ts').limit(2000),
      supabase.from('treasury_movements').select('movement_type, amount, user_id, created_at')
        .eq('game_id', gameId).order('created_at'),
    ]);
    if (eventsRes.data) setEvents(eventsRes.data as ReplayEvent[]);
    if (movRes.data) setMovements(movRes.data as MovementSummary[]);
    setLoading(false);
  }, [gameId]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  // Auto-play
  useEffect(() => {
    if (!playing || events.length === 0) return;
    if (cursor >= events.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setCursor(c => Math.min(c + 1, events.length - 1)), 800 / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, events.length, speed]);

  if (authLoading || loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-warning" />
          <p className="font-semibold text-text">Aucun event enregistré pour cette partie</p>
          <p className="mt-2 text-sm text-text-muted font-mono">{gameId}</p>
          <p className="mt-3 text-xs text-text-muted max-w-md mx-auto">
            Soit la partie est antérieure à l'instrumentation game_events,
            soit le jeu n'envoie pas encore d'events. {movements.length > 0 && `${movements.length} mouvement(s) treasury en revanche.`}
          </p>
          {movements.length > 0 && (
            <div className="mt-6 rounded-xl border border-border/20 bg-surface p-4 text-left max-w-lg mx-auto">
              <p className="mb-2 text-xs font-semibold text-text">Mouvements treasury :</p>
              {movements.map((m, i) => (
                <div key={i} className="flex justify-between text-xs py-1">
                  <span>{format(new Date(m.created_at), 'HH:mm:ss', { locale: fr })} · {m.movement_type}</span>
                  <span className="font-mono">{m.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const current = events[cursor];
  const startTs = new Date(events[0].server_ts).getTime();
  const endTs = new Date(events[events.length - 1].server_ts).getTime();
  const totalDuration = (endTs - startTs) / 1000;
  const elapsed = (new Date(current.server_ts).getTime() - startTs) / 1000;

  // Detect anomalies
  const anomalies = events.filter(e =>
    (e.delta_seconds ?? 0) > 60 ||           // Gap > 1min
    (e.clock_drift_seconds ?? 0) > 10        // Drift > 10s
  );

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="card-plugbet relative overflow-hidden p-5">
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => navigate(-1)} aria-label="Retour"
              className="rounded-xl border border-border/40 p-2 text-text-secondary hover:border-primary/30 hover:text-text transition-colors">
              <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
                Plugbet · Game replay
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Gamepad className="h-5 w-5 text-primary" strokeWidth={2.2} />
                <h1 className="hero-number text-xl text-text">Replay <span className="text-primary">{events[0].game_type}</span></h1>
              </div>
              <p className="mt-0.5 text-[10px] text-text-muted font-mono">{gameId}</p>
            </div>
          </div>
          {anomalies.length > 0 && (
            <div className="pulse-danger flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/30 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-danger" />
              <span className="text-xs font-bold uppercase tracking-wider text-danger">
                {anomalies.length} anomalie{anomalies.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Events" value={events.length.toString()} icon={<Activity />} />
        <Stat label="Durée" value={`${Math.round(totalDuration)}s`} icon={<Clock />} />
        <Stat label="Joueurs" value={new Set(events.map(e => e.user_id).filter(Boolean)).size.toString()} icon={<Eye />} />
        <Stat label="Mouvements financiers" value={movements.length.toString()} icon={<Coins />} />
      </div>

      {/* Timeline + control */}
      <div className="card-plugbet p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button type="button" onClick={() => setCursor(0)} aria-label="Retour au début"
            className="rounded-xl border border-border/40 p-2 text-text-secondary hover:border-primary/30 hover:text-text transition-colors" title="Début">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0} aria-label="Event précédent"
            className="rounded-xl border border-border/40 p-2 text-text-secondary hover:border-primary/30 hover:text-text disabled:opacity-30 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Lecture'}
            className="rounded-xl bg-primary p-2 text-surface hover:bg-primary-light hover:shadow-[0_0_18px_rgba(0,230,118,0.4)] transition-all">
            {playing ? <Pause className="h-4 w-4" strokeWidth={2.5} /> : <Play className="h-4 w-4" strokeWidth={2.5} />}
          </button>
          <button type="button" onClick={() => setCursor(c => Math.min(events.length - 1, c + 1))} disabled={cursor >= events.length - 1} aria-label="Event suivant"
            className="rounded-xl border border-border/40 p-2 text-text-secondary hover:border-primary/30 hover:text-text disabled:opacity-30 transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
          <select value={speed} onChange={e => setSpeed(Number(e.target.value) as 1 | 2 | 4)} aria-label="Vitesse de lecture"
            className="rounded-xl border border-border/40 bg-surface/50 px-3 py-2 text-xs font-bold text-text">
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
          <span className="ml-auto display-number text-xs text-text-secondary">
            <span className="text-text">{cursor + 1}</span> / {events.length} · {Math.round(elapsed)}s
          </span>
        </div>

        {/* Slider */}
        <input
          type="range"
          aria-label="Position dans la timeline"
          min={0}
          max={events.length - 1}
          value={cursor}
          onChange={e => { setCursor(Number(e.target.value)); setPlaying(false); }}
          className="w-full accent-primary"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,2fr]">
        {/* Current event detail */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-5">
          <p className="mb-2 text-xs font-semibold text-text-muted uppercase">Event courant</p>
          <div className={`rounded-xl border px-3 py-1.5 inline-block text-xs font-bold ${eventColors[current.event_type] ?? 'bg-surface-lighter text-text-muted border-border/30'}`}>
            {current.event_type}
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <Row label="Joueur" value={current.username ?? '—'} />
            <Row label="Server time" value={format(new Date(current.server_ts), 'HH:mm:ss.SSS', { locale: fr })} />
            {current.client_ts && (
              <Row label="Client time" value={format(new Date(current.client_ts), 'HH:mm:ss.SSS', { locale: fr })} />
            )}
            {current.delta_seconds != null && (
              <Row label="Δ event précédent" value={`${current.delta_seconds.toFixed(2)}s`}
                warning={current.delta_seconds > 60} />
            )}
            {current.clock_drift_seconds != null && (
              <Row label="Désync horloge" value={`${current.clock_drift_seconds.toFixed(2)}s`}
                warning={current.clock_drift_seconds > 5} />
            )}
          </div>
          {Object.keys(current.payload).length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold text-text-muted">Payload</p>
              <pre className="rounded-lg bg-surface p-2 text-[11px] text-text overflow-x-auto">
                {JSON.stringify(current.payload, null, 2)}
              </pre>
            </div>
          )}
          {current.state_before && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-text-muted">État avant</p>
              <pre className="rounded-lg bg-surface p-2 text-[11px] text-text overflow-x-auto max-h-32">
                {JSON.stringify(current.state_before, null, 2)}
              </pre>
            </div>
          )}
          {current.state_after && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold text-text-muted">État après</p>
              <pre className="rounded-lg bg-surface p-2 text-[11px] text-text overflow-x-auto max-h-32">
                {JSON.stringify(current.state_after, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Timeline list */}
        <div className="rounded-2xl border border-border/30 bg-surface-light overflow-hidden">
          <div className="border-b border-border/20 px-5 py-3">
            <p className="text-sm font-semibold text-text">Timeline ({events.length})</p>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {events.map((e, i) => {
              const isAnomaly = (e.delta_seconds ?? 0) > 60 || (e.clock_drift_seconds ?? 0) > 10;
              return (
                <button key={e.id}
                  onClick={() => { setCursor(i); setPlaying(false); }}
                  className={`w-full flex items-start gap-3 border-b border-border/10 px-4 py-2.5 text-left hover:bg-surface-lighter ${
                    i === cursor ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                  }`}>
                  <span className="text-xs font-mono text-text-muted/60 mt-0.5 w-8">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${eventColors[e.event_type] ?? 'bg-surface-lighter text-text-muted'}`}>
                        {e.event_type}
                      </span>
                      <span className="text-xs text-text-muted truncate">{e.username ?? '—'}</span>
                      {isAnomaly && <AlertTriangle className="h-3 w-3 text-danger" />}
                    </div>
                    <p className="text-[10px] text-text-muted/60 mt-0.5">
                      {format(new Date(e.server_ts), 'HH:mm:ss.SSS', { locale: fr })}
                      {e.delta_seconds != null && ` · +${e.delta_seconds.toFixed(1)}s`}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Mouvements financiers liés */}
      {movements.length > 0 && (
        <div className="rounded-2xl border border-border/30 bg-surface-light overflow-hidden">
          <div className="border-b border-border/20 px-5 py-3 flex items-center gap-2">
            <Coins className="h-4 w-4 text-warning" />
            <p className="text-sm font-semibold text-text">Mouvements financiers ({movements.length})</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface text-xs uppercase text-text-muted">
              <tr className="text-left">
                <th className="px-4 py-2">Heure</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m, i) => (
                <tr key={i} className="border-b border-border/10">
                  <td className="px-4 py-2 text-xs text-text-muted">
                    {format(new Date(m.created_at), 'HH:mm:ss', { locale: fr })}
                  </td>
                  <td className="px-4 py-2 text-xs">{m.movement_type}</td>
                  <td className="px-4 py-2 text-xs font-mono text-text-muted">
                    {m.user_id ? (
                      <Link to={`/dashboard/users/${m.user_id}`} className="hover:text-primary">
                        {m.user_id.slice(0, 8)}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-bold">{m.amount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer info */}
      <div className="text-xs text-text-muted text-center">
        Replay généré depuis <code>game_events</code> · enregistré il y a {formatDistanceToNow(new Date(events[0].server_ts), { addSuffix: true, locale: fr })}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/20 bg-surface-light p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{label}</p>
        <span className="text-text-muted">{icon}</span>
      </div>
      <p className="mt-1 text-xl font-bold text-text">{value}</p>
    </div>
  );
}

function Row({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-xs font-mono ${warning ? 'text-danger font-bold' : 'text-text'}`}>{value}</span>
    </div>
  );
}
