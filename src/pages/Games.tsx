import { useState, useEffect, useCallback } from 'react';
import {
  Gamepad2, Trophy, TrendingUp, Users, RefreshCw, Coins,
  ArrowDownCircle, ArrowUpCircle, SlidersHorizontal, Save, Loader2,
} from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface MovementRow {
  game_type: string;
  user_id: string | null;
  movement_type: string;
  amount: number;
  game_id: string | null;
  pot_total: number | null;
  created_at: string;
}

interface GameStat {
  game_type: string;
  label: string;
  emoji: string;
  rounds: number;          // nombre de game_id distincts
  unique_players: number;  // user_id distincts
  bets_in: number;
  payouts_out: number;
  refunds: number;
  house_cut: number;
  net_profit: number;
}

const GAMES_META: Record<string, { label: string; emoji: string }> = {
  aviator:       { label: 'Aviator',         emoji: '✈️' },
  apple_fortune: { label: 'Apple Fortune',   emoji: '🍏' },
  mines:         { label: 'Mines',           emoji: '💣' },
  solitaire:     { label: 'Solitaire',       emoji: '🃏' },
  coinflip:      { label: 'Pile ou Face',    emoji: '🪙' },
  cora_dice:     { label: 'Cora Dice',       emoji: '🎲' },
  checkers:      { label: 'Dames',           emoji: '♟️' },
  blackjack:     { label: 'Blackjack',       emoji: '🂡' },
  roulette:      { label: 'Roulette',        emoji: '🎯' },
  ludo_v2:       { label: 'Ludo',            emoji: '🎮' },
  fantasy:       { label: 'Fantasy League',  emoji: '⚽' },
  penalty:       { label: 'Tirs au but',     emoji: '🥅' },
  slots_777:     { label: 'Big Win 777',     emoji: '🎰' },
  wheel:         { label: 'Plugbet Wheel',   emoji: '🎡' },
  sports:        { label: 'Paris sportifs',  emoji: '🏆' },
  virtual:       { label: 'Paris virtuels',  emoji: '🤖' },
};

export default function GamesPage() {
  const [stats, setStats] = useState<GameStat[]>([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [{ count: usersCount }, { data: movements }] = await Promise.all([
        supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
        supabase.from('treasury_movements').select('*').limit(50000),
      ]);

      setTotalPlayers(usersCount ?? 0);

      // Aggregation par game_type
      const map = new Map<string, {
        gameIds: Set<string>;
        playerIds: Set<string>;
        bets_in: number;
        payouts_out: number;
        refunds: number;
        house_cut: number;
      }>();

      const ms = (movements ?? []) as MovementRow[];
      for (const m of ms) {
        if (!m.game_type || m.game_type === 'system') continue;
        if (!map.has(m.game_type)) {
          map.set(m.game_type, {
            gameIds: new Set(), playerIds: new Set(),
            bets_in: 0, payouts_out: 0, refunds: 0, house_cut: 0,
          });
        }
        const e = map.get(m.game_type)!;
        if (m.game_id) e.gameIds.add(m.game_id);
        if (m.user_id) e.playerIds.add(m.user_id);
        switch (m.movement_type) {
          case 'loss_collect': e.bets_in += m.amount; break;
          case 'payout': e.payouts_out += m.amount; break;
          case 'refund': e.refunds += m.amount; break;
          case 'house_cut': e.house_cut += m.amount; break;
        }
      }

      // Construire le tableau (inclure tous les jeux connus, même sans data)
      const out: GameStat[] = Object.keys(GAMES_META).map(gt => {
        const e = map.get(gt);
        const meta = GAMES_META[gt];
        if (!e) {
          return {
            game_type: gt, label: meta.label, emoji: meta.emoji,
            rounds: 0, unique_players: 0,
            bets_in: 0, payouts_out: 0, refunds: 0, house_cut: 0, net_profit: 0,
          };
        }
        return {
          game_type: gt, label: meta.label, emoji: meta.emoji,
          rounds: e.gameIds.size,
          unique_players: e.playerIds.size,
          bets_in: e.bets_in,
          payouts_out: e.payouts_out,
          refunds: e.refunds,
          house_cut: e.house_cut,
          net_profit: e.bets_in - e.payouts_out - e.refunds,
        };
      });

      out.sort((a, b) => b.rounds - a.rounds);
      setStats(out);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── Stats globales ──
  const totalRounds = stats.reduce((s, g) => s + g.rounds, 0);
  const totalBetsIn = stats.reduce((s, g) => s + g.bets_in, 0);
  const totalProfit = stats.reduce((s, g) => s + g.net_profit, 0);
  const totalActivePlayers = (() => {
    const all = new Set<string>();
    stats.forEach(g => {
      // approximation : on peut pas re-reduce l'union sans recalcul ;
      // on reflète juste max(unique_players) et le delta vient du global ailleurs.
      // Pour exact, faudrait stocker la union dans state. Trade-off acceptable.
      g.unique_players;
    });
    return all.size || stats.reduce((s, g) => Math.max(s, g.unique_players), 0);
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Statistiques par jeu</h1>
          <p className="text-sm text-text-muted">
            Données extraites de <code className="text-xs">treasury_movements</code> — temps réel
          </p>
        </div>
        <button onClick={fetchStats}
          className="flex items-center gap-2 rounded-xl border border-border/30 px-4 py-2 text-sm text-text-muted transition-colors hover:bg-surface-lighter hover:text-text">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
      </div>

      {/* Contrôle RTP / avantage maison */}
      <RtpControlPanel />

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Stats globales */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Total joueurs inscrits"
              value={totalPlayers.toLocaleString()}
              icon={<Users className="h-5 w-5" />}
              accent
            />
            <StatsCard
              title="Total parties (rounds)"
              value={totalRounds.toLocaleString()}
              icon={<Gamepad2 className="h-5 w-5" />}
              change={totalActivePlayers > 0 ? `${totalActivePlayers} joueurs actifs (estim.)` : ''}
              changeType="neutral"
            />
            <StatsCard
              title="Coins misés (cumul)"
              value={totalBetsIn.toLocaleString()}
              icon={<TrendingUp className="h-5 w-5" />}
            />
            <StatsCard
              title="Profit net global"
              value={totalProfit.toLocaleString()}
              icon={<Trophy className="h-5 w-5" />}
              change={totalBetsIn > 0 ? `${((totalProfit / totalBetsIn) * 100).toFixed(1)}% RTP inverse` : ''}
              changeType={totalProfit >= 0 ? 'up' : 'down'}
            />
          </div>

          {/* Cartes par jeu */}
          <div>
            <h2 className="mb-4 text-lg font-bold text-text">Détail par jeu</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {stats.map((s) => {
                const isActive = s.rounds > 0;
                return (
                  <div
                    key={s.game_type}
                    className={`rounded-2xl border p-5 transition-colors ${
                      isActive
                        ? 'border-border/30 bg-surface-light'
                        : 'border-border/10 bg-surface-light/30 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-2xl">{s.emoji}</span>
                      <div>
                        <h3 className="font-bold text-text">{s.label}</h3>
                        <p className="text-[10px] text-text-muted font-mono">{s.game_type}</p>
                      </div>
                      {!isActive && (
                        <span className="ml-auto rounded-full bg-text-muted/15 px-2 py-0.5 text-[10px] font-bold uppercase text-text-muted">
                          Aucune partie
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Parties jouées</span>
                        <span className="font-semibold text-text">{s.rounds.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-muted">Joueurs uniques</span>
                        <span className="font-semibold text-primary">{s.unique_players}</span>
                      </div>
                      <div className="border-t border-border/20 pt-2 mt-2 space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted flex items-center gap-1">
                            <ArrowDownCircle className="h-3 w-3 text-success" /> Mises encaissées
                          </span>
                          <span className="font-semibold text-success">+{s.bets_in.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted flex items-center gap-1">
                            <ArrowUpCircle className="h-3 w-3 text-info" /> Gains payés
                          </span>
                          <span className="font-semibold text-info">−{s.payouts_out.toLocaleString()}</span>
                        </div>
                        {s.refunds > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-text-muted">Refunds (matchs nuls)</span>
                            <span className="font-semibold text-text-muted">−{s.refunds.toLocaleString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted">Commission 10%</span>
                          <span className="font-semibold text-warning">+{s.house_cut.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex justify-between text-sm pt-2 border-t border-border/20">
                        <span className="text-text-muted flex items-center gap-1">
                          <Coins className="h-3.5 w-3.5" /> Profit net
                        </span>
                        <span className={`font-bold ${s.net_profit >= 0 ? 'text-success' : 'text-danger'}`}>
                          {s.net_profit >= 0 ? '+' : ''}{s.net_profit.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Note pour stats joueur×jeu */}
          <div className="rounded-xl border border-info/30 bg-info/5 p-4 text-sm text-text-muted">
            <p>
              💡 Pour voir <strong>les statistiques par joueur sur un jeu spécifique</strong>,
              ouvre la fiche d'un joueur sur la page <strong>Utilisateurs</strong>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//  Contrôle RTP / avantage maison (house_edge_config)
// ============================================================
interface EdgeRow {
  game_type: string;
  edge_pct: number;   // 0..0.90 (part maison)
  rtp: number;        // 1 - edge
  enabled: boolean;
  description: string | null;
}

const EDGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(GAMES_META).map(([k, v]) => [k, `${v.emoji} ${v.label}`])),
  aviator_distribution: '✈️ Aviator — générosité (distribution de crash)',
};

function RtpControlPanel() {
  const [rows, setRows] = useState<EdgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});   // game_type -> RTP % en saisie
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('admin_list_house_edge');
    if (err) { setError(err.message); setLoading(false); return; }
    if (data?.success === false) {
      if (data.error === 'NOT_ADMIN') setDenied(true); else setError(data.error);
      setLoading(false);
      return;
    }
    const games: EdgeRow[] = data?.games ?? [];
    setRows(games);
    setDraft(Object.fromEntries(games.map((g) => [g.game_type, (g.rtp * 100).toFixed(1)])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (gt: string) => {
    const rtpPct = Number((draft[gt] ?? '').replace(',', '.'));
    if (!Number.isFinite(rtpPct) || rtpPct < 10 || rtpPct > 100) {
      setError(`RTP invalide pour ${gt} (attendu 10 à 100 %).`);
      return;
    }
    setSavingKey(gt);
    setError(null);
    const edge = Math.round((1 - rtpPct / 100) * 10000) / 10000;
    const { data, error: err } = await supabase.rpc('admin_set_house_edge', {
      p_game_type: gt, p_edge_pct: edge,
    });
    if (err || data?.success === false) {
      setError(err?.message ?? data?.error ?? 'Erreur');
    } else {
      await load();
    }
    setSavingKey(null);
  };

  if (denied) return null;   // écran réservé aux admins ayant la permission

  return (
    <div className="rounded-2xl border border-border/30 bg-surface-light p-5">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-text">Contrôle RTP / avantage maison</h2>
      </div>
      <p className="mb-4 text-xs text-text-muted">
        RTP = part reversée aux joueurs (100 % = aucun avantage maison). S'applique aux <b>parties futures</b>.
        Couvre les jeux passant par <code>apply_game_payout</code> + la générosité d'Aviator.
      </p>

      {error && <p className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{error}</p>}

      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const label = EDGE_LABELS[r.game_type] ?? r.game_type;
            const dirty = (draft[r.game_type] ?? '') !== (r.rtp * 100).toFixed(1);
            return (
              <div key={r.game_type} className="rounded-xl border border-border/20 bg-surface p-3">
                <p className="mb-2 truncate text-sm font-semibold text-text" title={r.game_type}>{label}</p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input type="number" min="10" max="100" step="0.5"
                      value={draft[r.game_type] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [r.game_type]: e.target.value }))}
                      className="w-full rounded-lg border border-border/30 bg-surface-light px-3 py-2 pr-7 text-sm font-bold text-text focus:border-primary focus:outline-none" />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-muted">%</span>
                  </div>
                  <button onClick={() => save(r.game_type)} disabled={!dirty || savingKey === r.game_type}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                    {savingKey === r.game_type ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    RTP
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-text-muted">
                  Avantage maison : <b>{(r.edge_pct * 100).toFixed(1)} %</b>
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
