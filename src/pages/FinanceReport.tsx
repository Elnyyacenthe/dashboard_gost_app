import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  FileSpreadsheet, RefreshCw, Loader2, Lock, Search,
  AlertTriangle, CheckCircle2, Clock, AlertCircle,
  Phone, Building2, User, ExternalLink, Download,
  ArrowDownCircle, ArrowUpCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

// ============================================================
// TYPES
// ============================================================

interface FreemoTx {
  id: string;
  user_id: string;
  reference: string;
  external_id: string;
  transaction_type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  payer_or_receiver: string | null;
  message: string | null;
  callback_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface WalletEntry {
  user_id: string;
  delta: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

type Responsible = 'OK' | 'FREEMOPAY' | 'CAISSE_INTERNE' | 'USER' | 'INVESTIGATE';

interface EnrichedTx extends FreemoTx {
  username?: string | null;
  walletEntry?: WalletEntry | null;
  diagnostic: {
    issue: string;
    severity: 'ok' | 'info' | 'warning' | 'critical';
    responsible: Responsible;
    action: string;
  };
}

// ============================================================
// DIAGNOSTIC ENGINE
// ============================================================

function diagnose(tx: FreemoTx, walletEntry: WalletEntry | null | undefined): EnrichedTx['diagnostic'] {
  const ageHours = (Date.now() - new Date(tx.created_at).getTime()) / 3600000;

  // ==== DEPOSITS ====
  if (tx.transaction_type === 'DEPOSIT') {
    if (tx.status === 'SUCCESS') {
      if (walletEntry) {
        return {
          issue: 'Dépôt OK',
          severity: 'ok',
          responsible: 'OK',
          action: 'Aucune action nécessaire',
        };
      } else {
        return {
          issue: '🚨 Dépôt SUCCESS chez Freemopay mais user PAS crédité',
          severity: 'critical',
          responsible: 'CAISSE_INTERNE',
          action: 'Lancer la réconciliation OU créditer manuellement',
        };
      }
    }
    if (tx.status === 'FAILED') {
      return {
        issue: 'User a annulé / timeout MM',
        severity: 'info',
        responsible: 'OK',
        action: 'Aucune action — user n\'a pas payé',
      };
    }
    // PENDING
    if (ageHours > 24) {
      return {
        issue: `PENDING depuis ${Math.round(ageHours)}h sans callback`,
        severity: 'critical',
        responsible: 'FREEMOPAY',
        action: 'Vérifier statut chez Freemopay + lancer reconcile',
      };
    }
    if (ageHours > 1) {
      return {
        issue: `PENDING depuis ${Math.round(ageHours)}h`,
        severity: 'warning',
        responsible: 'FREEMOPAY',
        action: 'Attendre webhook OU lancer reconcile',
      };
    }
    return {
      issue: 'En attente validation user',
      severity: 'info',
      responsible: 'OK',
      action: 'Patienter (max 5 min normal)',
    };
  }

  // ==== WITHDRAWS ====
  if (tx.status === 'SUCCESS') {
    return {
      issue: 'Retrait OK — argent reçu côté user',
      severity: 'ok',
      responsible: 'OK',
      action: 'Aucune action nécessaire',
    };
  }
  if (tx.status === 'FAILED') {
    if (walletEntry && walletEntry.reason.includes('refund')) {
      return {
        issue: 'Retrait FAILED + refund OK',
        severity: 'ok',
        responsible: 'OK',
        action: 'Aucune action — coins recreditees',
      };
    }
    return {
      issue: '🚨 Retrait FAILED MAIS user PAS remboursé',
      severity: 'critical',
      responsible: 'CAISSE_INTERNE',
      action: 'Lancer reconcile OU refunder manuellement',
    };
  }
  // PENDING WITHDRAW
  if (ageHours > 24) {
    return {
      issue: `Retrait PENDING ${Math.round(ageHours)}h — bloqué`,
      severity: 'critical',
      responsible: 'FREEMOPAY',
      action: 'Vérifier chez Freemopay si l\'argent est parti',
    };
  }
  if (ageHours > 1) {
    return {
      issue: `Retrait en cours depuis ${Math.round(ageHours)}h`,
      severity: 'warning',
      responsible: 'FREEMOPAY',
      action: 'Attendre confirmation OU lancer reconcile',
    };
  }
  return {
    issue: 'Retrait en cours',
    severity: 'info',
    responsible: 'OK',
    action: 'Patienter',
  };
}

// ============================================================
// COMPONENT
// ============================================================

const sevColors: Record<EnrichedTx['diagnostic']['severity'], string> = {
  ok: 'bg-success/15 text-success border-success/30',
  info: 'bg-info/15 text-info border-info/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  critical: 'bg-danger/15 text-danger border-danger/30',
};

const respIcons: Record<Responsible, React.ReactNode> = {
  OK: <CheckCircle2 className="h-4 w-4" />,
  FREEMOPAY: <Phone className="h-4 w-4" />,
  CAISSE_INTERNE: <Building2 className="h-4 w-4" />,
  USER: <User className="h-4 w-4" />,
  INVESTIGATE: <AlertCircle className="h-4 w-4" />,
};

const respLabels: Record<Responsible, string> = {
  OK: 'Tout OK',
  FREEMOPAY: 'Contacter Freemopay',
  CAISSE_INTERNE: 'Caisse interne',
  USER: 'Contacter le user',
  INVESTIGATE: 'À investiguer',
};

const respColors: Record<Responsible, string> = {
  OK: 'text-success',
  FREEMOPAY: 'text-info',
  CAISSE_INTERNE: 'text-warning',
  USER: 'text-primary',
  INVESTIGATE: 'text-danger',
};

export default function FinanceReportPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const [txs, setTxs] = useState<EnrichedTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState('');
  const [respFilter, setRespFilter] = useState<Responsible | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'DEPOSIT' | 'WITHDRAW'>('all');
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const [{ data: freemoData }, { data: walletData }, { data: profilesData }] = await Promise.all([
      supabase
        .from('freemopay_transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('wallet_ledger')
        .select('user_id, delta, reason, ref_type, ref_id, created_at, metadata')
        .in('reason', [
          'mobile_money_deposit',
          'mobile_money_withdraw_refund',
          'freemopay_deposit',
        ])
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase
        .from('user_profiles')
        .select('id, username')
        .limit(2000),
    ]);

    const wallet = (walletData ?? []) as WalletEntry[];
    const usernames: Record<string, string> = {};
    (profilesData ?? []).forEach((p: { id: string; username: string | null }) => {
      usernames[p.id] = p.username ?? '?';
    });

    // Index wallet entries par ref_id (= freemopay_tx.id)
    const walletByRefId: Record<string, WalletEntry> = {};
    wallet.forEach(w => {
      if (w.ref_type === 'freemopay_tx' && w.ref_id) {
        walletByRefId[w.ref_id] = w;
      }
    });

    const enriched: EnrichedTx[] = ((freemoData ?? []) as FreemoTx[]).map(tx => {
      const walletEntry = walletByRefId[tx.id] ?? null;
      return {
        ...tx,
        username: usernames[tx.user_id],
        walletEntry,
        diagnostic: diagnose(tx, walletEntry),
      };
    });

    setTxs(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    load();
    const sub = supabase
      .channel('finance-report-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'freemopay_transactions' }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wallet_ledger' }, load)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, [isSuperAdmin, load]);

  const runReconcile = async (dryRun: boolean) => {
    setRunning(true);
    setReconcileResult(null);
    try {
      const url = `/freemopay_reconcile${dryRun ? '?dry_run=1' : ''}`;
      const { data, error } = await supabase.functions.invoke('freemopay_reconcile', {
        body: dryRun ? { dry_run: true } : {},
      });
      if (error) {
        setReconcileResult(`Erreur : ${error.message}. Tu peux aussi appeler manuellement ${url}`);
      } else {
        const r = data as { credited?: number; failed?: number; would_credit?: number; would_fail?: number; mode?: string };
        if (r.mode === 'DRY_RUN') {
          setReconcileResult(`DRY-RUN : ${r.would_credit} seraient créditées, ${r.would_fail} marquées FAILED`);
        } else {
          setReconcileResult(`✅ ${r.credited} créditées, ${r.failed} marquées FAILED`);
          load();
        }
      }
    } catch (e) {
      setReconcileResult(`Exception : ${String(e).slice(0, 100)}`);
    } finally {
      setRunning(false);
      setTimeout(() => setReconcileResult(null), 8000);
    }
  };

  const exportCsv = () => {
    const headers = ['Date', 'Type', 'User', 'Phone', 'Montant', 'Reference', 'Status', 'Wallet', 'Responsable', 'Action'];
    const rows = filtered.map(t => [
      format(new Date(t.created_at), 'yyyy-MM-dd HH:mm', { locale: fr }),
      t.transaction_type,
      t.username ?? t.user_id.slice(0, 8),
      t.payer_or_receiver ?? '',
      String(t.amount),
      t.reference,
      t.status,
      t.walletEntry ? `${t.walletEntry.delta}` : 'PAS_CREDITE',
      respLabels[t.diagnostic.responsible],
      t.diagnostic.action,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport_financier_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stats par responsable
  const stats = useMemo(() => {
    const byResp = { OK: 0, FREEMOPAY: 0, CAISSE_INTERNE: 0, USER: 0, INVESTIGATE: 0 };
    const amounts = { OK: 0, FREEMOPAY: 0, CAISSE_INTERNE: 0, USER: 0, INVESTIGATE: 0 };
    txs.forEach(t => {
      byResp[t.diagnostic.responsible]++;
      amounts[t.diagnostic.responsible] += t.amount;
    });
    return { byResp, amounts };
  }, [txs]);

  const filtered = useMemo(() => {
    return txs
      .filter(t => respFilter === 'all' || t.diagnostic.responsible === respFilter)
      .filter(t => typeFilter === 'all' || t.transaction_type === typeFilter)
      .filter(t => !search ||
        t.username?.toLowerCase().includes(search.toLowerCase()) ||
        t.reference.toLowerCase().includes(search.toLowerCase()) ||
        t.payer_or_receiver?.includes(search) ||
        String(t.amount).includes(search)
      );
  }, [txs, respFilter, typeFilter, search]);

  if (authLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-danger/30 bg-danger/5 p-16 text-center">
        <Lock className="h-12 w-12 text-danger" />
        <div>
          <h2 className="text-xl font-bold text-danger">Accès refusé</h2>
          <p className="mt-2 text-sm text-text-muted">Réservé au super admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold text-text">Rapport Financier</h1>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Mobile Money
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Croisement Freemopay × wallet_ledger × user_profiles. Identifie qui contacter pour chaque problème.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => runReconcile(true)}
            disabled={running}
            className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs font-semibold text-info hover:bg-info/20 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Dry-run reconcile
          </button>
          <button
            onClick={() => runReconcile(false)}
            disabled={running}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Lancer reconcile (réel)
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2 text-xs font-semibold text-text-muted hover:bg-surface-lighter hover:text-text"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={load}
            className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2 text-xs text-text-muted hover:bg-surface-lighter hover:text-text"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>
      </div>

      {reconcileResult && (
        <div className="rounded-xl bg-info/10 border border-info/30 p-3 text-sm text-info">
          {reconcileResult}
        </div>
      )}

      {/* Stats par responsable */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {(['OK', 'FREEMOPAY', 'CAISSE_INTERNE', 'USER', 'INVESTIGATE'] as Responsible[]).map(r => (
          <button
            key={r}
            onClick={() => setRespFilter(respFilter === r ? 'all' : r)}
            className={`text-left rounded-xl border p-4 transition-all ${
              respFilter === r
                ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                : 'border-border/20 bg-surface-light hover:bg-surface-lighter'
            }`}
          >
            <div className={`flex items-center gap-2 ${respColors[r]}`}>
              {respIcons[r]}
              <span className="text-xs font-semibold uppercase">{respLabels[r]}</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-text">{stats.byResp[r]}</p>
            {stats.amounts[r] > 0 && (
              <p className="text-xs text-text-muted">{stats.amounts[r].toLocaleString()} FCFA</p>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="User, ref, tel, montant..."
            className="w-full rounded-lg border border-border/30 bg-surface-light pl-10 pr-4 py-2 text-sm text-text placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-border/30 bg-surface-light p-1">
          {(['all', 'DEPOSIT', 'WITHDRAW'] as const).map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                typeFilter === t ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
              }`}>
              {t === 'all' ? 'Tous' : t === 'DEPOSIT' ? 'Dépôts' : 'Retraits'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-text-muted">{filtered.length} / {txs.length} transactions</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/30 bg-surface-light p-12 text-center">
          <FileSpreadsheet className="mx-auto mb-3 h-10 w-10 text-text-muted/50" />
          <p className="font-semibold text-text">Aucune transaction</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/20 bg-surface-light overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/20 bg-surface">
              <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">User</th>
                <th className="px-3 py-3">Tel</th>
                <th className="px-3 py-3 text-right">Montant</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Wallet</th>
                <th className="px-3 py-3">Diagnostic</th>
                <th className="px-3 py-3">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const sev = sevColors[tx.diagnostic.severity];
                const isDeposit = tx.transaction_type === 'DEPOSIT';
                return (
                  <tr key={tx.id} className={`border-b border-border/10 hover:bg-surface-lighter ${
                    tx.diagnostic.severity === 'critical' ? 'bg-danger/5' : ''
                  }`}>
                    <td className="px-3 py-2.5 text-xs text-text-muted whitespace-nowrap">
                      {format(new Date(tx.created_at), 'dd/MM HH:mm', { locale: fr })}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isDeposit ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                      }`}>
                        {isDeposit ? <ArrowDownCircle className="h-3 w-3" /> : <ArrowUpCircle className="h-3 w-3" />}
                        {isDeposit ? 'DÉPÔT' : 'RETRAIT'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-text font-medium">{tx.username ?? tx.user_id.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 text-xs text-text-muted font-mono">{tx.payer_or_receiver ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${
                      isDeposit ? 'text-success' : 'text-warning'
                    }`}>
                      {isDeposit ? '+' : '−'}{tx.amount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        tx.status === 'SUCCESS' ? 'bg-success/15 text-success' :
                        tx.status === 'FAILED' ? 'bg-danger/15 text-danger' :
                        'bg-warning/15 text-warning'
                      }`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {tx.walletEntry ? (
                        <span className="text-success">✓ crédité</span>
                      ) : tx.transaction_type === 'WITHDRAW' && tx.status === 'SUCCESS' ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <span className="text-danger">✗ pas crédité</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${sev}`}>
                        {tx.diagnostic.issue}
                      </span>
                      <p className="mt-0.5 text-[11px] text-text-muted">{tx.diagnostic.action}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${respColors[tx.diagnostic.responsible]}`}>
                        {respIcons[tx.diagnostic.responsible]}
                        {respLabels[tx.diagnostic.responsible]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Légende */}
      <div className="rounded-xl border border-border/20 bg-surface-light p-4 text-xs text-text-muted space-y-2">
        <p className="font-semibold text-text">📖 Légende des responsables</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-success mt-0.5" />
            <div>
              <strong className="text-success">Tout OK</strong> — la transaction est cohérente, aucune action.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Phone className="h-4 w-4 text-info mt-0.5" />
            <div>
              <strong className="text-info">Contacter Freemopay</strong> — le webhook n'arrive pas. Vérifier sur leur dashboard, ou lancer reconcile pour interroger leur API.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Building2 className="h-4 w-4 text-warning mt-0.5" />
            <div>
              <strong className="text-warning">Caisse interne</strong> — Freemopay a fait son taf, mais notre wallet n'a pas reflété. Lancer reconcile suffit.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <User className="h-4 w-4 text-primary mt-0.5" />
            <div>
              <strong className="text-primary">Contacter le user</strong> — un user dit qu'il a payé mais Freemopay dit qu'il n'a rien fait, demander preuve de paiement.
            </div>
          </div>
        </div>
        <p className="pt-2 border-t border-border/20">
          <strong className="text-text">Lien rapide</strong> :
          <a href="https://app.freemopay.com" target="_blank" rel="noreferrer"
             className="ml-2 inline-flex items-center gap-1 text-info hover:underline">
            Dashboard Freemopay <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}

// Re-export Clock icon used in some severity displays
export { Clock, AlertTriangle };
