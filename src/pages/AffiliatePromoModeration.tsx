// ============================================================
// AffiliatePromoModeration — modération des codes promo (admin)
// ============================================================
// Liste des demandes/codes + fiche détaillée + actions auditées
// (approuver/modifier, refuser, suspendre, réactiver, demander infos)
// via la RPC admin_decide_promo_code. Notifie l'affilié automatiquement.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check, X, Ban, RotateCcw, HelpCircle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import DataTable from '../components/DataTable';

interface PromoRow {
  id: string;
  affiliate_id: string;
  code: string;
  status: 'pending' | 'active' | 'refused' | 'suspended';
  reason: string | null;
  usage_location: string | null;
  followers_count: number | null;
  socials: Record<string, unknown> | null;
  website: string | null;
  promo_plan: string | null;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  username: string | null;
  email: string | null;
  users_count: number;
}

type DecideAction = 'approve' | 'refuse' | 'suspend' | 'reactivate' | 'request_info';

const statusBadge: Record<PromoRow['status'], string> = {
  active: 'badge-success',
  pending: 'badge-warning',
  refused: 'badge-danger',
  suspended: 'badge-neutral',
};
const statusLabel: Record<PromoRow['status'], string> = {
  active: 'Actif',
  pending: 'En attente',
  refused: 'Refusé',
  suspended: 'Suspendu',
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'pending', label: 'En attente' },
  { key: 'active', label: 'Actifs' },
  { key: 'suspended', label: 'Suspendus' },
  { key: 'refused', label: 'Refusés' },
  { key: 'all', label: 'Tous' },
];

export default function AffiliatePromoModeration() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<PromoRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('admin_affiliate_promo_codes_view')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('load promo codes:', error.message);
    if (data) setRows(data as PromoRow[]);
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

  const decide = async (row: PromoRow, action: DecideAction) => {
    let newCode: string | null = null;
    let reason: string | null = null;

    if (action === 'approve') {
      const input = window.prompt(`Code à activer (laisser tel quel pour garder « ${row.code} ») :`, row.code);
      if (input === null) return;
      newCode = input.trim() === '' ? null : input.trim();
    } else if (action === 'refuse') {
      reason = window.prompt("Motif du refus (visible par l'affilié) :");
      if (reason === null) return;
    } else if (action === 'suspend') {
      reason = window.prompt('Motif de la suspension :');
      if (reason === null) return;
    } else if (action === 'request_info') {
      reason = window.prompt("Quelles informations demander à l'affilié ?");
      if (!reason) return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc('admin_decide_promo_code', {
      p_id: row.id,
      p_action: action,
      p_new_code: newCode,
      p_reason: reason,
    });
    setBusy(false);
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    setSelected(null);
    await load();
  };

  const columns = [
    {
      key: 'code',
      header: 'Code',
      render: (r: PromoRow) => <span className="font-bold text-text">{r.code}</span>,
    },
    {
      key: 'username',
      header: 'Affilié',
      render: (r: PromoRow) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text">{r.username ?? '—'}</p>
          <p className="truncate text-xs text-text-muted">{r.email ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      render: (r: PromoRow) => (
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusBadge[r.status]}`}>
          {statusLabel[r.status]}
        </span>
      ),
    },
    { key: 'users_count', header: 'Utilisateurs', render: (r: PromoRow) => r.users_count },
    {
      key: 'created_at',
      header: 'Demandé le',
      render: (r: PromoRow) => format(new Date(r.created_at), 'dd/MM/yyyy', { locale: fr }),
    },
    {
      key: 'actions',
      header: '',
      render: (r: PromoRow) => (
        <button
          onClick={() => setSelected(r)}
          className="btn-ghost rounded-lg px-3 py-1.5 text-xs"
        >
          Examiner
        </button>
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
            searchPlaceholder="Rechercher un code ou un affilié…"
            searchKey="code"
            pageSize={12}
          />
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="animate-fade-in w-full max-w-lg rounded-2xl border border-border/30 bg-surface-light shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/20 p-5">
              <div>
                <p className="text-lg font-black text-text">{selected.code}</p>
                <p className="text-xs text-text-muted">
                  {selected.username} · {selected.email}
                </p>
              </div>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusBadge[selected.status]}`}>
                {statusLabel[selected.status]}
              </span>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5 text-sm">
              <Detail label="Pourquoi ce code ?" value={selected.reason} />
              <Detail label="Où sera-t-il utilisé ?" value={selected.usage_location} />
              <Detail label="Followers" value={selected.followers_count?.toLocaleString('fr-FR') ?? null} />
              <Detail
                label="Réseaux sociaux"
                value={selected.socials && typeof selected.socials.text === 'string' ? (selected.socials.text as string) : null}
              />
              {selected.website && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Site web</p>
                  <a
                    href={selected.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary-dark hover:underline"
                  >
                    {selected.website} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}
              <Detail label="Stratégie de promotion" value={selected.promo_plan} />
              {selected.decision_reason && <Detail label="Dernière note" value={selected.decision_reason} />}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border/20 p-4">
              {selected.status === 'pending' && (
                <button
                  onClick={() => decide(selected, 'request_info')}
                  disabled={busy}
                  className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  <HelpCircle className="h-4 w-4" /> Demander infos
                </button>
              )}
              {(selected.status === 'pending' || selected.status === 'refused') && (
                <button
                  onClick={() => decide(selected, 'approve')}
                  disabled={busy}
                  className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  <Check className="h-4 w-4" /> Approuver / modifier
                </button>
              )}
              {selected.status === 'pending' && (
                <button
                  onClick={() => decide(selected, 'refuse')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <X className="h-4 w-4" /> Refuser
                </button>
              )}
              {selected.status === 'active' && (
                <button
                  onClick={() => decide(selected, 'suspend')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-warning px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  <Ban className="h-4 w-4" /> Suspendre
                </button>
              )}
              {selected.status === 'suspended' && (
                <button
                  onClick={() => decide(selected, 'reactivate')}
                  disabled={busy}
                  className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" /> Réactiver
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className="text-text">{value}</p>
    </div>
  );
}
