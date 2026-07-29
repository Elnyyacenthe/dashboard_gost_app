// ============================================================
// FxRates — taux de change (admin)
// ============================================================
// Lecture de la table fx_rates (1 XAF -> devise) et override manuel via la RPC
// admin_set_fx_rate. Les taux 'auto' sont rafraîchis chaque jour par l'edge
// function refresh_fx_rates ; 'peg' = fixe (XAF/XOF/EUR, Franc CFA arrimé à
// l'euro) ; 'manual' = valeur forcée ici. L'app joueur (affichage multi-devises)
// et le portail affilié (USD) lisent cette table.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, RefreshCw, Coins, Check, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface FxRow {
  quote: string;
  rate_per_xaf: number;
  decimals: number;
  symbol: string | null;
  source: string;
  updated_at: string | null;
}

const ago = (v: string | null | undefined) => {
  if (!v) return '—';
  try { return formatDistanceToNow(new Date(v), { locale: fr, addSuffix: true }); } catch { return '—'; }
};

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  peg: { label: 'Fixe (peg)', cls: 'bg-info/10 text-info border-info/30' },
  auto: { label: 'Auto (quotidien)', cls: 'bg-primary/10 text-primary border-primary/30' },
  manual: { label: 'Manuel', cls: 'bg-warning/10 text-amber-700 border-warning/30' },
};

export default function FxRates() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<FxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('fx_rates')
      .select('quote, rate_per_xaf, decimals, symbol, source, updated_at')
      .order('quote');
    if (error) console.error('fx_rates:', error.message);
    if (data) setRows(data as FxRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const startEdit = (r: FxRow) => { setEditing(r.quote); setDraft(String(r.rate_per_xaf)); setMsg(null); };
  const cancel = () => { setEditing(null); setDraft(''); };

  const save = async (quote: string) => {
    const rate = Number(draft);
    if (!Number.isFinite(rate) || rate <= 0) { setMsg('Taux invalide.'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_set_fx_rate', { p_quote: quote, p_rate: rate });
    setSaving(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { setMsg(`Échec : ${error?.message ?? res?.error ?? 'inconnu'}`); return; }
    setMsg(`${quote} mis à jour.`);
    setEditing(null);
    load();
  };

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Coins className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-text">Taux de change</h1>
            <p className="text-sm text-text-muted">
              Base FCFA (XAF). L'app joueur et le portail affilié convertissent l'affichage avec ces taux.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-surface-light px-3 py-2 text-sm font-medium text-text hover:bg-surface"
        >
          <RefreshCw className="h-4 w-4" /> Rafraîchir
        </button>
      </div>

      {msg && (
        <p className="rounded-xl border border-border/60 bg-surface-light px-4 py-2 text-sm font-medium text-text">{msg}</p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-surface-light text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3">Devise</th>
              <th className="px-4 py-3">1 FCFA =</th>
              <th className="px-4 py-3">1 unité =</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Mise à jour</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /></td></tr>
            ) : rows.map((r) => {
              const meta = SOURCE_META[r.source] ?? { label: r.source, cls: 'bg-surface text-text-muted border-border/60' };
              const inXaf = r.rate_per_xaf > 0 ? (1 / r.rate_per_xaf) : 0;
              const isEditing = editing === r.quote;
              return (
                <tr key={r.quote} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3 font-bold text-text">
                    {r.quote} <span className="text-text-muted">{r.symbol ?? ''}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="w-32 rounded-lg border border-primary/50 bg-surface-light px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <>{r.quote} {r.rate_per_xaf}</>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-muted">
                    {inXaf ? `${inXaf.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} FCFA` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{ago(r.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="inline-flex items-center gap-1">
                        <button disabled={saving} onClick={() => save(r.quote)} className="rounded-lg bg-primary/10 p-1.5 text-primary hover:bg-primary/20 disabled:opacity-50" title="Enregistrer">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={cancel} className="rounded-lg bg-surface p-1.5 text-text-muted hover:bg-surface-light" title="Annuler">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(r)} className="text-xs font-semibold text-primary hover:underline">
                        Modifier
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        Modifier un taux le passe en <b>Manuel</b> (il ne sera plus écrasé par le rafraîchissement automatique quotidien).
        Le Franc CFA (XAF/XOF) et l'euro (EUR) sont arrimés (peg) et ne devraient pas être modifiés.
      </p>
    </div>
  );
}
