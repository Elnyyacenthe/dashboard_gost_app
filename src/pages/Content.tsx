// ============================================================
// Content — CMS (promotions / affiches / couvertures de jeux)
// ============================================================
// Pilote le contenu visuel de l'app SANS rebuild : promotions (visibilité,
// contenu, image, placements) via la table app_promos, et couvertures de
// jeux via game_cover_overrides. Écriture gardée par RLS (is_admin). Images
// uploadées dans le bucket Storage public `cms`.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Lock, Megaphone, Image as ImageIcon, Plus, Trash2, Eye, EyeOff,
  Upload, Save, Star,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface PromoRow {
  id: string;
  title: string;
  description: string;
  image_url: string;
  banner_url: string | null;
  badge_label: string | null;
  action_label: string | null;
  highlighted_reward: string | null;
  long_description: string | null;
  destination_route: string | null;
  conditions: string[];
  end_date: string | null;
  is_grand_prix: boolean;
  placements: string[];
  sort_order: number;
  is_visible: boolean;
}

interface CoverRow {
  game_id: string;
  image_url: string;
  is_active: boolean;
  updated_at: string;
}

const ALL_PLACEMENTS: { key: string; label: string }[] = [
  { key: 'promotions', label: 'Écran Promotions' },
  { key: 'games_tab', label: 'Onglet Jeux' },
  { key: 'betting_tab', label: 'Onglet Paris' },
  { key: 'carousel', label: 'Carousel principal' },
];

const emptyPromo = (): PromoRow => ({
  id: '', title: '', description: '', image_url: '', banner_url: null,
  badge_label: null, action_label: 'EN SAVOIR PLUS', highlighted_reward: null,
  long_description: null, destination_route: null, conditions: [], end_date: null,
  is_grand_prix: false, placements: ['promotions', 'games_tab', 'betting_tab'],
  sort_order: 100, is_visible: true,
});

async function uploadToCms(folder: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from('cms').upload(path, file, { upsert: false });
  if (up.error) throw new Error(up.error.message);
  return supabase.storage.from('cms').getPublicUrl(path).data.publicUrl;
}

export default function Content() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<'promos' | 'covers'>('promos');

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
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Contenu (CMS)</h1>
        <p className="text-sm text-text-muted">Promotions, affiches et couvertures — sans mise à jour de l'app.</p>
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-border/30 bg-surface p-1">
        {([
          { key: 'promos', label: 'Promotions', icon: Megaphone },
          { key: 'covers', label: 'Couvertures de jeux', icon: ImageIcon },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-bold transition ${
              tab === t.key ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
            }`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'promos' ? <PromosTab /> : <CoversTab />}
    </div>
  );
}

// ── Onglet Promotions ────────────────────────────────────────
function PromosTab() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from('app_promos').select('*').order('sort_order');
    if (err) setError(err.message);
    else setRows((data ?? []) as PromoRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleVisible = async (p: PromoRow) => {
    const { error: err } = await supabase.from('app_promos').update({ is_visible: !p.is_visible }).eq('id', p.id);
    if (err) setError(err.message); else load();
  };
  const remove = async (p: PromoRow) => {
    if (!window.confirm(`Supprimer la promo « ${p.title} » ?`)) return;
    const { error: err } = await supabase.from('app_promos').delete().eq('id', p.id);
    if (err) setError(err.message); else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-text-muted">{rows.length} promotion(s)</p>
        <button onClick={() => setEditing(emptyPromo())}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" /> Nouvelle promo
        </button>
      </div>
      {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => (
            <div key={p.id} className={`flex gap-3 rounded-2xl border p-3 ${p.is_visible ? 'border-border/30 bg-surface-light' : 'border-border/10 bg-surface-light/40 opacity-70'}`}>
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-surface">
                {p.image_url
                  ? <img src={p.image_url.startsWith('http') ? p.image_url : ''} alt="" className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
                  : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {p.is_grand_prix && <Star className="h-3.5 w-3.5 text-warning" />}
                  <p className="truncate text-sm font-bold text-text">{p.title}</p>
                </div>
                <p className="truncate text-xs text-text-muted">{p.badge_label ?? p.id}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">Ordre {p.sort_order} · {p.placements.length} emplacement(s)</p>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => toggleVisible(p)} title={p.is_visible ? 'Masquer' : 'Afficher'}
                  className={`rounded-lg p-1.5 ${p.is_visible ? 'text-success' : 'text-text-muted'}`}>
                  {p.is_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button onClick={() => setEditing(p)} className="btn-ghost rounded-lg px-2 py-1 text-xs">Éditer</button>
                <button onClick={() => remove(p)} className="rounded-lg p-1.5 text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <PromoEditor promo={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function PromoEditor({ promo, onClose, onSaved }: { promo: PromoRow; onClose: () => void; onSaved: () => void }) {
  const isNew = useMemo(() => !promo.id || !promo.title, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [p, setP] = useState<PromoRow>(promo);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PromoRow>(k: K, v: PromoRow[K]) => setP((s) => ({ ...s, [k]: v }));

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>, field: 'image_url' | 'banner_url') => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setError(null);
    try { set(field, await uploadToCms('promos', f)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Upload échoué'); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!p.id.trim() || !p.title.trim()) { setError('Identifiant (slug) et titre requis.'); return; }
    setSaving(true); setError(null);
    const payload = {
      id: p.id.trim(), title: p.title, description: p.description, image_url: p.image_url,
      banner_url: p.banner_url || null, badge_label: p.badge_label || null,
      action_label: p.action_label || null, highlighted_reward: p.highlighted_reward || null,
      long_description: p.long_description || null, destination_route: p.destination_route || null,
      conditions: p.conditions, end_date: p.end_date || null, is_grand_prix: p.is_grand_prix,
      placements: p.placements, sort_order: p.sort_order, is_visible: p.is_visible,
    };
    const { error: err } = await supabase.from('app_promos').upsert(payload);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border/30 bg-surface-light shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border/20 p-5">
          <h3 className="font-bold text-text">{isNew ? 'Nouvelle promotion' : 'Éditer la promotion'}</h3>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Identifiant (slug, unique)">
              <input value={p.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)}
                placeholder="promo_xxx" className={inputCls + (isNew ? '' : ' opacity-60')} />
            </Field>
            <Field label="Ordre d'affichage">
              <input type="number" value={p.sort_order} onChange={(e) => set('sort_order', parseInt(e.target.value || '0', 10))} className={inputCls} />
            </Field>
          </div>
          <Field label="Titre"><input value={p.title} onChange={(e) => set('title', e.target.value)} className={inputCls} /></Field>
          <Field label="Description courte"><textarea value={p.description} onChange={(e) => set('description', e.target.value)} rows={2} className={inputCls} /></Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Badge (ex: PLUGSAFE)"><input value={p.badge_label ?? ''} onChange={(e) => set('badge_label', e.target.value)} className={inputCls} /></Field>
            <Field label="Récompense mise en avant"><input value={p.highlighted_reward ?? ''} onChange={(e) => set('highlighted_reward', e.target.value)} className={inputCls} /></Field>
            <Field label="Texte du bouton"><input value={p.action_label ?? ''} onChange={(e) => set('action_label', e.target.value)} className={inputCls} /></Field>
            <Field label="Route de destination (option)"><input value={p.destination_route ?? ''} onChange={(e) => set('destination_route', e.target.value)} className={inputCls} /></Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ImageField label="Image (portrait)" url={p.image_url} onFile={(e) => onFile(e, 'image_url')} onClear={() => set('image_url', '')} uploading={uploading} />
            <ImageField label="Affiche paysage (option)" url={p.banner_url ?? ''} onFile={(e) => onFile(e, 'banner_url')} onClear={() => set('banner_url', null)} uploading={uploading} />
          </div>

          <Field label="Description longue"><textarea value={p.long_description ?? ''} onChange={(e) => set('long_description', e.target.value)} rows={4} className={inputCls} /></Field>
          <Field label="Conditions (une par ligne)">
            <textarea value={p.conditions.join('\n')} onChange={(e) => set('conditions', e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))} rows={4} className={inputCls} />
          </Field>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-text-muted">Emplacements</p>
            <div className="flex flex-wrap gap-2">
              {ALL_PLACEMENTS.map((pl) => {
                const on = p.placements.includes(pl.key);
                return (
                  <button key={pl.key} onClick={() => set('placements', on ? p.placements.filter((x) => x !== pl.key) : [...p.placements, pl.key])}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${on ? 'bg-primary text-white' : 'bg-surface text-text-muted'}`}>
                    {pl.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={p.is_grand_prix} onChange={(e) => set('is_grand_prix', e.target.checked)} /> Grand Prix (vedette)
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={p.is_visible} onChange={(e) => set('is_visible', e.target.checked)} /> Visible
            </label>
          </div>

          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border/20 p-5">
          <button onClick={onClose} className="btn-ghost rounded-xl px-4 py-2 text-sm">Annuler</button>
          <button onClick={save} disabled={saving || uploading}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Onglet Couvertures de jeux ───────────────────────────────
const KNOWN_GAME_SLUGS = [
  'aviator', 'mines', 'roulette', 'big_win_777', 'wheel', 'blackjack', 'plinko',
  'dice', 'crash', 'baccarat', 'hi-lo', 'keno', 'apple_fortune', 'coinflip',
  'cora_dice', 'dames', 'solitaire', 'penalty_shooters_2', 'ludo', 'fantasy',
];

function CoversTab() {
  const [rows, setRows] = useState<CoverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [gameId, setGameId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from('game_cover_overrides').select('*').order('game_id');
    if (err) setError(err.message); else setRows((data ?? []) as CoverRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!gameId.trim()) { setError('Choisis d\'abord l\'identifiant du jeu.'); return; }
    setUploading(true); setError(null);
    try {
      const url = await uploadToCms('covers', f);
      const { error: err } = await supabase.from('game_cover_overrides')
        .upsert({ game_id: gameId.trim(), image_url: url, is_active: true });
      if (err) throw new Error(err.message);
      setGameId('');
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Échec'); }
    finally { setUploading(false); }
  };

  const toggle = async (c: CoverRow) => {
    const { error: err } = await supabase.from('game_cover_overrides').update({ is_active: !c.is_active }).eq('game_id', c.game_id);
    if (err) setError(err.message); else load();
  };
  const remove = async (c: CoverRow) => {
    if (!window.confirm(`Retirer l'override de « ${c.game_id} » (retour à l'image embarquée) ?`)) return;
    const { error: err } = await supabase.from('game_cover_overrides').delete().eq('game_id', c.game_id);
    if (err) setError(err.message); else load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/30 bg-surface-light p-4">
        <p className="mb-2 text-sm font-semibold text-text">Changer la couverture d'un jeu</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] text-text-muted">Identifiant du jeu (slug)</label>
            <input list="game-slugs" value={gameId} onChange={(e) => setGameId(e.target.value)}
              placeholder="aviator" className={inputCls + ' w-56'} />
            <datalist id="game-slugs">{KNOWN_GAME_SLUGS.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Uploader l'image
            <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">Le slug correspond au nom de fichier de l'asset (ex. <code>aviator</code>, <code>big_win_777</code>).</p>
      </div>

      {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {loading ? (
        <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Aucun override — tous les jeux utilisent leur image embarquée.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <div key={c.game_id} className={`rounded-2xl border p-3 ${c.is_active ? 'border-border/30 bg-surface-light' : 'border-border/10 bg-surface-light/40 opacity-70'}`}>
              <div className="mb-2 h-24 overflow-hidden rounded-lg bg-surface">
                <img src={c.image_url} alt={c.game_id} className="h-full w-full object-cover" />
              </div>
              <div className="flex items-center justify-between">
                <span className="truncate font-mono text-xs font-semibold text-text">{c.game_id}</span>
                <div className="flex gap-1">
                  <button onClick={() => toggle(c)} className={`rounded-lg p-1.5 ${c.is_active ? 'text-success' : 'text-text-muted'}`}>
                    {c.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button onClick={() => remove(c)} className="rounded-lg p-1.5 text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── petits helpers UI ────────────────────────────────────────
const inputCls =
  'w-full rounded-xl border border-border/30 bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function ImageField({ label, url, onFile, onClear, uploading }: {
  label: string; url: string; uploading: boolean;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void; onClear: () => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-surface">
          {url ? <img src={url.startsWith('http') ? url : ''} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-xs font-semibold text-text">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
        {url && <button onClick={onClear} className="text-xs text-danger">Retirer</button>}
      </div>
      {url && !url.startsWith('http') && <p className="mt-1 text-[10px] text-text-muted truncate">asset: {url}</p>}
    </div>
  );
}
