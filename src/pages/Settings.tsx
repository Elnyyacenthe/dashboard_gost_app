import { useState, useEffect, useCallback } from 'react';
import {
  Save, Globe, Coins, FileText, Headset, Gamepad2, Loader2,
  CheckCircle2, AlertTriangle, Lock,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

// ── Structure de app_config (lue par l'app Flutter au démarrage) ──
interface AppConfig {
  maintenance: { enabled: boolean; message: string };
  registration_open: boolean;
  money: { starting_balance: number; withdrawal_min: number };
  legal: { support_email: string; terms: string; privacy: string; rules: string };
  contact: { whatsapp: string; telegram: string; phone: string; email: string; help_url: string };
  games: Record<string, { enabled?: boolean; online_count?: string; hot?: boolean }>;
}

const DEFAULT: AppConfig = {
  maintenance: { enabled: false, message: 'Plugbet est en maintenance. Nous revenons très vite !' },
  registration_open: true,
  money: { starting_balance: 1000, withdrawal_min: 100 },
  legal: { support_email: 'support@plugbet.app', terms: '', privacy: '', rules: '' },
  contact: { whatsapp: '', telegram: '', phone: '', email: '', help_url: '' },
  games: {},
};

// coverKey (nom d'asset) -> libellé. Doit matcher GameEntry.coverKey côté app.
const GAMES: { key: string; label: string }[] = [
  { key: 'aviator', label: 'Aviator' }, { key: 'mines', label: 'Mines' },
  { key: 'plinko', label: 'Plinko' }, { key: 'crash', label: 'Crash' },
  { key: 'dice', label: 'Dice' }, { key: 'hi-lo', label: 'Hi-Lo' },
  { key: 'keno', label: 'Keno' }, { key: 'baccarat', label: 'Baccarat' },
  { key: 'roulette', label: 'Roulette' }, { key: 'big_win_777', label: 'Big Win 777' },
  { key: 'wheel', label: 'Plugbet Wheel' }, { key: 'blackjack', label: 'Blackjack' },
  { key: 'apple_fortune', label: 'Apple Fortune' }, { key: 'coinflip', label: 'Pile ou Face' },
  { key: 'cora_dice', label: 'Cora Dice' }, { key: 'dames', label: 'Dames' },
  { key: 'solitaire', label: 'Solitaire' }, { key: 'penalty_shooters_2', label: 'Penalty' },
  { key: 'ludo', label: 'Ludo' }, { key: 'fantasy', label: 'Fantasy' },
];

export default function Settings() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: e } = await supabase
        .from('app_settings').select('value').eq('key', 'app_config').maybeSingle();
      if (e) throw e;
      if (data?.value) {
        const v = data.value as Partial<AppConfig>;
        setCfg({
          ...DEFAULT, ...v,
          maintenance: { ...DEFAULT.maintenance, ...(v.maintenance ?? {}) },
          money: { ...DEFAULT.money, ...(v.money ?? {}) },
          legal: { ...DEFAULT.legal, ...(v.legal ?? {}) },
          contact: { ...DEFAULT.contact, ...(v.contact ?? {}) },
          games: v.games ?? {},
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const { data, error: e } = await supabase.rpc('update_app_setting', {
        p_key: 'app_config', p_value: cfg,
      });
      if (e) throw e;
      if (data?.success === false) throw new Error(data.error ?? 'Erreur');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // setters de section
  const setMoney = (k: keyof AppConfig['money'], v: number) =>
    setCfg((c) => ({ ...c, money: { ...c.money, [k]: v } }));
  const setLegal = (k: keyof AppConfig['legal'], v: string) =>
    setCfg((c) => ({ ...c, legal: { ...c.legal, [k]: v } }));
  const setContact = (k: keyof AppConfig['contact'], v: string) =>
    setCfg((c) => ({ ...c, contact: { ...c.contact, [k]: v } }));
  const setGame = (key: string, patch: Partial<AppConfig['games'][string]>) =>
    setCfg((c) => ({ ...c, games: { ...c.games, [key]: { ...c.games[key], ...patch } } }));

  if (authLoading || loading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Réservé au <strong>super administrateur</strong>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-text">Configuration de l'app</h1>
        <p className="text-sm text-text-muted">
          Piloté en direct dans l'app (clé <code className="text-xs">app_config</code>), sans mise à jour du store.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Général */}
      <Section icon={<Globe className="h-5 w-5 text-primary" />} title="Général">
        <ToggleRow label="Mode maintenance" description="Bloque l'app avec un message plein écran"
          checked={cfg.maintenance.enabled}
          onChange={(v) => setCfg((c) => ({ ...c, maintenance: { ...c.maintenance, enabled: v } }))} />
        <TextArea label="Message de maintenance" rows={2} value={cfg.maintenance.message}
          onChange={(v) => setCfg((c) => ({ ...c, maintenance: { ...c.maintenance, message: v } }))} />
        <ToggleRow label="Inscriptions ouvertes" description="Autoriser les nouveaux comptes"
          checked={cfg.registration_open}
          onChange={(v) => setCfg((c) => ({ ...c, registration_open: v }))} />
      </Section>

      {/* Limites d'argent */}
      <Section icon={<Coins className="h-5 w-5 text-primary" />} title="Limites d'argent">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberInput label="Solde de départ (nouveau joueur, FCFA)" value={cfg.money.starting_balance}
            onChange={(v) => setMoney('starting_balance', v)} />
          <NumberInput label="Retrait minimum (FCFA)" value={cfg.money.withdrawal_min}
            onChange={(v) => setMoney('withdrawal_min', v)} />
        </div>
        <p className="rounded-xl bg-surface p-3 text-[11px] text-text-muted">
          ℹ️ Les mises min/max par jeu et les limites sportives sont vérifiées côté serveur (contraintes SQL) et ne se règlent pas ici.
        </p>
      </Section>

      {/* Textes légaux */}
      <Section icon={<FileText className="h-5 w-5 text-primary" />} title="Textes légaux & support">
        <TextInput label="Email de support" value={cfg.legal.support_email}
          onChange={(v) => setLegal('support_email', v)} />
        <TextArea label="Règles des jeux (vide = texte embarqué)" rows={4} value={cfg.legal.rules}
          onChange={(v) => setLegal('rules', v)} />
        <TextArea label="Politique de confidentialité (vide = texte embarqué)" rows={4} value={cfg.legal.privacy}
          onChange={(v) => setLegal('privacy', v)} />
        <TextArea label="Conditions générales (vide = texte embarqué)" rows={4} value={cfg.legal.terms}
          onChange={(v) => setLegal('terms', v)} />
      </Section>

      {/* Contacts */}
      <Section icon={<Headset className="h-5 w-5 text-primary" />} title="Contacts (affichés si renseignés)">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="WhatsApp (numéro)" value={cfg.contact.whatsapp} onChange={(v) => setContact('whatsapp', v)} placeholder="237690000000" />
          <TextInput label="Telegram (@ ou lien)" value={cfg.contact.telegram} onChange={(v) => setContact('telegram', v)} placeholder="@plugbet" />
          <TextInput label="Téléphone" value={cfg.contact.phone} onChange={(v) => setContact('phone', v)} placeholder="+237 6 90 00 00 00" />
          <TextInput label="Email de contact" value={cfg.contact.email} onChange={(v) => setContact('email', v)} placeholder="contact@plugbet.app" />
          <TextInput label="Lien Aide / FAQ" value={cfg.contact.help_url} onChange={(v) => setContact('help_url', v)} placeholder="https://…" />
        </div>
      </Section>

      {/* Catalogue jeux */}
      <Section icon={<Gamepad2 className="h-5 w-5 text-primary" />} title="Catalogue de jeux">
        <p className="mb-1 text-[11px] text-text-muted">Désactive un jeu pour le masquer dans l'app. Compteur « en ligne » et badge HOT surchargeables.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-text-muted">
                <th className="py-2">Jeu</th>
                <th className="py-2 text-center">Visible</th>
                <th className="py-2">En ligne</th>
                <th className="py-2 text-center">HOT</th>
              </tr>
            </thead>
            <tbody>
              {GAMES.map((g) => {
                const gc = cfg.games[g.key] ?? {};
                return (
                  <tr key={g.key} className="border-t border-border/20">
                    <td className="py-2 font-medium text-text">{g.label}<span className="ml-1 font-mono text-[10px] text-text-muted">{g.key}</span></td>
                    <td className="py-2 text-center">
                      <MiniToggle checked={gc.enabled !== false} onChange={(v) => setGame(g.key, { enabled: v })} />
                    </td>
                    <td className="py-2">
                      <input value={gc.online_count ?? ''} onChange={(e) => setGame(g.key, { online_count: e.target.value })}
                        placeholder="ex. 2.9k"
                        className="w-24 rounded-lg border border-border/30 bg-surface px-2 py-1 text-xs text-text focus:border-primary focus:outline-none" />
                    </td>
                    <td className="py-2 text-center">
                      <MiniToggle checked={gc.hot === true} onChange={(v) => setGame(g.key, { hot: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="fixed bottom-6 right-6 z-30">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary-dark disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saving ? 'Sauvegarde…' : saved ? 'Sauvegardé !' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
      <div className="mb-4 flex items-center gap-2">{icon}<h3 className="text-lg font-semibold text-text">{title}</h3></div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div><p className="text-sm font-medium text-text">{label}</p><p className="text-xs text-text-muted">{description}</p></div>
      <MiniToggle checked={checked} onChange={onChange} />
    </div>
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-lighter'}`}>
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none" />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none" />
    </div>
  );
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">{label}</label>
      <textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:border-primary focus:outline-none" />
    </div>
  );
}
