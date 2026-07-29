// ============================================================
// OddsMonitor — supervision de l'ingestion The Odds API (admin)
// ============================================================
// Conso quota (odds_api_usage) + couverture (oa_events par sport) +
// fraîcheur des crons d'ingestion + marchés dérivés actifs.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, RefreshCw, Radio, Layers, Zap, Gauge } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import StatsCard from '../components/StatsCard';

interface Overview {
  success: boolean;
  quota: { requests_remaining: number | null; requests_used: number | null; updated_at: string | null } | null;
  coverage: { sport: string; events: number; leagues: number; live: number }[];
  totals: { events: number; leagues: number; live: number; last_odds: string | null; last_scores: string | null };
  derived: { active: number; matches: number };
}

const SPORT_LABEL: Record<string, string> = {
  soccer: 'Football', basketball: 'Basketball', americanfootball: 'Football US',
  baseball: 'Baseball', tennis: 'Tennis', icehockey: 'Hockey', rugby: 'Rugby', handball: 'Handball',
};
const num = (v: number | null | undefined) => Math.round(Number(v ?? 0)).toLocaleString('fr-FR');
const ago = (v: string | null | undefined) => {
  if (!v) return '—';
  try { return formatDistanceToNow(new Date(v), { locale: fr, addSuffix: true }); } catch { return '—'; }
};

export default function OddsMonitor() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await supabase.rpc('admin_odds_overview');
    if (error) console.error('odds overview:', error.message);
    if (res) setData(res as Overview);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Section réservée aux administrateurs.</p>
        </div>
      </div>
    );
  }

  const remaining = data?.quota?.requests_remaining ?? null;
  const lowQuota = remaining != null && remaining < 50000;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Ingestion Odds</h1>
          <p className="text-sm text-text-muted">Couverture multi-sports & consommation de l'API The Odds.</p>
        </div>
        <button onClick={load} className="btn-ghost inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </button>
      </div>

      {loading || !data ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Quota restant" value={num(remaining)} icon={<Gauge className="h-5 w-5" />} variant={lowQuota ? 'rose' : 'green'} />
            <StatsCard title="Matchs (tous sports)" value={num(data.totals.events)} icon={<Layers className="h-5 w-5" />} variant="blue" />
            <StatsCard title="En direct" value={num(data.totals.live)} icon={<Radio className="h-5 w-5" />} variant="rose" />
            <StatsCard title="Marchés dérivés actifs" value={num(data.derived.active)} icon={<Zap className="h-5 w-5" />} variant="violet" />
          </div>

          {lowQuota && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">
              ⚠️ Quota The Odds API faible ({num(remaining)} requêtes restantes). Pense à recharger le plan.
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Couverture par sport */}
            <div className="rounded-2xl border border-border/30 bg-surface-light p-6 lg:col-span-2">
              <h2 className="mb-4 text-sm font-black text-text">Couverture par sport</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-lighter/50 text-left text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Sport</th>
                      <th className="px-3 py-2 font-semibold text-right">Matchs</th>
                      <th className="px-3 py-2 font-semibold text-right">Championnats</th>
                      <th className="px-3 py-2 font-semibold text-right">En direct</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.coverage.map((c) => (
                      <tr key={c.sport} className="border-t border-border/20">
                        <td className="px-3 py-2 font-semibold text-text">{SPORT_LABEL[c.sport] ?? c.sport}</td>
                        <td className="px-3 py-2 text-right">{num(c.events)}</td>
                        <td className="px-3 py-2 text-right">{num(c.leagues)}</td>
                        <td className="px-3 py-2 text-right">{c.live > 0 ? <span className="font-bold text-danger">{num(c.live)}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Santé / fraîcheur */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
                <h2 className="mb-3 text-sm font-black text-text">Fraîcheur</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><span className="text-text-muted">Cotes (odds)</span><span className="font-semibold text-text">{ago(data.totals.last_odds)}</span></li>
                  <li className="flex justify-between"><span className="text-text-muted">Scores (live)</span><span className="font-semibold text-text">{ago(data.totals.last_scores)}</span></li>
                  <li className="flex justify-between"><span className="text-text-muted">Championnats</span><span className="font-semibold text-text">{num(data.totals.leagues)}</span></li>
                  <li className="flex justify-between"><span className="text-text-muted">Dérivés (matchs)</span><span className="font-semibold text-text">{num(data.derived.matches)}</span></li>
                </ul>
              </div>
              <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
                <h2 className="mb-3 text-sm font-black text-text">Quota The Odds API</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex justify-between"><span className="text-text-muted">Restant</span><span className={`font-semibold ${lowQuota ? 'text-danger' : 'text-primary-dark'}`}>{num(remaining)}</span></li>
                  <li className="flex justify-between"><span className="text-text-muted">Utilisé</span><span className="font-semibold text-text">{num(data.quota?.requests_used)}</span></li>
                  <li className="flex justify-between"><span className="text-text-muted">Mesuré</span><span className="font-semibold text-text">{ago(data.quota?.updated_at)}</span></li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
