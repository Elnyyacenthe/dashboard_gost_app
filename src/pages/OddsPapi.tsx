// ============================================================
// OddsPapi — pilotage de l'intégration marchés foot (admin)
// ============================================================
// Lit/écrit la config (public.oddspapi_config) via les RPC admin
// (admin_oddspapi_overview / _set_config / _alias_upsert / _alias_delete),
// affiche la santé du pipeline dérivé (origin='oddspapi') et gère les
// alias d'équipes pour le matching. Aucune écriture directe en table :
// tout passe par les RPC SECURITY DEFINER gardées par le rôle admin.
//
// Kill-switch : enabled=false -> ingestion+refresh à l'arrêt (le règlement
// continue). auto_activate=false -> shadow (ingère mais non pariable).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Lock, RefreshCw, Radio, Layers, Zap, Gauge, Save,
  Plus, Trash2, Power, PlugZap, Boxes,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import StatsCard from '../components/StatsCard';

interface Config {
  id: number;
  enabled: boolean;
  auto_activate: boolean;
  main_line_only: boolean;
  margin: number | string;
  book_priority: string[];
  grace_hours: number;
  window_hours: number;
  max_fixtures: number;
  updated_at: string | null;
}
interface Health {
  total: number; active: number; matches: number; categories: number;
  last_ingest: string | null; markets_catalog: number;
  fixtures_mapped: number; alias_count: number;
}
interface CoverageRow { category: string | null; group: string | null; rows: number; matches: number; active: number; }
interface AliasRow { oa_norm: string; opapi_norm: string; note: string | null; created_at: string; }
interface Overview { success: boolean; error?: string; config: Config | null; health: Health; coverage: CoverageRow[]; aliases: AliasRow[]; }

const num = (v: number | null | undefined) => Math.round(Number(v ?? 0)).toLocaleString('fr-FR');
const ago = (v: string | null | undefined) => {
  if (!v) return '—';
  try { return formatDistanceToNow(new Date(v), { locale: fr, addSuffix: true }); } catch { return '—'; }
};

// Éditeur local de la config (buffer avant enregistrement).
interface Form {
  enabled: boolean; auto_activate: boolean; main_line_only: boolean;
  margin: string; book_priority: string; grace_hours: string; window_hours: string; max_fixtures: string;
}
const toForm = (c: Config): Form => ({
  enabled: c.enabled, auto_activate: c.auto_activate, main_line_only: c.main_line_only,
  margin: String(c.margin ?? '1.0'),
  book_priority: (c.book_priority ?? []).join(', '),
  grace_hours: String(c.grace_hours ?? 12),
  window_hours: String(c.window_hours ?? 30),
  max_fixtures: String(c.max_fixtures ?? 20),
});

export default function OddsPapi() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Alias
  const [aOa, setAOa] = useState('');
  const [aOpapi, setAOpapi] = useState('');
  const [aNote, setANote] = useState('');
  const [aBusy, setABusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_oddspapi_overview');
    if (error) console.error('oddspapi overview:', error.message);
    const res = data as Overview | null;
    if (res?.success) {
      setOv(res);
      if (res.config) setForm(toForm(res.config));
    } else if (res?.error) {
      setMsg(`Erreur : ${res.error}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const saveConfig = async () => {
    if (!form) return;
    const margin = Number(form.margin.replace(',', '.'));
    if (!Number.isFinite(margin) || margin < 1 || margin > 2) { setMsg('Marge invalide (entre 1.0 et 2.0).'); return; }
    const books = form.book_priority.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (books.length === 0) { setMsg('Au moins un bookmaker requis.'); return; }
    const patch = {
      enabled: form.enabled,
      auto_activate: form.auto_activate,
      main_line_only: form.main_line_only,
      margin,
      book_priority: books,
      grace_hours: Number(form.grace_hours),
      window_hours: Number(form.window_hours),
      max_fixtures: Number(form.max_fixtures),
    };
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_oddspapi_set_config', { p_patch: patch });
    setSaving(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { setMsg(`Échec : ${error?.message ?? res?.error ?? 'inconnu'}`); return; }
    setMsg('Configuration enregistrée.');
    load();
  };

  const upsertAlias = async () => {
    if (!aOa.trim() || !aOpapi.trim()) { setMsg('Nom oa_events ET nom OddsPapi requis.'); return; }
    setABusy(true);
    const { data, error } = await supabase.rpc('admin_oddspapi_alias_upsert', {
      p_oa: aOa, p_opapi: aOpapi, p_note: aNote || null,
    });
    setABusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { setMsg(`Échec alias : ${error?.message ?? res?.error ?? 'inconnu'}`); return; }
    setAOa(''); setAOpapi(''); setANote('');
    setMsg('Alias ajouté.');
    load();
  };

  const deleteAlias = async (oa: string) => {
    setABusy(true);
    const { data, error } = await supabase.rpc('admin_oddspapi_alias_delete', { p_oa: oa });
    setABusy(false);
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) { setMsg(`Échec suppression : ${error?.message ?? res?.error ?? 'inconnu'}`); return; }
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

  const h = ov?.health;
  const c = ov?.config;
  // État lisible du pipeline.
  const mode = !c ? '—'
    : !c.enabled ? 'Arrêté (kill-switch)'
    : c.auto_activate ? 'LIVE (argent réel)'
    : 'Shadow (non pariable)';
  const modeCls = !c ? '' : !c.enabled ? 'text-danger' : c.auto_activate ? 'text-primary-dark' : 'text-amber-700';

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PlugZap className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-text">OddsPapi</h1>
            <p className="text-sm text-text-muted">
              Marchés foot enrichis (buts, combinés, corners, cartons, buteurs). Pilotage du pipeline dérivé.
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

      {loading || !ov || !form ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <>
          {/* KPIs santé */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Marchés actifs" value={num(h?.active)} icon={<Zap className="h-5 w-5" />} variant={c?.auto_activate ? 'green' : 'amber'} />
            <StatsCard title="Matchs couverts" value={num(h?.matches)} icon={<Layers className="h-5 w-5" />} variant="blue" />
            <StatsCard title="Catalogue marchés" value={num(h?.markets_catalog)} icon={<Boxes className="h-5 w-5" />} variant="violet" />
            <StatsCard title="Dernière ingestion" value={ago(h?.last_ingest)} icon={<Gauge className="h-5 w-5" />} variant="cyan" />
          </div>

          {/* Bandeau mode */}
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold ${
            !c?.enabled ? 'border-danger/30 bg-danger/5' : c?.auto_activate ? 'border-primary/30 bg-primary/5' : 'border-warning/30 bg-warning/5'
          }`}>
            <Power className={`h-5 w-5 ${modeCls}`} />
            <span className={modeCls}>Mode : {mode}</span>
            <span className="ml-auto text-xs font-normal text-text-muted">
              Config modifiée {ago(c?.updated_at)} · {num(h?.total)} lignes au total · {num(h?.fixtures_mapped)} fixtures mappées
            </span>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Config */}
            <div className="space-y-4 rounded-2xl border border-border/30 bg-surface-light p-6 lg:col-span-1">
              <h2 className="text-sm font-black text-text">Configuration</h2>

              <Toggle label="Activé (kill-switch)" hint="Off = ingestion & refresh à l'arrêt (le règlement continue)"
                value={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
              <Toggle label="Argent réel (auto_activate)" hint="Off = shadow (ingère mais non pariable)"
                value={form.auto_activate} onChange={(v) => setForm({ ...form, auto_activate: v })} danger />
              <Toggle label="Lignes principales seulement" hint="Ne garder que la mainLine par marché"
                value={form.main_line_only} onChange={(v) => setForm({ ...form, main_line_only: v })} />

              <NumField label="Marge maison" value={form.margin} onChange={(v) => setForm({ ...form, margin: v })} hint="1.0 = cotes book brutes · max 2.0" />
              <TextField label="Bookmakers (priorité)" value={form.book_priority} onChange={(v) => setForm({ ...form, book_priority: v })} hint="séparés par des virgules, ex. 1xbet, pinnacle" />
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Grâce (h)" value={form.grace_hours} onChange={(v) => setForm({ ...form, grace_hours: v })} />
                <NumField label="Fenêtre (h)" value={form.window_hours} onChange={(v) => setForm({ ...form, window_hours: v })} />
                <NumField label="Max fixtures" value={form.max_fixtures} onChange={(v) => setForm({ ...form, max_fixtures: v })} />
              </div>

              <button
                onClick={saveConfig}
                disabled={saving}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
              </button>
            </div>

            {/* Couverture */}
            <div className="rounded-2xl border border-border/30 bg-surface-light p-6 lg:col-span-2">
              <h2 className="mb-4 text-sm font-black text-text">Couverture par marché ({num(h?.categories)} catégories)</h2>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-light text-left text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Catégorie</th>
                      <th className="px-3 py-2 font-semibold">Marché</th>
                      <th className="px-3 py-2 font-semibold text-right">Lignes</th>
                      <th className="px-3 py-2 font-semibold text-right">Matchs</th>
                      <th className="px-3 py-2 font-semibold text-right">Actives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ov.coverage.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-text-muted">Aucun marché ingéré pour l'instant.</td></tr>
                    ) : ov.coverage.map((r, i) => (
                      <tr key={i} className="border-t border-border/20">
                        <td className="px-3 py-2 font-semibold text-text">{r.category ?? '—'}</td>
                        <td className="px-3 py-2 text-text-muted">{r.group ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(r.rows)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(r.matches)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.active > 0 ? <span className="font-bold text-primary-dark">{num(r.active)}</span> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Alias d'équipes */}
          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            <div className="mb-4 flex items-center gap-2">
              <Radio className="h-4 w-4 text-text-muted" />
              <h2 className="text-sm font-black text-text">Alias d'équipes ({num(h?.alias_count)})</h2>
              <span className="text-xs text-text-muted">— corrige les cas où le matching automatique échoue (noms normalisés en minuscules)</span>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input value={aOa} onChange={(e) => setAOa(e.target.value)} placeholder="Nom oa_events (normalisé)"
                className="rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
              <input value={aOpapi} onChange={(e) => setAOpapi(e.target.value)} placeholder="Nom OddsPapi (normalisé)"
                className="rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
              <input value={aNote} onChange={(e) => setANote(e.target.value)} placeholder="Note (optionnel)"
                className="rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
              <button onClick={upsertAlias} disabled={aBusy}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50">
                {aBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/40">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2">oa_events</th>
                    <th className="px-3 py-2">OddsPapi</th>
                    <th className="px-3 py-2">Note</th>
                    <th className="px-3 py-2">Ajouté</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.aliases.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-text-muted">Aucun alias.</td></tr>
                  ) : ov.aliases.map((a) => (
                    <tr key={a.oa_norm} className="border-t border-border/20">
                      <td className="px-3 py-2 font-semibold text-text">{a.oa_norm}</td>
                      <td className="px-3 py-2 text-text">{a.opapi_norm}</td>
                      <td className="px-3 py-2 text-text-muted">{a.note ?? '—'}</td>
                      <td className="px-3 py-2 text-text-muted">{ago(a.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => deleteAlias(a.oa_norm)} disabled={aBusy}
                          className="rounded-lg bg-danger/10 p-1.5 text-danger hover:bg-danger/20 disabled:opacity-50" title="Supprimer">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            Le règlement des paris OddsPapi passe par <b>/v4/settlements</b> (grader séparé, partitionné du moteur buts).
            Les marchés terminés jamais réglés sont remboursés après la fenêtre de <b>grâce</b>.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Petits contrôles locaux ────────────────────────────────
function Toggle({ label, hint, value, onChange, danger }: {
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean;
}) {
  const on = danger ? 'bg-danger' : 'bg-primary';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">{label}</p>
        {hint && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? on : 'bg-border'}`}
        aria-pressed={value}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string; }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
      />
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

function TextField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string; }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border/60 bg-surface px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
      />
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}
