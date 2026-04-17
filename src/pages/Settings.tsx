import { useState } from 'react';
import { Save, Shield, Globe, Bell } from 'lucide-react';

export default function Settings() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [defaultCoins, setDefaultCoins] = useState(1000);
  const [maxBet, setMaxBet] = useState(5000);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text">Paramètres</h1>
        <p className="text-sm text-text-muted">Configuration de la plateforme</p>
      </div>

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
              checked={maintenanceMode}
              onChange={setMaintenanceMode}
            />
            <ToggleRow
              label="Inscriptions ouvertes"
              description="Autoriser les nouvelles inscriptions"
              checked={registrationOpen}
              onChange={setRegistrationOpen}
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
              value={defaultCoins}
              onChange={setDefaultCoins}
            />
            <NumberInput
              label="Mise maximale par partie"
              value={maxBet}
              onChange={setMaxBet}
            />
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
          <div className="mb-4 flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold text-text">Notifications</h3>
          </div>
          <div className="space-y-4">
            <ToggleRow
              label="Alertes par email"
              description="Recevoir un email pour les événements critiques"
              checked={true}
              onChange={() => {}}
            />
            <ToggleRow
              label="Rapports hebdomadaires"
              description="Résumé des stats chaque lundi"
              checked={true}
              onChange={() => {}}
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/25"
      >
        <Save className="h-4 w-4" />
        {saved ? 'Sauvegardé !' : 'Sauvegarder'}
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
