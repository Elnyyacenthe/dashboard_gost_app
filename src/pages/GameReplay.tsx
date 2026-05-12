// ============================================================
// GAME REPLAY - Timeline events d'une partie pour audit/litige
// Light theme + filtres event/user + vitesses fines + jump anomaly
// ============================================================
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Clock, Activity, AlertTriangle, Loader2, Play, Pause,
  ChevronLeft, ChevronRight, RotateCcw, Lock, Eye, Coins,
  GamepadIcon as Gamepad, Filter, Repeat, FastForward, X, Search,
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

// Couleurs adaptées light theme
const eventColors: Record<string, string> = {
  game_start:      'bg-blue-100 text-blue-700 border-blue-200',
  bet_placed:      'bg-amber-100 text-amber-700 border-amber-200',
  dice_roll:       'bg-emerald-100 text-emerald-700 border-emerald-200',
  move:            'bg-violet-100 text-violet-700 border-violet-200',
  turn_change:     'bg-cyan-100 text-cyan-700 border-cyan-200',
  turn_skipped:    'bg-slate-100 text-slate-700 border-slate-200',
  payout:          'bg-emerald-100 text-emerald-700 border-emerald-200',
  refund:          'bg-blue-100 text-blue-700 border-blue-200',
  game_end:        'bg-emerald-100 text-emerald-700 border-emerald-200',
  crash_detected:  'bg-red-100 text-red-700 border-red-200',
  stalled:         'bg-red-100 text-red-700 border-red-200',
  admin_refund:    'bg-amber-100 text-amber-700 border-amber-200',
  player_joined:   'bg-cyan-100 text-cyan-700 border-cyan-200',
  tile_revealed:   'bg-emerald-50 text-emerald-600 border-emerald-200',
  mine_hit:        'bg-red-100 text-red-700 border-red-200',
};

type Speed = 0.5 | 1 | 2 | 4 | 8;
const SPEEDS: Speed[] = [0.5, 1, 2, 4, 8];

export default function GameReplay() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [loop, setLoop] = useState(false);

  // Filters
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(new Set());
  const [userFilter, setUserFilter] = useState<string>('all'); // user_id or 'all'
  const [searchPayload, setSearchPayload] = useState('');

  const timelineRef = useRef<HTMLDivElement>(null);

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

  // ─── Liste filtrée ───────────────────────────────────────
  const filteredEvents = useMemo(() => {
    const q = searchPayload.trim().toLowerCase();
    return events.filter(e => {
      if (excludedTypes.has(e.event_type)) return false;
      if (userFilter !== 'all' && e.user_id !== userFilter) return false;
      if (q) {
        const haystack = JSON.stringify({
          payload: e.payload,
          state_before: e.state_before,
          state_after: e.state_after,
          username: e.username,
          event_type: e.event_type,
        }).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [events, excludedTypes, userFilter, searchPayload]);

  // Si le cursor sort de la liste filtrée, on réajuste
  useEffect(() => {
    if (filteredEvents.length === 0) return;
    if (cursor >= filteredEvents.length) setCursor(filteredEvents.length - 1);
  }, [filteredEvents.length, cursor]);

  // Auto-play
  useEffect(() => {
    if (!playing || filteredEvents.length === 0) return;
    if (cursor >= filteredEvents.length - 1) {
      if (loop) {
        setCursor(0);
      } else {
        setPlaying(false);
      }
      return;
    }
    const t = setTimeout(() => setCursor(c => Math.min(c + 1, filteredEvents.length - 1)), 800 / speed);
    return () => clearTimeout(t);
  }, [playing, cursor, filteredEvents.length, speed, loop]);

  // Scroll auto vers l'event courant dans la timeline
  useEffect(() => {
    const el = timelineRef.current?.querySelector(`[data-cursor="${cursor}"]`);
    if (el && 'scrollIntoView' in el) {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [cursor]);

  if (authLoading || loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-red-200 bg-red-50 p-16 text-center">
        <Lock className="h-12 w-12 text-red-600" />
        <h2 className="text-xl font-bold text-red-700">Accès refusé</h2>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-600" />
          <p className="font-semibold text-slate-900">Aucun event enregistré pour cette partie</p>
          <p className="mt-2 text-xs text-slate-500 font-mono">{gameId}</p>
          <p className="mt-3 text-xs text-slate-500 max-w-md mx-auto">
            Soit la partie est antérieure à l'instrumentation game_events,
            soit le jeu n'envoie pas encore d'events. {movements.length > 0 && `${movements.length} mouvement(s) treasury en revanche.`}
          </p>
          {movements.length > 0 && (
            <div className="mt-6 exec-card p-4 text-left max-w-lg mx-auto">
              <p className="mb-2 text-xs font-bold text-slate-700 uppercase">Mouvements treasury</p>
              {movements.map((m, i) => (
                <div key={i} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-b-0">
                  <span className="text-slate-600">{format(new Date(m.created_at), 'HH:mm:ss', { locale: fr })} · {m.movement_type}</span>
                  <span className="font-mono font-bold text-slate-900">{m.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Stats globales (toujours sur events complets, pas filtré)
  const current = filteredEvents[cursor] ?? events[0];
  const startTs = new Date(events[0].server_ts).getTime();
  const endTs = new Date(events[events.length - 1].server_ts).getTime();
  const totalDuration = (endTs - startTs) / 1000;
  const elapsed = current ? (new Date(current.server_ts).getTime() - startTs) / 1000 : 0;

  // Anomalies : sur events complets pour stats correctes
  const anomalies = events.filter(e =>
    (e.delta_seconds ?? 0) > 60 ||
    (e.clock_drift_seconds ?? 0) > 10
  );

  // Tous les types d'events présents
  const allEventTypes = Array.from(new Set(events.map(e => e.event_type))).sort();
  // Tous les users présents
  const allUsers = Array.from(new Set(events.map(e => e.user_id).filter(Boolean)))
    .map(uid => ({ id: uid!, username: events.find(e => e.user_id === uid)?.username ?? uid! }));

  const toggleEventType = (t: string) => {
    setExcludedTypes(prev => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  };

  const clearFilters = () => {
    setExcludedTypes(new Set());
    setUserFilter('all');
    setSearchPayload('');
  };

  const jumpToNextAnomaly = () => {
    if (!current) return;
    const currentTs = new Date(current.server_ts).getTime();
    const next = anomalies.find(a => new Date(a.server_ts).getTime() > currentTs);
    if (!next) return;
    const idx = filteredEvents.findIndex(e => e.id === next.id);
    if (idx >= 0) {
      setCursor(idx);
      setPlaying(false);
    }
  };

  const hasActiveFilter = excludedTypes.size > 0 || userFilter !== 'all' || !!searchPayload;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ─── Header ───────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Retour"
            className="rounded-xl border border-border bg-white p-2 text-slate-500 hover:border-primary/40 hover:text-slate-900 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary-dark">
              Plugbet · Game replay
            </p>
            <div className="mt-1 flex items-center gap-2">
              <Gamepad className="h-5 w-5 text-primary-dark" strokeWidth={2.2} />
              <h1 className="hero-number text-xl text-slate-900">
                Replay <span className="text-primary-dark">{events[0].game_type}</span>
              </h1>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400 font-mono">{gameId}</p>
          </div>
        </div>
        {anomalies.length > 0 && (
          <button
            type="button"
            onClick={jumpToNextAnomaly}
            className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-100 transition-colors"
            title="Aller à la prochaine anomalie"
          >
            <AlertTriangle className="h-4 w-4 live-dot" />
            {anomalies.length} anomalie{anomalies.length > 1 ? 's' : ''} →
          </button>
        )}
      </div>

      {/* ─── Stats ─────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Events" value={events.length.toString()} icon={<Activity className="h-4 w-4" />} variant="blue" />
        <Stat label="Durée" value={`${Math.round(totalDuration)}s`} icon={<Clock className="h-4 w-4" />} variant="violet" />
        <Stat label="Joueurs" value={allUsers.length.toString()} icon={<Eye className="h-4 w-4" />} variant="cyan" />
        <Stat label="Mvts financiers" value={movements.length.toString()} icon={<Coins className="h-4 w-4" />} variant="amber" />
      </div>

      {/* ─── Filtres + Controls (option panel) ──────────────── */}
      <div className="exec-card p-5 space-y-4">
        {/* Filtres */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-4 w-4 text-slate-500" />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Filtres</p>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-200"
              >
                <X className="h-3 w-3" />
                Réinitialiser
              </button>
            )}
          </div>

          {/* Filter event types (toggle chips) */}
          <div className="flex flex-wrap gap-1.5">
            {allEventTypes.map(t => {
              const excluded = excludedTypes.has(t);
              const color = eventColors[t] ?? 'bg-slate-100 text-slate-700 border-slate-200';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleEventType(t)}
                  className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all ${
                    excluded
                      ? 'border-slate-200 bg-white text-slate-300 line-through'
                      : color
                  }`}
                  title={excluded ? 'Cliquer pour réafficher' : 'Cliquer pour masquer'}
                >
                  {t}
                </button>
              );
            })}
          </div>

          {/* Filter user + search payload */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="user-filter" className="block mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Filtrer par joueur
              </label>
              <select
                id="user-filter"
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">Tous les joueurs ({allUsers.length})</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.username ?? u.id.slice(0, 8)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="payload-search" className="block mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Rechercher dans payload / state
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  id="payload-search"
                  type="text"
                  value={searchPayload}
                  onChange={e => setSearchPayload(e.target.value)}
                  placeholder="ex: dice=5, pawn=2…"
                  className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 py-2 text-xs text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          {filteredEvents.length !== events.length && (
            <p className="text-[11px] text-slate-500">
              <strong className="text-slate-900">{filteredEvents.length}</strong> / {events.length} events après filtrage
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setCursor(0)} aria-label="Retour au début" title="Début"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:border-primary/40 hover:text-slate-900 transition-colors">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setCursor(c => Math.max(0, c - 1))} disabled={cursor === 0} aria-label="Précédent"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:border-primary/40 hover:text-slate-900 disabled:opacity-30 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause' : 'Lecture'}
              className="rounded-xl bg-primary p-2.5 text-white hover:bg-primary-dark shadow-sm transition-all">
              {playing ? <Pause className="h-4 w-4" strokeWidth={2.5} /> : <Play className="h-4 w-4" strokeWidth={2.5} />}
            </button>
            <button type="button" onClick={() => setCursor(c => Math.min(filteredEvents.length - 1, c + 1))} disabled={cursor >= filteredEvents.length - 1} aria-label="Suivant"
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:border-primary/40 hover:text-slate-900 disabled:opacity-30 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>

            {/* Speed selector (chips) */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <FastForward className="ml-1.5 h-3.5 w-3.5 text-slate-400" />
              {SPEEDS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSpeed(s)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold tabular-nums transition-colors ${
                    speed === s ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>

            {/* Loop */}
            <button
              type="button"
              onClick={() => setLoop(l => !l)}
              aria-label={loop ? 'Désactiver la boucle' : 'Activer la boucle'}
              title="Boucler la lecture"
              className={`rounded-xl border p-2 transition-colors ${
                loop
                  ? 'border-primary bg-primary/10 text-primary-dark'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-primary/40 hover:text-slate-900'
              }`}
            >
              <Repeat className="h-4 w-4" />
            </button>

            <span className="ml-auto display-number text-xs text-slate-500">
              <span className="text-slate-900">{filteredEvents.length > 0 ? cursor + 1 : 0}</span>
              {' / '}
              {filteredEvents.length}
              {' · '}
              {Math.round(elapsed)}s écoulées
            </span>
          </div>

          {/* Slider */}
          <input
            type="range"
            aria-label="Position dans la timeline"
            min={0}
            max={Math.max(0, filteredEvents.length - 1)}
            value={cursor}
            onChange={e => { setCursor(Number(e.target.value)); setPlaying(false); }}
            className="w-full mt-3 accent-primary"
            disabled={filteredEvents.length === 0}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr,2fr]">
        {/* ─── Detail event courant ───────────────────────── */}
        <div className="exec-card p-5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Event courant</p>
          {current ? (
            <>
              <div className={`rounded-lg border px-3 py-1.5 inline-block text-xs font-extrabold uppercase tracking-wider ${eventColors[current.event_type] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>
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
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Payload</p>
                  <pre className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] text-slate-700 overflow-x-auto">
                    {JSON.stringify(current.payload, null, 2)}
                  </pre>
                </div>
              )}
              {current.state_before && (
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">État avant</p>
                  <pre className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] text-slate-700 overflow-x-auto max-h-32">
                    {JSON.stringify(current.state_before, null, 2)}
                  </pre>
                </div>
              )}
              {current.state_after && (
                <div className="mt-3">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">État après</p>
                  <pre className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] text-slate-700 overflow-x-auto max-h-32">
                    {JSON.stringify(current.state_after, null, 2)}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">
              Aucun event ne correspond aux filtres actifs.
            </p>
          )}
        </div>

        {/* ─── Timeline list ──────────────────────────────── */}
        <div className="exec-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
            <p className="text-sm font-bold text-slate-900">Timeline</p>
            <span className="text-[11px] text-slate-500">{filteredEvents.length} events affichés</span>
          </div>
          <div ref={timelineRef} className="max-h-[600px] overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="p-12 text-center">
                <Filter className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Aucun event ne correspond aux filtres.</p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-3 text-xs font-bold text-primary-dark hover:underline"
                >
                  Réinitialiser les filtres
                </button>
              </div>
            ) : (
              filteredEvents.map((e, i) => {
                const isAnomaly = (e.delta_seconds ?? 0) > 60 || (e.clock_drift_seconds ?? 0) > 10;
                const isActive = i === cursor;
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-cursor={i}
                    onClick={() => { setCursor(i); setPlaying(false); }}
                    className={`w-full flex items-start gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${
                      isActive
                        ? 'bg-primary/5 border-l-4 border-l-primary'
                        : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                    }`}>
                    <span className="text-xs font-mono text-slate-400 mt-0.5 w-8 tabular-nums">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border ${eventColors[e.event_type] ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {e.event_type}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 truncate">{e.username ?? '—'}</span>
                        {isAnomaly && <AlertTriangle className="h-3 w-3 text-red-500" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                        {format(new Date(e.server_ts), 'HH:mm:ss.SSS', { locale: fr })}
                        {e.delta_seconds != null && ` · +${e.delta_seconds.toFixed(1)}s`}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ─── Mouvements financiers liés ─────────────────────── */}
      {movements.length > 0 && (
        <div className="exec-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3 flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-bold text-slate-900">Mouvements financiers ({movements.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr className="text-left">
                  <th className="px-4 py-2.5">Heure</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {format(new Date(m.created_at), 'HH:mm:ss', { locale: fr })}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-700 font-semibold">{m.movement_type}</td>
                    <td className="px-4 py-2 text-xs font-mono text-slate-500">
                      {m.user_id ? (
                        <Link to={`/dashboard/users/${m.user_id}`} className="hover:text-primary-dark hover:underline">
                          {m.user_id.slice(0, 8)}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-slate-900 tabular-nums">
                      {m.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Footer ─────────────────────────────────────────── */}
      <div className="text-xs text-slate-500 text-center">
        Replay généré depuis <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-primary-dark">game_events</code>
        {' · '}
        Partie enregistrée {formatDistanceToNow(new Date(events[0].server_ts), { addSuffix: true, locale: fr })}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function Stat({ label, value, icon, variant = 'blue' }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  variant?: 'blue' | 'violet' | 'cyan' | 'amber';
}) {
  const colorMap = {
    blue:   { iconBg: 'bg-blue-100 text-blue-700' },
    violet: { iconBg: 'bg-violet-100 text-violet-700' },
    cyan:   { iconBg: 'bg-cyan-100 text-cyan-700' },
    amber:  { iconBg: 'bg-amber-100 text-amber-700' },
  };
  return (
    <div className="exec-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colorMap[variant].iconBg}`}>{icon}</span>
      </div>
      <p className="hero-number mt-1 text-xl text-slate-900">{value}</p>
    </div>
  );
}

function Row({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 last:border-b-0 py-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`text-xs font-mono tabular-nums ${warning ? 'text-red-600 font-extrabold' : 'text-slate-700 font-semibold'}`}>
        {value}
      </span>
    </div>
  );
}
