// ============================================================
// TicketLookup — Composant admin pour charger un ticket par code
// ============================================================
// Cas d'usage : support client recoit une plainte du joueur,
// charge le ticket via son code (8 derniers chars de l'UUID) pour
// diagnostiquer (statut, scores, mouvements wallet associés).
//
// Source : RPC admin_lookup_bet (acces restreint admin/super_admin)
// ============================================================

import { useState } from 'react';
import { Search, Copy, RefreshCw, AlertCircle, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Selection {
  id: string;
  match_id: string;
  match_label: string;
  market_code: string;
  market_label: string;
  odds: number;
  selection_status: 'pending' | 'won' | 'lost' | 'void';
  is_virtual: boolean;
  is_live: boolean;
  final_home_score: number | null;
  final_away_score: number | null;
  created_at: string;
}

interface WalletEntry {
  id: number;
  type: string;
  amount: number;
  request_id: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface BetLookupResult {
  found: boolean;
  id?: string;
  short_id?: string;
  bet_type?: 'simple' | 'combine';
  stake?: number;
  total_odds?: number;
  potential_payout?: number;
  status?: 'pending' | 'won' | 'lost' | 'void' | 'cashed_out' | 'refunded';
  actual_payout?: number | null;
  is_virtual?: boolean;
  created_at?: string;
  settled_at?: string | null;
  request_id?: string;
  owner?: {
    user_id: string;
    username: string | null;
    current_balance: number;
  };
  selections?: Selection[];
  wallet_history?: WalletEntry[];
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-500/15 text-yellow-400 border-yellow-500/40',
  won:        'bg-green-500/15 text-green-400 border-green-500/40',
  lost:       'bg-red-500/15 text-red-400 border-red-500/40',
  void:       'bg-purple-500/15 text-purple-400 border-purple-500/40',
  refunded:   'bg-purple-500/15 text-purple-400 border-purple-500/40',
  cashed_out: 'bg-blue-500/15 text-blue-400 border-blue-500/40',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En cours', won: 'Gagné', lost: 'Perdu',
  void: 'Annulé', refunded: 'Remboursé', cashed_out: 'Encaissé',
};

export default function TicketLookup() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BetLookupResult | null>(null);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = code.trim().replace(/[#-]/g, '');
    if (cleaned.length < 6) {
      setError('Le code doit faire au moins 6 caractères.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase
        .rpc('admin_lookup_bet', { p_code: cleaned });
      if (rpcErr) throw rpcErr;
      if (!data || data.found === false) {
        setResult(null);
        setError(`Aucun ticket trouvé pour le code "${code}".`);
      } else {
        setResult(data as BetLookupResult);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('FORBIDDEN')) {
        setError('Accès refusé. Réservé aux administrateurs.');
      } else if (msg.includes('TOO_SHORT')) {
        setError('Le code doit faire au moins 6 caractères.');
      } else {
        setError(`Erreur : ${msg}`);
      }
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      <div className="exec-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-5 w-5 text-[#7CCD3F]" />
          <h3 className="text-white text-base font-extrabold">Charger un ticket par code</h3>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Utilise le code court d'un coupon (ex: <code className="bg-black/30 px-1 rounded">BC9B7030</code>)
          pour charger un ticket et diagnostiquer rapidement un soucis client.
        </p>
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BC9B7030"
            maxLength={40}
            className="exec-input flex-1 font-mono tracking-wider"
          />
          <button
            type="submit"
            disabled={loading || code.trim().length < 6}
            className="exec-btn-primary px-4 flex items-center gap-2"
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Charger
          </button>
        </form>
        {error && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/40 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span className="text-red-300 text-sm">{error}</span>
          </div>
        )}
      </div>

      {result && result.found && (
        <div className="exec-card p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-white/50 font-bold">TICKET</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xl text-white font-black font-mono">
                  #{result.short_id}
                </span>
                <button
                  onClick={() => copyToClipboard(result.id ?? '')}
                  className="text-white/40 hover:text-white"
                  title="Copier l'UUID complet"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-xs text-white/50 mt-1">
                Créé {result.created_at ? new Date(result.created_at).toLocaleString('fr-FR') : '—'}
                {result.settled_at && ` · Réglé ${new Date(result.settled_at).toLocaleString('fr-FR')}`}
              </div>
            </div>
            <span className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border ${STATUS_COLORS[result.status ?? 'pending']}`}>
              {STATUS_LABELS[result.status ?? 'pending']}
            </span>
          </div>

          {/* Owner */}
          {result.owner && (
            <div className="bg-black/20 p-3 rounded-lg flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7CCD3F]/15 text-[#7CCD3F] font-extrabold">
                {result.owner.username?.charAt(0).toUpperCase() ?? '?'}
              </div>
              <div className="flex-1">
                <div className="text-white font-bold text-sm">
                  {result.owner.username ?? 'Sans nom'}
                </div>
                <div className="text-white/50 text-xs font-mono flex items-center gap-2">
                  {result.owner.user_id.slice(0, 8)}...{result.owner.user_id.slice(-4)}
                  <button onClick={() => copyToClipboard(result.owner?.user_id ?? '')}>
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-white/50 font-bold">Solde actuel</div>
                <div className="text-base text-white font-extrabold">
                  {result.owner.current_balance?.toLocaleString('fr-FR')} F
                </div>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="TYPE" value={result.bet_type === 'combine' ? `Combiné ${result.selections?.length ?? 0}` : 'Simple'} />
            <Stat label="MISE" value={`${result.stake} F`} />
            <Stat label="COTE" value={`×${result.total_odds?.toFixed(2)}`} accent="yellow" />
            <Stat
              label={result.status === 'won' ? 'GAIN' : 'GAIN POT.'}
              value={`${result.actual_payout ?? result.potential_payout} F`}
              accent={result.status === 'won' ? 'green' : undefined}
            />
          </div>

          {/* Selections */}
          <div>
            <div className="text-xs text-white/50 font-bold mb-2">
              SÉLECTIONS ({result.selections?.length ?? 0})
            </div>
            <div className="space-y-2">
              {(result.selections ?? []).map((s) => (
                <div key={s.id} className="bg-black/20 p-3 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-bold text-sm truncate">
                        {s.match_label}
                      </div>
                      <div className="text-white/60 text-xs mt-0.5">
                        {s.market_label}
                      </div>
                      {s.final_home_score != null && s.final_away_score != null && (
                        <div className="mt-1.5 inline-block px-2 py-0.5 bg-white/10 rounded text-xs font-mono font-bold text-white/80">
                          Score : {s.final_home_score} – {s.final_away_score}
                        </div>
                      )}
                      <div className="text-white/40 text-xs mt-1 font-mono">
                        match_id : {s.match_id}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-yellow-400 font-extrabold">×{s.odds.toFixed(2)}</div>
                      <span className={`mt-1 inline-block px-2 py-0.5 rounded text-[10px] font-extrabold border ${STATUS_COLORS[s.selection_status]}`}>
                        {STATUS_LABELS[s.selection_status]}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Wallet history */}
          {result.wallet_history && result.wallet_history.length > 0 && (
            <div>
              <div className="text-xs text-white/50 font-bold mb-2">
                MOUVEMENTS WALLET LIÉS ({result.wallet_history.length})
              </div>
              <div className="overflow-x-auto bg-black/20 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/40 text-left">
                      <th className="py-2 px-3 font-bold">DATE</th>
                      <th className="py-2 px-3 font-bold">TYPE</th>
                      <th className="py-2 px-3 font-bold text-right">MONTANT</th>
                      <th className="py-2 px-3 font-bold">REQUEST_ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.wallet_history.map((w) => (
                      <tr key={w.id} className="border-t border-white/5">
                        <td className="py-2 px-3 text-white/70 font-mono">
                          {new Date(w.created_at).toLocaleString('fr-FR')}
                        </td>
                        <td className="py-2 px-3">
                          <span className="text-white font-bold">{w.type}</span>
                        </td>
                        <td className={`py-2 px-3 text-right font-extrabold ${w.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {w.amount >= 0 ? '+' : ''}{w.amount} F
                        </td>
                        <td className="py-2 px-3 text-white/50 font-mono text-[11px]">
                          {w.request_id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Liens directs */}
          <div className="flex gap-2 pt-2 border-t border-white/10">
            {result.owner && (
              <a
                href={`/dashboard/users/${result.owner.user_id}`}
                className="exec-btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
              >
                <ExternalLink className="h-3 w-3" />
                Profil utilisateur
              </a>
            )}
            {result.request_id && (
              <button
                onClick={() => copyToClipboard(result.request_id ?? '')}
                className="exec-btn-secondary text-xs px-3 py-1.5 flex items-center gap-2"
              >
                <Copy className="h-3 w-3" />
                Copier request_id
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'yellow' }) {
  const color = accent === 'green' ? 'text-green-400' : accent === 'yellow' ? 'text-yellow-400' : 'text-white';
  return (
    <div className="bg-black/20 p-2 rounded-lg">
      <div className="text-[10px] text-white/40 font-bold">{label}</div>
      <div className={`text-sm font-extrabold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
