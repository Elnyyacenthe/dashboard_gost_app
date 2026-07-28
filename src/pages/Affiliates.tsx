// ============================================================
// Affiliates — module Affiliés (dashboard admin)
// ============================================================
// Phase 0 : liste + KPIs des affiliés (lecture de admin_affiliates_view).
// Les actions d'administration (approuver/refuser un code, valider un
// retrait, suspendre/bannir, répondre aux tickets) arrivent aux phases
// suivantes via des RPC affiliate_*/admin_* dédiées.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Lock, Handshake, Users, Clock, Wallet } from 'lucide-react';
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

  const columns = [
    {
      key: 'username',
      header: 'Affilié',
      render: (a: AffiliateRow) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-text">{a.username ?? '—'}</p>
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
      key: 'created_at',
      header: 'Inscrit le',
      render: (a: AffiliateRow) => format(new Date(a.created_at), 'dd/MM/yyyy', { locale: fr }),
    },
    {
      key: 'actions',
      header: '',
      render: (a: AffiliateRow) => (
        <div className="flex justify-end">
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
    </div>
  );
}
