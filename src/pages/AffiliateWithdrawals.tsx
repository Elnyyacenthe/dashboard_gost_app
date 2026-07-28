// ============================================================
// AffiliateWithdrawals — modération des retraits (admin)
// ============================================================
// Liste des demandes de retrait + actions auditées (valider / refuser /
// marquer payé) via admin_decide_withdrawal. Notifie l'affilié.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check, X, BadgeCheck } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import DataTable from '../components/DataTable';

interface WithdrawalRow {
  id: string;
  affiliate_id: string;
  amount: number;
  method: 'orange_money' | 'mtn_money' | 'wave' | 'crypto';
  account_holder: string;
  account_number: string;
  status: 'pending' | 'validated' | 'refused' | 'paid';
  reference: string | null;
  requested_at: string;
  decision_reason: string | null;
  paid_at: string | null;
  username: string | null;
  email: string | null;
}

const methodLabel: Record<WithdrawalRow['method'], string> = {
  orange_money: 'Orange Money',
  mtn_money: 'MTN Money',
  wave: 'Wave',
  crypto: 'Crypto',
};
const statusBadge: Record<WithdrawalRow['status'], string> = {
  pending: 'badge-warning',
  validated: 'badge-info',
  refused: 'badge-danger',
  paid: 'badge-success',
};
const statusLabel: Record<WithdrawalRow['status'], string> = {
  pending: 'En attente',
  validated: 'Validé',
  refused: 'Refusé',
  paid: 'Payé',
};
const fcfa = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} FCFA`;

const FILTERS = [
  { key: 'pending', label: 'En attente' },
  { key: 'validated', label: 'Validés' },
  { key: 'paid', label: 'Payés' },
  { key: 'refused', label: 'Refusés' },
  { key: 'all', label: 'Tous' },
];

export default function AffiliateWithdrawals() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_affiliate_withdrawals_view')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) console.error('load withdrawals:', error.message);
    if (data) setRows(data as WithdrawalRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );
  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows]);

  const decide = async (row: WithdrawalRow, action: 'validate' | 'refuse' | 'mark_paid') => {
    let reason: string | null = null;
    let reference: string | null = null;
    if (action === 'refuse') {
      reason = window.prompt("Motif du refus (visible par l'affilié) :");
      if (reason === null) return;
    } else if (action === 'mark_paid') {
      reference = window.prompt('Référence de paiement (optionnel) :', '');
      if (reference === null) return;
    } else if (action === 'validate') {
      if (!window.confirm(`Valider le retrait de ${fcfa(row.amount)} pour ${row.username ?? ''} ?`)) return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_decide_withdrawal', {
      p_id: row.id,
      p_action: action,
      p_reason: reason,
      p_reference: reference,
    });
    setBusy(false);
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
      render: (r: WithdrawalRow) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{r.username ?? '—'}</p>
          <p className="truncate text-xs text-text-muted">{r.email ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      render: (r: WithdrawalRow) => <span className="font-bold text-text">{fcfa(r.amount)}</span>,
    },
    {
      key: 'method',
      header: 'Méthode',
      render: (r: WithdrawalRow) => (
        <div className="min-w-0">
          <p className="text-sm text-text">{methodLabel[r.method]}</p>
          <p className="truncate text-xs text-text-muted">{r.account_holder} · {r.account_number}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      render: (r: WithdrawalRow) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusBadge[r.status]}`}>
          {statusLabel[r.status]}
        </span>
      ),
    },
    {
      key: 'requested_at',
      header: 'Demandé le',
      render: (r: WithdrawalRow) => format(new Date(r.requested_at), 'dd/MM/yyyy', { locale: fr }),
    },
    {
      key: 'actions',
      header: '',
      render: (r: WithdrawalRow) => (
        <div className="flex justify-end gap-1.5">
          {r.status === 'pending' && (
            <>
              <button
                onClick={() => decide(r, 'validate')}
                disabled={busy}
                className="btn-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Valider
              </button>
              <button
                onClick={() => decide(r, 'refuse')}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg bg-danger px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Refuser
              </button>
            </>
          )}
          {r.status === 'validated' && (
            <button
              onClick={() => decide(r, 'mark_paid')}
              disabled={busy}
              className="btn-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-50"
            >
              <BadgeCheck className="h-3.5 w-3.5" /> Marquer payé
            </button>
          )}
          {(r.status === 'paid' || r.status === 'refused') && (
            <span className="text-xs text-text-muted">{r.reference ?? r.decision_reason ?? '—'}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              filter === f.key ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            {f.label}
            {f.key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border/30 bg-surface-light p-6">
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <DataTable
            data={filtered as unknown as Record<string, unknown>[]}
            columns={columns as never}
            searchPlaceholder="Rechercher un affilié…"
            searchKey="username"
            pageSize={12}
          />
        )}
      </div>
    </div>
  );
}
