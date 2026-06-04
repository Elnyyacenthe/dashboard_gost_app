// ============================================================
// NetworkHealth.tsx — Telemetrie reseau (P4 audit)
// ============================================================
// Source : view public.network_events_daily_v + table network_events
// Mesure l'impact reel des coupures reseau sur les jeux multijoueurs.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import StatsCard from '../components/StatsCard';
import { supabase } from '../lib/supabaseClient';

interface DailyRow {
  day: string;          // YYYY-MM-DD
  label: string;        // action label, eg 'bj_hit'
  outcome: 'recovered' | 'failed';
  events: number;
  users: number;
  avg_retries: number;
  max_retries: number;
}

const LABEL_FRIENDLY: Record<string, string> = {
  bj_hit: 'Blackjack — Tirer',
  bj_stand: 'Blackjack — Rester',
  cf_choose_side: 'Pile/Face — Choix',
  cora_submit_roll: 'Cora — Lancer',
  ludo_roll: 'Ludo — Dé',
  ludo_move: 'Ludo — Coup',
  checkers_move: 'Dames — Coup',
};

export default function NetworkHealthPage() {
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<7 | 14 | 30>(14);
  const [missing, setMissing] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const from = new Date(Date.now() - days * 24 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from('network_events_daily_v')
        .select('*')
        .gte('day', from)
        .order('day', { ascending: false })
        .limit(2000);
      if (error) {
        // View pas deployee
        if (
          error.message.includes('does not exist') ||
          error.message.includes('relation') ||
          error.code === 'PGRST205'
        ) {
          setMissing(true);
          setRows([]);
        } else {
          console.error(error);
        }
      } else {
        setRows((data ?? []) as DailyRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetch(); }, [fetch]);

  // ── Agregats ─────────────────────────────────────────────
  const stats = useMemo(() => {
    let recovered = 0;
    let failed = 0;
    let totalRetries = 0;
    let maxRetries = 0;
    const affectedUsers = new Set<string>();
    const perLabel = new Map<string, { events: number; failed: number; recovered: number; users: number }>();

    for (const r of rows) {
      const e = perLabel.get(r.label) ?? { events: 0, failed: 0, recovered: 0, users: 0 };
      e.events += r.events;
      e.users = Math.max(e.users, r.users);
      if (r.outcome === 'recovered') {
        recovered += r.events;
        e.recovered += r.events;
      } else {
        failed += r.events;
        e.failed += r.events;
      }
      totalRetries += r.avg_retries * r.events;
      if (r.max_retries > maxRetries) maxRetries = r.max_retries;
      perLabel.set(r.label, e);
      // affectedUsers est approxime (max() sur la vue, pas distinct)
      affectedUsers.add(`${r.label}:${r.users}`);
    }
    const total = recovered + failed;
    const successRate = total > 0 ? (recovered / total) * 100 : 100;
    const avgRetries = total > 0 ? totalRetries / total : 0;

    const labels = Array.from(perLabel.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.events - a.events);

    return { recovered, failed, total, successRate, avgRetries, maxRetries, labels };
  }, [rows]);

  // ── Group par jour ───────────────────────────────────────
  const byDay = useMemo(() => {
    const m = new Map<string, { recovered: number; failed: number }>();
    for (const r of rows) {
      const key = r.day.slice(0, 10);
      const e = m.get(key) ?? { recovered: 0, failed: 0 };
      if (r.outcome === 'recovered') e.recovered += r.events;
      else e.failed += r.events;
      m.set(key, e);
    }
    return Array.from(m.entries())
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [rows]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">📡 Télémétrie réseau</h1>
          <p className="text-sm text-text-muted">
            Suivi des actions multijoueurs qui ont dû être réessayées · Source <code className="text-xs">network_events_daily_v</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 14, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                days === d ? 'bg-primary text-white' : 'bg-surface-lighter text-text-muted hover:bg-surface'
              }`}
            >
              {d}j
            </button>
          ))}
          <button onClick={fetch} className="flex items-center gap-2 rounded-xl border border-border/30 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-lighter">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {missing ? (
        <div className="exec-card border-l-4 border-amber-500 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-700">Migration SQL P4 non exécutée</p>
              <p className="text-sm text-text-muted mt-1">
                La view <code>network_events_daily_v</code> n'existe pas. Pour activer la télémétrie :
              </p>
              <pre className="mt-2 rounded bg-surface-lighter p-2 text-xs">supabase/migrations/network_telemetry.sql</pre>
              <p className="text-xs text-text-muted mt-2">
                Exécute ce fichier dans Supabase SQL Editor. Une fois fait, les actions de jeu qui retry seront tracées et affichées ici.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Actions reessayees"
              value={stats.total.toLocaleString()}
              icon={<Activity className="h-5 w-5" />}
              variant="blue"
              change={`${stats.avgRetries.toFixed(1)} retries en moyenne`}
            />
            <StatsCard
              title="Récupérées"
              value={stats.recovered.toLocaleString()}
              icon={<CheckCircle2 className="h-5 w-5" />}
              variant="green"
              change={`${stats.successRate.toFixed(1)}% de succès`}
              changeType={stats.successRate > 90 ? 'up' : stats.successRate < 70 ? 'down' : 'neutral'}
            />
            <StatsCard
              title="Échouées définitivement"
              value={stats.failed.toLocaleString()}
              icon={<AlertTriangle className="h-5 w-5" />}
              variant={stats.failed > 0 ? 'rose' : 'green'}
              change={stats.failed === 0 ? 'aucun échec dur' : 'à investiguer'}
              changeType={stats.failed === 0 ? 'up' : 'down'}
            />
            <StatsCard
              title="Pic de retries"
              value={stats.maxRetries}
              icon={<Users className="h-5 w-5" />}
              variant="amber"
              change="max constaté sur la période"
            />
          </div>

          {/* Par action */}
          <div className="exec-card p-5">
            <h2 className="mb-3 text-lg font-bold text-text">Par action de jeu</h2>
            {stats.labels.length === 0 ? (
              <p className="text-sm text-text-muted">
                Aucun retry enregistré sur la période. Soit le réseau est parfait, soit la télémétrie n'est pas encore arrivée chez tes utilisateurs.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30 text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="py-2 text-left">Action</th>
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">Récupérées</th>
                      <th className="py-2 text-right">Échouées</th>
                      <th className="py-2 text-right">Joueurs (max/jour)</th>
                      <th className="py-2 text-right">Taux</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.labels.map(l => {
                      const rate = l.events > 0 ? (l.recovered / l.events) * 100 : 0;
                      return (
                        <tr key={l.label} className="border-b border-border/10 last:border-0">
                          <td className="py-2 font-semibold">{LABEL_FRIENDLY[l.label] ?? l.label}</td>
                          <td className="py-2 text-right">{l.events.toLocaleString()}</td>
                          <td className="py-2 text-right text-emerald-600">{l.recovered.toLocaleString()}</td>
                          <td className={`py-2 text-right font-bold ${l.failed > 0 ? 'text-rose-600' : 'text-text-muted'}`}>
                            {l.failed.toLocaleString()}
                          </td>
                          <td className="py-2 text-right">{l.users}</td>
                          <td className="py-2 text-right">
                            <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                              rate >= 90 ? 'bg-emerald-100 text-emerald-700' :
                              rate >= 70 ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {rate.toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Par jour */}
          <div className="exec-card p-5">
            <h2 className="mb-3 text-lg font-bold text-text">Évolution jour par jour</h2>
            {byDay.length === 0 ? (
              <p className="text-sm text-text-muted">Aucune donnée sur la période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30 text-xs uppercase tracking-wider text-text-muted">
                    <tr>
                      <th className="py-2 text-left">Jour</th>
                      <th className="py-2 text-right">Récupérées</th>
                      <th className="py-2 text-right">Échouées</th>
                      <th className="py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay.map(d => (
                      <tr key={d.day} className="border-b border-border/10 last:border-0">
                        <td className="py-2 font-mono text-xs">{d.day}</td>
                        <td className="py-2 text-right text-emerald-600">{d.recovered.toLocaleString()}</td>
                        <td className={`py-2 text-right font-bold ${d.failed > 0 ? 'text-rose-600' : 'text-text-muted'}`}>
                          {d.failed.toLocaleString()}
                        </td>
                        <td className="py-2 text-right">{(d.recovered + d.failed).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
