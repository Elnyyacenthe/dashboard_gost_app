// ============================================================
// AffiliateMarketing — gestion des ressources marketing (admin)
// ============================================================
// Upload vers le bucket affiliate-marketing + admin_add_marketing_asset,
// liste et suppression (soft-delete).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Upload, Trash2, Image as ImageIcon, Video, Package } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Asset {
  id: string;
  title: string;
  category: string;
  file_url: string;
  thumbnail_url: string | null;
  format: string | null;
  dimensions: string | null;
  created_at: string;
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'logo', label: 'Logos' },
  { key: 'flyer', label: 'Flyers' },
  { key: 'poster', label: 'Affiches' },
  { key: 'banner', label: 'Bannières' },
  { key: 'qr', label: 'QR Codes' },
  { key: 'story', label: 'Stories' },
  { key: 'facebook_cover', label: 'Couvertures Facebook' },
  { key: 'tiktok_video', label: 'Vidéos TikTok' },
  { key: 'facebook_video', label: 'Vidéos Facebook' },
  { key: 'instagram_video', label: 'Vidéos Instagram' },
  { key: 'media_pack', label: 'Packs médias' },
];
const VIDEO = ['tiktok_video', 'facebook_video', 'instagram_video'];
const labelFor = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

export default function AffiliateMarketing() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('banner');
  const [dimensions, setDimensions] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('affiliate_marketing_assets')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    if (data) setAssets(data as Asset[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async () => {
    if (!file || !title.trim()) {
      alert('Titre et fichier requis.');
      return;
    }
    setUploading(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${category}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('affiliate-marketing').upload(path, file);
      if (up.error) {
        alert('Upload échoué : ' + up.error.message);
        return;
      }
      const { data: pub } = supabase.storage.from('affiliate-marketing').getPublicUrl(path);
      const ext = (file.name.split('.').pop() ?? '').toUpperCase();
      const { data, error } = await supabase.rpc('admin_add_marketing_asset', {
        p_title: title.trim(),
        p_category: category,
        p_description: null,
        p_file_url: pub.publicUrl,
        p_thumbnail_url: null,
        p_format: ext,
        p_dimensions: dimensions.trim() || null,
        p_file_size: file.size,
      });
      if (error || data?.success === false) {
        alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
        return;
      }
      setTitle('');
      setDimensions('');
      setFile(null);
      await load();
    } finally {
      setUploading(false);
    }
  };

  const remove = async (a: Asset) => {
    if (!window.confirm(`Supprimer « ${a.title} » ?`)) return;
    const { data, error } = await supabase.rpc('admin_delete_marketing_asset', { p_id: a.id });
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    await load();
  };

  return (
    <div className="space-y-6">
      {/* Formulaire d'ajout */}
      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        <h3 className="mb-4 text-sm font-black text-text">Publier une ressource</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre"
            className="rounded-xl border border-border/40 bg-surface-light px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-border/40 bg-surface-light px-4 py-2.5 text-sm outline-none focus:border-primary"
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <input
            value={dimensions}
            onChange={(e) => setDimensions(e.target.value)}
            placeholder="Dimensions (ex. 1080x1920)"
            className="rounded-xl border border-border/40 bg-surface-light px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-white"
          />
        </div>
        <button
          onClick={upload}
          disabled={uploading}
          className="btn-primary mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Publier
        </button>
      </div>

      {/* Grille */}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-border/30 bg-surface-light p-10 text-center text-sm text-text-muted">
          Aucune ressource publiée.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((a) => {
            const isVideo = VIDEO.includes(a.category);
            const isPack = a.category === 'media_pack';
            const preview = a.thumbnail_url ?? (!isVideo && !isPack ? a.file_url : null);
            return (
              <div key={a.id} className="overflow-hidden rounded-2xl border border-border/30 bg-surface-light">
                <div className="flex h-32 items-center justify-center bg-surface-lighter">
                  {preview ? (
                    <img src={preview} alt={a.title} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-text-muted/40">
                      {isVideo ? <Video className="h-8 w-8" /> : isPack ? <Package className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-bold text-text">{a.title}</p>
                  <p className="text-[11px] text-text-muted">{labelFor(a.category)}{a.dimensions ? ` · ${a.dimensions}` : ''}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <a href={a.file_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary-dark hover:underline">
                      Voir
                    </a>
                    <button onClick={() => remove(a)} className="text-danger hover:opacity-70">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
