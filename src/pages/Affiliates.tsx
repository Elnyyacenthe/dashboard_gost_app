// ============================================================
// Affiliates — module Affiliés (dashboard admin)
// ============================================================
// Phase 0 : liste + KPIs des affiliés (lecture de admin_affiliates_view).
// Les actions d'administration (approuver/refuser un code, valider un
// retrait, suspendre/bannir, répondre aux tickets) arrivent aux phases
// suivantes via des RPC affiliate_*/admin_* dédiées.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Handshake, Users, Clock, Wallet, Megaphone } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import StatsCard from '../components/StatsCard';
import DataTable from '../components/DataTable';
import AffiliatePromoModeration from './AffiliatePromoModeration';
import AffiliateWithdrawals from './AffiliateWithdrawals';
import AffiliateTickets from './AffiliateTickets';
import AffiliateMarketing from './AffiliateMarketing';

interface AffiliateRow {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  status: 'active' | 'suspended' | 'banned';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond' | 'vip';
  created_at: string;
  referrals_count: number;
  first_deposits_count: number;
  active_players_count: number;
  active_codes_count: number;
  total_earned: number | null;
  available: number | null;
  pending: number | null;
  paid: number | null;
  revenue_share_percent: number | null;
  effective_revenue_percent: number | null;
  is_demo: boolean | null;
  demo_data: Record<string, number> | null;
}

const fcfa = (v: number | null | undefined) =>
  `${Math.round(Number(v ?? 0)).toLocaleString('fr-FR')} FCFA`;

const statusBadge: Record<AffiliateRow['status'], string> = {
  active: 'badge-success',
  suspended: 'badge-warning',
  banned: 'badge-danger',
};
const statusLabel: Record<AffiliateRow['status'], string> = {
  active: 'Actif',
  suspended: 'Suspendu',
  banned: 'Banni',
};
const tierBadge: Record<AffiliateRow['tier'], string> = {
  bronze: 'badge-neutral',
  silver: 'badge-info',
  gold: 'badge-warning',
  diamond: 'badge-primary',
  vip: 'badge-danger',
};

export default function Affiliates() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<'affiliates' | 'codes' | 'withdrawals' | 'tickets' | 'marketing'>('affiliates');
  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoTarget, setDemoTarget] = useState<AffiliateRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_affiliates_view')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('load affiliates:', error.message);
    if (data) setRows(data as AffiliateRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.status === 'active').length;
    const suspended = rows.filter((r) => r.status !== 'active').length;
    const owed = rows.reduce((sum, r) => sum + Number(r.available ?? 0), 0);
    return { total, active, suspended, owed };
  }, [rows]);

  if (authLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
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

  const adjustCommission = async (a: AffiliateRow) => {
    const raw = window.prompt(`Ajustement de commission pour ${a.username ?? ''} (montant en FCFA, négatif possible) :`, '0');
    if (raw === null) return;
    const delta = parseInt(raw, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      alert('Montant invalide.');
      return;
    }
    const reason = window.prompt('Motif de l\'ajustement (obligatoire) :');
    if (!reason || reason.trim().length < 3) return;
    const { data, error } = await supabase.rpc('admin_adjust_commission', {
      p_affiliate_id: a.id,
      p_delta: delta,
      p_reason: reason.trim(),
    });
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    await load();
  };

  // Fixe un % de revenue-share propre à cet affilié (override du global).
  // Vide = revient au % global de affiliate_config.
  const setRevenuePercent = async (a: AffiliateRow) => {
    const current = a.revenue_share_percent;
    const raw = window.prompt(
      `% de revenue-share pour ${a.username ?? ''} (0–100).\n` +
        `Laisser VIDE pour revenir au % global (actuel effectif : ${a.effective_revenue_percent ?? '—'}%) :`,
      current == null ? '' : String(current),
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    let p_percent: number | null;
    if (trimmed === '') {
      p_percent = null;
    } else {
      const pct = Number(trimmed.replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        alert('Pourcentage invalide (attendu : 0 à 100, ou vide pour le global).');
        return;
      }
      p_percent = pct;
    }
    const { data, error } = await supabase.rpc('admin_set_affiliate_revenue_percent', {
      p_affiliate_id: a.id,
      p_percent,
    });
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    await load();
  };

  const columns = [
    {
      key: 'username',
      header: 'Affilié',
      render: (a: AffiliateRow) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold text-text">
            {a.username ?? '—'}
            {a.is_demo && (
              <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-500">
                <Megaphone className="h-2.5 w-2.5" /> Démo
              </span>
            )}
          </p>
          <p className="truncate text-xs text-text-muted">{a.email ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      render: (a: AffiliateRow) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusBadge[a.status]}`}>
          {statusLabel[a.status]}
        </span>
      ),
    },
    {
      key: 'tier',
      header: 'Palier',
      render: (a: AffiliateRow) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${tierBadge[a.tier]}`}>
          {a.tier}
        </span>
      ),
    },
    { key: 'referrals_count', header: 'Inscrits', render: (a: AffiliateRow) => a.referrals_count },
    { key: 'first_deposits_count', header: '1ers dépôts', render: (a: AffiliateRow) => a.first_deposits_count },
    { key: 'active_players_count', header: 'Actifs', render: (a: AffiliateRow) => a.active_players_count },
    { key: 'active_codes_count', header: 'Codes', render: (a: AffiliateRow) => a.active_codes_count },
    {
      key: 'total_earned',
      header: 'Gagné',
      render: (a: AffiliateRow) => <span className="font-semibold">{fcfa(a.total_earned)}</span>,
    },
    {
      key: 'available',
      header: 'Disponible',
      render: (a: AffiliateRow) => <span className="font-semibold text-primary-dark">{fcfa(a.available)}</span>,
    },
    {
      key: 'effective_revenue_percent',
      header: 'Revenu %',
      render: (a: AffiliateRow) => (
        <span className="inline-flex items-center gap-1 font-semibold">
          {a.effective_revenue_percent ?? '—'}%
          {a.revenue_share_percent != null && (
            <span
              className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold uppercase text-primary-dark"
              title="Pourcentage propre à cet affilié (override du global)"
            >
              perso
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Inscrit le',
      render: (a: AffiliateRow) => format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr }),
    },
    {
      key: 'actions',
      header: '',
      render: (a: AffiliateRow) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => setDemoTarget(a)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${a.is_demo ? 'bg-violet-500/15 text-violet-500' : 'btn-ghost'}`}>
            Démo
          </button>
          <button onClick={() => setRevenuePercent(a)} className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs">
            % revenu
          </button>
          <button onClick={() => adjustCommission(a)} className="btn-ghost rounded-lg px-2.5 py-1.5 text-xs">
            Ajuster
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Affiliés</h1>
        <p className="text-sm text-text-muted">Programme d'affiliation PlugBet.</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 rounded-xl border border-border/30 bg-surface p-1 w-fit">
        {([
          { key: 'affiliates', label: 'Affiliés' },
          { key: 'codes', label: 'Codes promo' },
          { key: 'withdrawals', label: 'Retraits' },
          { key: 'tickets', label: 'Messagerie' },
          { key: 'marketing', label: 'Marketing' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${
              tab === t.key ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'affiliates' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard title="Affiliés" value={kpis.total} icon={<Handshake className="h-5 w-5" />} variant="green" />
            <StatsCard title="Actifs" value={kpis.active} icon={<Users className="h-5 w-5" />} variant="blue" />
            <StatsCard title="Suspendus / bannis" value={kpis.suspended} icon={<Clock className="h-5 w-5" />} variant="amber" />
            <StatsCard title="Dû (disponible)" value={fcfa(kpis.owed)} icon={<Wallet className="h-5 w-5" />} variant="violet" />
          </div>

          <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <DataTable
                data={rows as unknown as Record<string, unknown>[]}
                columns={columns as never}
                searchPlaceholder="Rechercher un affilié…"
                searchKey="username"
                pageSize={12}
              />
            )}
          </div>
        </>
      )}

      {tab === 'codes' && <AffiliatePromoModeration />}

      {tab === 'withdrawals' && <AffiliateWithdrawals />}

      {tab === 'tickets' && <AffiliateTickets />}

      {tab === 'marketing' && <AffiliateMarketing />}

      {demoTarget && (
        <DemoAffiliateModal
          affiliate={demoTarget}
          onClose={() => setDemoTarget(null)}
          onSuccess={() => { setDemoTarget(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Modal : configuration d'un compte "vitrine" (pub, hors comptabilité) ──
const DEMO_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'available', label: 'Disponible au retrait (FCFA)' },
  { key: 'total_earned', label: 'Total gagné (FCFA)' },
  { key: 'pending', label: 'En attente (FCFA)' },
  { key: 'paid', label: 'Déjà payé (FCFA)' },
  { key: 'signups', label: 'Inscriptions' },
  { key: 'first_deposits', label: '1ers dépôts' },
  { key: 'active_players', label: 'Joueurs actifs (30j)' },
  { key: 'commission_today', label: "Commission aujourd'hui (FCFA)" },
  { key: 'commission_month', label: 'Commission ce mois (FCFA)' },
  { key: 'clicks', label: 'Clics (30j)' },
  { key: 'revenue', label: 'Revenue-share (30j, FCFA)' },
];
const TIERS = ['bronze', 'silver', 'gold', 'diamond', 'vip'] as const;

function DemoAffiliateModal({
  affiliate, onClose, onSuccess,
}: {
  affiliate: AffiliateRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const init = affiliate.demo_data ?? {};
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(DEMO_FIELDS.map((f) => [f.key, init[f.key] != null ? String(init[f.key]) : ''])),
  );
  const [tier, setTier] = useState<string>(affiliate.tier);
  const [wCount, setWCount] = useState<string>('6');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (enable: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data: Record<string, number> = {};
      if (enable) {
        for (const f of DEMO_FIELDS) {
          const raw = (values[f.key] ?? '').trim();
          if (raw === '') continue;
          const n = Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')));
          if (!Number.isFinite(n) || n < 0) throw new Error(`Valeur invalide : ${f.label}`);
          data[f.key] = n;
        }
      }
      const { data: res, error: err } = await supabase.rpc('admin_set_affiliate_demo', {
        p_affiliate_id: affiliate.id,
        p_enabled: enable,
        p_data: data,
        p_tier: enable ? tier : null,
        p_withdrawal_count: enable ? Math.max(0, Math.min(24, parseInt(wCount || '0', 10) || 0)) : 0,
      });
      if (err || res?.success === false) throw new Error(err?.message ?? res?.error ?? 'inconnu');
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border/30 bg-surface-light shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border/20 p-5">
          <h3 className="flex items-center gap-2 font-bold text-text">
            <Megaphone className="h-4 w-4 text-violet-500" /> Compte vitrine (publicité)
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            {affiliate.username ?? affiliate.id} · chiffres fictifs affichés dans SON portail. Aucun argent réel, aucun impact sur la comptabilité.
          </p>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Palier affiché</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm font-semibold text-text focus:border-primary focus:outline-none">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {DEMO_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-[11px] font-medium text-text-muted">{f.label}</label>
                <input type="number" min="0" value={values[f.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-xl border border-border/30 bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-primary focus:outline-none" />
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">Nb de faux retraits « payés » à générer (0–24)</label>
            <input type="number" min="0" max="24" value={wCount}
              onChange={(e) => setWCount(e.target.value)}
              className="w-full rounded-xl border border-border/30 bg-surface px-3 py-2 text-sm font-semibold text-text focus:border-primary focus:outline-none" />
            <p className="mt-1 text-[11px] text-text-muted">Répartis sur les dernières semaines, montant ≈ « Déjà payé » ÷ nombre.</p>
          </div>

          {error && <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{error}</p>}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/20 p-5">
          <button onClick={onClose} className="btn-ghost rounded-xl px-4 py-2 text-sm">Annuler</button>
          {affiliate.is_demo && (
            <button onClick={() => submit(false)} disabled={loading}
              className="rounded-xl bg-danger/10 px-4 py-2 text-sm font-semibold text-danger disabled:opacity-50">
              Désactiver la démo
            </button>
          )}
          <button onClick={() => submit(true)} disabled={loading}
            className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {affiliate.is_demo ? 'Mettre à jour' : 'Activer la démo'}
          </button>
        </div>
      </div>
    </div>
  );
}
