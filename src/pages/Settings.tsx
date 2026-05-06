import { useState, useEffect, useCallback } from 'react';
import { Save, Shield, Globe, Bell, Loader2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface PlatformConfig {
  maintenance_mode: boolean;
  registration_open: boolean;
  default_coins: number;
  max_bet: number;
  email_alerts: boolean;
  weekly_reports: boolean;
}

const DEFAULT_CONFIG: PlatformConfig = {
  maintenance_mode: false,
  registration_open: true,
  default_coins: 1000,
  max_bet: 5000,
  email_alerts: true,
  weekly_reports: true,
};

export default function Settings() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [cfg, setCfg] = useState<PlatformConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'platform_config')
        .maybeSingle();
      if (e) throw e;
      if (data?.value) {
        setCfg({ ...DEFAULT_CONFIG, ...(data.value as PlatformConfig) });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { data, error: rpcErr } = await supabase.rpc('update_app_setting', {
        p_key: 'platform_config',
        p_value: cfg,
      });
      if (rpcErr) throw rpcErr;
      if (data?.success === false) throw new Error(data.error ?? 'Erreur');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof PlatformConfig>(key: K, value: PlatformConfig[K]) => {
    setCfg(prev => ({ ...prev, [key]: value }));
  };

  if (authLoading || loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Cette section est réservée au <strong>super administrateur</strong>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Paramètres</h1>
        <p className="text-sm text-text-muted">
          Configuration de la plateforme — Persistée dans <code className="text-xs">app_settings</code>
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* General */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-text">Général</h3>
          </div>
          <div className="space-y-4">
            <ToggleRow
              label="Mode maintenance"
              description="Bloquer l'accès aux joueurs"
              checked={cfg.maintenance_mode}
              onChange={(v) => update('maintenance_mode', v)}
            />
            <ToggleRow
              label="Inscriptions ouvertes"
              description="Autoriser les nouvelles inscriptions"
              checked={cfg.registration_open}
              onChange={(v) => update('registration_open', v)}
            />
          </div>
        </div>

        {/* Economy */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
          <div className="mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-text">Économie</h3>
          </div>
          <div className="space-y-4">
            <NumberInput
              label="Coins par défaut (nouveau joueur)"
              value={cfg.default_coins}
              onChange={(v) => update('default_coins', v)}
            />
            <NumberInput
              label="Mise maximale par partie"
              value={cfg.max_bet}
              onChange={(v) => update('max_bet', v)}
            />
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-text">Notifications</h3>
          </div>
          <div className="space-y-4">
            <ToggleRow
              label="Alertes par email"
              description="Recevoir un email pour les événements critiques"
              checked={cfg.email_alerts}
              onChange={(v) => update('email_alerts', v)}
            />
            <ToggleRow
              label="Rapports hebdomadaires"
              description="Résumé des stats chaque lundi"
              checked={cfg.weekly_reports}
              onChange={(v) => update('weekly_reports', v)}
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/25 disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> :
         saved ? <CheckCircle2 className="h-4 w-4" /> :
         <Save className="h-4 w-4" />}
        {saving ? 'Sauvegarde...' : saved ? 'Sauvegardé !' : 'Sauvegarder'}
      </button>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-lighter'}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function NumberInput({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
      />
    </div>
  );
}
