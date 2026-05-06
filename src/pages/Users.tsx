import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, ShieldCheck, RotateCcw, Eye,
  UserPlus, Crown, Shield, User, X, Check, Loader2, Wallet
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import DataTable from '../components/DataTable';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import type { Profile } from '../types';

type Tab = 'players' | 'team';
type Role = 'super_admin' | 'admin' | 'moderator' | 'user';

const roleConfig: Record<Role, { label: string; color: string; icon: React.ReactNode }> = {
  super_admin: { label: 'Super Admin', color: 'bg-warning/15 text-warning',          icon: <Crown className="h-3 w-3" /> },
  admin:       { label: 'Admin',       color: 'bg-primary/15 text-primary',           icon: <Crown className="h-3 w-3" /> },
  moderator:   { label: 'Modérateur',  color: 'bg-info/15 text-info',                 icon: <Shield className="h-3 w-3" /> },
  user:        { label: 'Joueur',      color: 'bg-surface-lighter text-text-muted',   icon: <User className="h-3 w-3" /> },
};

function RoleBadge({ role }: { role: Role }) {
  const cfg = roleConfig[role] ?? roleConfig.user;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function StatusBadge({ blocked }: { blocked: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
      blocked ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${blocked ? 'bg-danger' : 'bg-success'}`} />
      {blocked ? 'Bloqué' : 'Actif'}
    </span>
  );
}

// Modal detail utilisateur
function UserDetailModal({ user, onClose, onRefresh }: {
  user: Profile; onClose: () => void; onRefresh: () => void;
}) {
  const { isSuperAdmin } = useAuth();
  const [saving, setSaving]           = useState(false);
  const [savingCoins, setSavingCoins] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>(user.role as Role);
  const [coinInput, setCoinInput]     = useState(String(user.coins));
  const [coinSuccess, setCoinSuccess] = useState(false);
  const [coinError, setCoinError]     = useState('');
  const canEditPlayerCoins = isSuperAdmin && user.role === 'user';

  const handleRoleChange = async () => {
    setSaving(true);
    await supabase.from('user_profiles').update({ role: selectedRole }).eq('id', user.id);
    setSaving(false);
    onRefresh(); onClose();
  };

  const handleToggleBlock = async () => {
    const reason = prompt('Raison (obligatoire, traçée dans audit log) :');
    if (!reason || reason.trim().length < 3) return;
    const { data, error } = await supabase.rpc('admin_set_user_blocked', {
      p_user_id: user.id,
      p_blocked: !user.is_blocked,
      p_reason: reason.trim(),
    });
    if (error || data?.success === false) {
      alert('Erreur: ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    onRefresh(); onClose();
  };

  const handleResetCoins = async () => {
    if (!canEditPlayerCoins) return;
    if (user.coins === 0) { onClose(); return; }
    const reason = prompt(`Reset des ${user.coins} coins à 0 - Raison (obligatoire) :`);
    if (!reason || reason.trim().length < 3) return;
    const { data, error } = await supabase.rpc('admin_adjust_user_coins', {
      p_user_id: user.id,
      p_delta: -user.coins,
      p_reason: reason.trim(),
    });
    if (error || data?.success === false) {
      alert('Erreur: ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    onRefresh(); onClose();
  };

  const handleSetCoins = async () => {
    if (!canEditPlayerCoins) return;
    const val = parseInt(coinInput, 10);
    if (isNaN(val) || val < 0) { setCoinError('Montant invalide (nombre entier ≥ 0 requis)'); return; }
    const delta = val - user.coins;
    if (delta === 0) { setCoinError('Aucune modification'); return; }
    const reason = prompt(`Ajustement de ${delta > 0 ? '+' : ''}${delta} coins - Raison (obligatoire) :`);
    if (!reason || reason.trim().length < 3) { setCoinError('Raison obligatoire'); return; }
    setCoinError('');
    setSavingCoins(true);
    const { data, error } = await supabase.rpc('admin_adjust_user_coins', {
      p_user_id: user.id,
      p_delta: delta,
      p_reason: reason.trim(),
    });
    setSavingCoins(false);
    if (error || data?.success === false) {
      setCoinError('Erreur: ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    setCoinSuccess(true);
    onRefresh();
    setTimeout(() => { setCoinSuccess(false); onClose(); }, 1200);
  };

  const quickAmounts = [100, 500, 1000, 5000];

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'ID',                 value: <span className="font-mono text-xs">{user.id.slice(0, 20)}…</span> },
    { label: 'Coins actuels',      value: <span className="font-semibold text-primary">{user.coins.toLocaleString()} 🪙</span> },
    { label: 'Statut',             value: <StatusBadge blocked={user.is_blocked} /> },
    { label: 'Inscription',        value: format(new Date(user.created_at), 'dd MMM yyyy HH:mm', { locale: fr }) },
    { label: 'Dernière connexion', value: user.last_seen ? format(new Date(user.last_seen), 'dd MMM yyyy HH:mm', { locale: fr }) : 'Jamais' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/30 bg-surface-light shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/20 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-lg font-bold text-primary">
              {user.username?.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-text">{user.username}</p>
              <p className="text-xs text-text-muted">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[80vh] overflow-y-auto space-y-3 p-5">
          {/* Infos */}
          <div className="rounded-xl bg-surface p-4 space-y-3">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{label}</span>
                <span className="font-medium text-text">{value}</span>
              </div>
            ))}
          </div>

          {/* ── Modifier la caisse (super_admin uniquement) ── */}
          {canEditPlayerCoins && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-warning" />
                <p className="text-sm font-semibold text-warning">Modifier la caisse</p>
                <span className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold text-warning uppercase tracking-wide">
                  Super Admin
                </span>
              </div>

              {coinError && (
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{coinError}</p>
              )}
              {coinSuccess && (
                <p className="flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                  <Check className="h-3 w-3" /> Caisse mise à jour !
                </p>
              )}

              {/* Raccourcis rapides */}
              <div>
                <p className="mb-1.5 text-xs text-text-muted">Ajouter rapidement</p>
                <div className="flex gap-1.5 flex-wrap">
                  {quickAmounts.map(amt => (
                    <button key={amt} type="button"
                      onClick={() => setCoinInput(String(Math.max(0, (parseInt(coinInput) || 0) + amt)))}
                      className="rounded-lg border border-border/30 px-2.5 py-1 text-xs font-medium text-text-muted hover:border-primary/40 hover:text-primary transition-colors">
                      +{amt.toLocaleString()}
                    </button>
                  ))}
                  {quickAmounts.map(amt => (
                    <button key={`-${amt}`} type="button"
                      onClick={() => setCoinInput(String(Math.max(0, (parseInt(coinInput) || 0) - amt)))}
                      className="rounded-lg border border-border/30 px-2.5 py-1 text-xs font-medium text-text-muted hover:border-danger/40 hover:text-danger transition-colors">
                      -{amt.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Saisie manuelle */}
              <div>
                <p className="mb-1.5 text-xs text-text-muted">Montant exact</p>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" value={coinInput}
                    onChange={e => { setCoinInput(e.target.value); setCoinError(''); }}
                    className="flex-1 rounded-xl border border-border/30 bg-surface px-3 py-2 text-sm text-text focus:border-warning focus:outline-none focus:ring-1 focus:ring-warning transition-colors"
                    placeholder="0"
                  />
                  <button type="button" onClick={handleSetCoins} disabled={savingCoins || coinSuccess}
                    className="flex items-center gap-2 rounded-xl bg-warning px-4 py-2 text-sm font-semibold text-white hover:bg-warning/80 disabled:opacity-50 transition-colors">
                    {savingCoins ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Appliquer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rôle */}
          <div className="rounded-xl bg-surface p-4">
            <p className="mb-3 text-sm font-medium text-text">Changer le rôle</p>
            <div className="flex gap-2">
              {(['user', 'moderator', 'admin'] as Role[]).map(r => (
                <button key={r} onClick={() => setSelectedRole(r)}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
                    selectedRole === r ? 'bg-primary text-white' : 'border border-border/30 text-text-muted hover:bg-surface-lighter'
                  }`}>
                  {roleConfig[r].label}
                </button>
              ))}
            </div>
            {selectedRole !== user.role && (
              <button onClick={handleRoleChange} disabled={saving}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Confirmer le changement de rôle
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleToggleBlock}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                user.is_blocked ? 'bg-success/10 text-success hover:bg-success/20' : 'bg-danger/10 text-danger hover:bg-danger/20'
              }`}>
              {user.is_blocked ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {user.is_blocked ? 'Débloquer' : 'Bloquer'}
            </button>
            {canEditPlayerCoins && (
              <button onClick={handleResetCoins}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-warning/10 py-2.5 text-sm font-medium text-warning hover:bg-warning/20 transition-colors">
                <RotateCcw className="h-4 w-4" />
                Reset coins
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal ajouter membre
function InviteModal({ onClose, onRefresh }: { onClose: () => void; onRefresh: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'moderator'>('moderator');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handlePromote = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');

    const { data } = await supabase
      .from('user_profiles')
      .select('id, username, role')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (!data) {
      setError("Aucun compte trouvé. L'utilisateur doit d'abord s'inscrire dans l'application.");
      setSaving(false);
      return;
    }

    const { error: updateErr } = await supabase
      .from('user_profiles').update({ role }).eq('id', data.id);

    if (updateErr) {
      setError('Erreur lors de la mise à jour du rôle.');
    } else {
      setSuccess(true);
      onRefresh();
      setTimeout(() => { setSuccess(false); onClose(); }, 1500);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border/30 bg-surface-light shadow-2xl animate-fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/20 p-5">
          <h3 className="font-bold text-text">Ajouter un membre</h3>
          <button onClick={onClose} aria-label="Fermer" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handlePromote} className="p-5 space-y-4">
          <p className="text-xs text-text-muted leading-relaxed">
            L'utilisateur doit avoir un compte dans ton app. Entre son email pour lui donner accès au dashboard.
          </p>

          {error && <div className="rounded-xl bg-danger/10 border border-danger/20 p-3 text-xs text-danger">{error}</div>}
          {success && (
            <div className="rounded-xl bg-success/10 border border-success/20 p-3 text-xs text-success flex items-center gap-2">
              <Check className="h-3.5 w-3.5" /> Accès accordé avec succès !
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">Email du joueur</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="collegue@email.com"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-muted">Rôle</label>
            <div className="flex gap-2">
              {(['moderator', 'admin'] as const).map(r => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all ${
                    role === r ? 'bg-primary text-white' : 'border border-border/30 text-text-muted hover:bg-surface-lighter'
                  }`}>
                  {r === 'admin' ? <Crown className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                  {r === 'admin' ? 'Admin' : 'Modérateur'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {role === 'admin'
                ? '⚠️ Accès complet au dashboard, dont la gestion équipe et paramètres.'
                : 'Peut gérer les joueurs mais pas l\'équipe ni les paramètres.'}
            </p>
          </div>

          <button type="submit" disabled={saving || success}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Donner l'accès
          </button>
        </form>
      </div>
    </div>
  );
}

// Page principale
export default function UsersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('players');
  const [players, setPlayers] = useState<Profile[]>([]);
  const [team, setTeam] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_profiles').select('*').order('created_at', { ascending: false });
    if (data) {
      setPlayers((data as Profile[]).filter(p => p.role === 'user'));
      setTeam((data as Profile[]).filter(p => p.role === 'admin' || p.role === 'moderator'));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const removeFromTeam = async (user: Profile) => {
    if (!confirm(`Révoquer l'accès dashboard de ${user.username} ?`)) return;
    await supabase.from('user_profiles').update({ role: 'user' }).eq('id', user.id);
    fetchAll();
  };

  const playerColumns = [
    {
      key: 'username', header: 'Joueur',
      render: (u: Profile) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {u.username?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-text">{u.username}</p>
            <p className="text-xs text-text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'coins', header: 'Coins',
      render: (u: Profile) => <span className="font-semibold text-primary">{u.coins.toLocaleString()}</span> },
    { key: 'is_blocked', header: 'Statut',
      render: (u: Profile) => <StatusBadge blocked={u.is_blocked} /> },
    { key: 'created_at', header: 'Inscription',
      render: (u: Profile) => (
        <span className="text-sm text-text-muted">
          {format(new Date(u.created_at), 'dd MMM yyyy', { locale: fr })}
        </span>
      ),
    },
    { key: 'actions', header: '',
      render: (u: Profile) => (
        <button onClick={e => { e.stopPropagation(); navigate(`/dashboard/users/${u.id}`); }}
          aria-label={`Voir le profil 360 de ${(u as Profile).username}`}
          className="rounded-lg p-1.5 text-text-muted border border-border/30 hover:bg-surface-lighter hover:text-text transition-colors">
          <Eye className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  const teamColumns = [
    {
      key: 'username', header: 'Membre',
      render: (u: Profile) => (
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            u.role === 'admin' ? 'bg-primary/20 text-primary' : 'bg-info/20 text-info'
          }`}>
            {u.username?.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-text">{u.username}</p>
            <p className="text-xs text-text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Rôle',
      render: (u: Profile) => <RoleBadge role={u.role as Role} /> },
    { key: 'created_at', header: 'Membre depuis',
      render: (u: Profile) => (
        <span className="text-sm text-text-muted">
          {format(new Date(u.created_at), 'dd MMM yyyy', { locale: fr })}
        </span>
      ),
    },
    { key: 'last_seen', header: 'Dernière connexion',
      render: (u: Profile) => (
        <span className="text-sm text-text-muted">
          {u.last_seen ? format(new Date(u.last_seen), 'dd MMM HH:mm', { locale: fr }) : 'Jamais'}
        </span>
      ),
    },
    {
      key: 'actions', header: '',
      render: (u: Profile) => (
        <div className="flex gap-1.5">
          <button onClick={e => { e.stopPropagation(); setSelectedUser(u); }}
            aria-label={`Voir le profil de ${(u as Profile).username}`}
            className="rounded-lg p-1.5 text-text-muted border border-border/30 hover:bg-surface-lighter hover:text-text transition-colors">
            <Eye className="h-3.5 w-3.5" />
          </button>
          {u.role !== 'admin' && (
            <button onClick={e => { e.stopPropagation(); removeFromTeam(u); }}
              className="rounded-lg p-1.5 text-danger border border-danger/20 hover:bg-danger/10 transition-colors"
              title="Révoquer l'accès">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const tabs = [
    { id: 'players' as Tab, icon: <User className="h-4 w-4" />,  label: 'Joueurs',     count: players.length },
    { id: 'team'    as Tab, icon: <Crown className="h-4 w-4" />, label: 'Mon Équipe',  count: team.length },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
            Plugbet · Players & team
          </p>
          <h1 className="hero-number mt-1 text-3xl text-text">Utilisateurs</h1>
          <p className="mt-2 text-sm text-text-secondary">
            {tab === 'players'
              ? <>
                  <span className="font-bold text-text">{players.length.toLocaleString()}</span> joueur{players.length !== 1 ? 's' : ''} inscrit{players.length !== 1 ? 's' : ''}
                </>
              : <>
                  <span className="font-bold text-text">{team.length.toLocaleString()}</span> membre{team.length !== 1 ? 's' : ''} dans l'équipe
                </>}
          </p>
        </div>
        {tab === 'team' && (
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-surface hover:bg-primary-light hover:shadow-[0_0_24px_rgba(0,230,118,0.4)] transition-all">
            <UserPlus className="h-4 w-4" strokeWidth={2.5} />
            Ajouter un membre
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-border/40 bg-surface-light/50 p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
              tab === t.id
                ? 'bg-primary text-surface shadow-[0_0_16px_rgba(0,230,118,0.3)]'
                : 'text-text-secondary hover:text-text'
            }`}>
            {t.icon}
            {t.label}
            <span className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${
              tab === t.id ? 'bg-surface/30 text-surface' : 'bg-surface-lighter text-text-secondary'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : tab === 'players' ? (
        players.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/30 bg-surface-light py-16">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-lighter text-text-muted">
              <User className="h-7 w-7" />
            </div>
            <p className="font-semibold text-text">Aucun joueur inscrit pour l'instant</p>
            <p className="text-sm text-text-muted text-center max-w-xs">
              Les joueurs apparaîtront ici dès qu'ils créeront un compte dans ton application mobile.
            </p>
          </div>
        ) : (
          <DataTable
            data={players as unknown as Record<string, unknown>[]}
            columns={playerColumns as never}
            searchPlaceholder="Rechercher un joueur..."
            onRowClick={u => navigate(`/dashboard/users/${(u as unknown as Profile).id}`)}
          />
        )
      ) : (
        <DataTable
          data={team as unknown as Record<string, unknown>[]}
          columns={teamColumns as never}
          searchPlaceholder="Rechercher un membre..."
          onRowClick={u => setSelectedUser(u as unknown as Profile)}
        />
      )}

      {selectedUser && (
        <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} onRefresh={fetchAll} />
      )}
      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onRefresh={fetchAll} />
      )}
    </div>
  );
}
