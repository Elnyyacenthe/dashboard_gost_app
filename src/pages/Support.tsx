import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare, Send, X, CheckCheck, Clock, AlertCircle,
  Search, RefreshCw, Tag, User, Inbox, ChevronRight, Loader2,
  ExternalLink, Coins,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import type { SupportTicket, SupportMessage, TicketStatus, TicketCategory } from '../types';

// ── Config visuels ──────────────────────────────────────────────────────────

const statusCfg: Record<TicketStatus, { label: string; color: string; icon: React.ReactNode }> = {
  open:     { label: 'Ouvert',   color: 'bg-info/15 text-info',       icon: <Clock className="h-3 w-3" /> },
  answered: { label: 'Répondu', color: 'bg-warning/15 text-warning',  icon: <CheckCheck className="h-3 w-3" /> },
  closed:   { label: 'Fermé',   color: 'bg-surface-lighter text-text-muted', icon: <X className="h-3 w-3" /> },
};

const catCfg: Record<TicketCategory, { label: string; color: string }> = {
  general:  { label: 'Général',  color: 'bg-surface-lighter text-text-muted' },
  paiement: { label: 'Paiement', color: 'bg-success/15 text-success' },
  compte:   { label: 'Compte',   color: 'bg-primary/15 text-primary' },
  jeu:      { label: 'Jeu',      color: 'bg-info/15 text-info' },
  bug:      { label: 'Bug',      color: 'bg-danger/15 text-danger' },
};

function StatusBadge({ status }: { status: TicketStatus }) {
  const cfg = statusCfg[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function CatBadge({ category }: { category: TicketCategory }) {
  const cfg = catCfg[category];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.color}`}>
      <Tag className="h-2.5 w-2.5" /> {cfg.label}
    </span>
  );
}

// ── Page principale ─────────────────────────────────────────────────────────

type StatusFilter = 'all' | TicketStatus;

export default function SupportPage() {
  const { profile } = useAuth();

  const [tickets, setTickets]           = useState<SupportTicket[]>([]);
  const [messages, setMessages]         = useState<SupportMessage[]>([]);
  const [selectedTicket, setSelected]   = useState<SupportTicket | null>(null);
  const [loadingTickets, setLoadingT]   = useState(true);
  const [loadingMessages, setLoadingM]  = useState(false);
  const [reply, setReply]               = useState('');
  const [sending, setSending]           = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch]             = useState('');
  const [showRefund, setShowRefund]     = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const realtimeSub = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Fetch tickets ─────────────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    setLoadingT(true);
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('fetchTickets error:', error.message);
      // Probablement un problème RLS – voir note dans la page
    }
    setTickets((data as SupportTicket[]) ?? []);
    setLoadingT(false);
  }, []);

  // ── Fetch messages d'un ticket ────────────────────────────────────────────
  const fetchMessages = useCallback(async (ticketId: string) => {
    setLoadingM(true);
    const { data } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    setMessages((data as SupportMessage[]) ?? []);
    setLoadingM(false);
  }, []);

  // ── Sélectionner un ticket ────────────────────────────────────────────────
  const selectTicket = useCallback(async (ticket: SupportTicket) => {
    setSelected(ticket);
    await fetchMessages(ticket.id);

    // Marquer comme lu par l'admin
    if (ticket.unread_admin) {
      await supabase
        .from('support_tickets')
        .update({ unread_admin: false })
        .eq('id', ticket.id);
      setTickets(prev =>
        prev.map(t => t.id === ticket.id ? { ...t, unread_admin: false } : t)
      );
    }
  }, [fetchMessages]);

  // ── Envoyer une réponse admin ─────────────────────────────────────────────
  const sendReply = async () => {
    if (!reply.trim() || !selectedTicket || sending) return;
    setSending(true);
    const { error } = await supabase.from('support_messages').insert({
      ticket_id: selectedTicket.id,
      sender_id: profile?.id ?? null,
      is_admin:  true,
      content:   reply.trim(),
    });
    if (!error) {
      setReply('');
      await fetchMessages(selectedTicket.id);
      setSelected(prev => prev ? { ...prev, status: prev.status === 'closed' ? 'closed' : 'answered', unread_admin: false } : null);
      setTickets(prev =>
        prev.map(t => t.id === selectedTicket.id
          ? { ...t, status: t.status === 'closed' ? 'closed' : 'answered', unread_admin: false, updated_at: new Date().toISOString() }
          : t
        )
      );
    }
    setSending(false);
  };

  // ── Changer le statut ─────────────────────────────────────────────────────
  const changeStatus = async (ticketId: string, status: TicketStatus) => {
    await supabase.from('support_tickets').update({ status }).eq('id', ticketId);
    setSelected(prev => prev?.id === ticketId ? { ...prev, status } : prev);
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status } : t));
  };

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    realtimeSub.current = supabase
      .channel('support-admin')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_tickets' },
        () => fetchTickets()
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_tickets' },
        payload => {
          const updated = payload.new as SupportTicket;
          setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
          setSelected(prev => prev?.id === updated.id ? updated : prev);
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages' },
        payload => {
          const msg = payload.new as SupportMessage;
          if (selectedTicket?.id === msg.ticket_id) {
            setMessages(prev => [...prev, msg]);
          }
          if (!msg.is_admin) {
            setTickets(prev =>
              prev.map(t => t.id === msg.ticket_id ? { ...t, unread_admin: true, updated_at: new Date().toISOString() } : t)
            );
          }
        }
      )
      .subscribe();

    return () => { realtimeSub.current?.unsubscribe(); };
  }, [fetchTickets, selectedTicket?.id]);

  // ── Scroll bas auto ───────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // ── Filtres ───────────────────────────────────────────────────────────────
  const filtered = tickets.filter(t => {
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    const matchSearch = !search ||
      t.username.toLowerCase().includes(search.toLowerCase()) ||
      t.subject.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const counts: Record<StatusFilter, number> = {
    all:      tickets.length,
    open:     tickets.filter(t => t.status === 'open').length,
    answered: tickets.filter(t => t.status === 'answered').length,
    closed:   tickets.filter(t => t.status === 'closed').length,
  };

  const unreadCount = tickets.filter(t => t.unread_admin).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0 overflow-hidden rounded-2xl border border-border/20 bg-surface-light animate-fade-in">

      {/* ── Panneau gauche : liste tickets ── */}
      <div className="flex w-80 shrink-0 flex-col border-r border-border/20">

        {/* Header gauche */}
        <div className="border-b border-border/20 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h2 className="font-bold text-text">Service Client</h2>
              {unreadCount > 0 && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <button onClick={fetchTickets} title="Rafraîchir"
              className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted/60" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              className="w-full rounded-xl border border-border/30 bg-surface py-2 pl-8 pr-3 text-xs text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none transition-colors"
            />
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 text-xs">
            {(['all', 'open', 'answered', 'closed'] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`flex-1 rounded-lg py-1.5 font-medium transition-all ${
                  statusFilter === s ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-lighter'
                }`}>
                {s === 'all' ? 'Tous' : statusCfg[s as TicketStatus].label}
                <span className={`ml-1 rounded-full px-1 text-[10px] font-bold ${
                  statusFilter === s ? 'bg-white/20' : 'bg-surface-lighter'
                }`}>
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto">
          {loadingTickets ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
              <Inbox className="h-8 w-8 text-text-muted/40" />
              <p className="text-sm font-medium text-text-muted">Aucun ticket</p>
              {tickets.length === 0 && (
                <p className="text-xs text-text-muted/60 leading-snug">
                  Assurez-vous d'avoir les bonnes politiques RLS Supabase pour les admins.
                </p>
              )}
            </div>
          ) : (
            filtered.map(ticket => (
              <button
                key={ticket.id}
                onClick={() => selectTicket(ticket)}
                className={`w-full border-b border-border/10 p-4 text-left transition-colors hover:bg-surface-lighter ${
                  selectedTicket?.id === ticket.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {ticket.unread_admin && (
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-danger" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3 w-3 text-text-muted shrink-0" />
                        <p className="truncate text-xs font-semibold text-text">{ticket.username}</p>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">{ticket.subject}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted/40 mt-1" />
                </div>
                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                  <StatusBadge status={ticket.status} />
                  <CatBadge category={ticket.category} />
                </div>
                <p className="mt-1.5 text-[10px] text-text-muted/60">
                  {formatDistanceToNow(new Date(ticket.updated_at), { addSuffix: true, locale: fr })}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Panneau droit : chat ── */}
      {selectedTicket ? (
        <div className="flex flex-1 flex-col min-w-0">

          {/* Header chat */}
          <div className="flex items-center justify-between border-b border-border/20 px-5 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-text truncate">{selectedTicket.subject}</p>
                <StatusBadge status={selectedTicket.status} />
                <CatBadge category={selectedTicket.category} />
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <User className="h-3 w-3 text-text-muted" />
                <Link
                  to={`/dashboard/users/${selectedTicket.user_id}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                  title="Ouvrir la fiche 360 du joueur"
                >
                  {selectedTicket.username} <ExternalLink className="h-2.5 w-2.5" />
                </Link>
                <span className="text-xs text-text-muted">
                  · créé le {format(new Date(selectedTicket.created_at), 'dd MMM yyyy à HH:mm', { locale: fr })}
                </span>
              </div>
            </div>

            {/* Boutons statut */}
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <button
                type="button"
                onClick={() => setShowRefund(true)}
                className="flex items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/15 transition-colors"
                title="Émettre un remboursement"
              >
                <Coins className="h-3 w-3" /> Refund
              </button>
              {selectedTicket.status !== 'closed' && (
                <button
                  type="button"
                  onClick={() => changeStatus(selectedTicket.id, 'closed')}
                  className="flex items-center gap-1.5 rounded-xl border border-border/30 px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-lighter transition-colors"
                >
                  <X className="h-3 w-3" /> Fermer
                </button>
              )}
              {selectedTicket.status === 'closed' && (
                <button
                  type="button"
                  onClick={() => changeStatus(selectedTicket.id, 'open')}
                  className="flex items-center gap-1.5 rounded-xl border border-border/30 px-3 py-1.5 text-xs font-medium text-info hover:bg-info/10 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> Rouvrir
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <MessageSquare className="h-8 w-8 text-text-muted/30" />
                <p className="text-sm text-text-muted">Aucun message dans ce ticket</p>
              </div>
            ) : (
              messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.is_admin ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] space-y-1 ${msg.is_admin ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`flex items-center gap-2 text-xs ${msg.is_admin ? 'flex-row-reverse' : ''}`}>
                      <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                        msg.is_admin ? 'bg-primary/20 text-primary' : 'bg-surface-lighter text-text-muted'
                      }`}>
                        {msg.is_admin ? 'A' : (selectedTicket.username?.[0]?.toUpperCase() ?? 'U')}
                      </div>
                      <span className="text-text-muted/60">
                        {msg.is_admin ? 'Admin' : selectedTicket.username}
                      </span>
                    </div>
                    <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.is_admin
                        ? 'rounded-tr-sm bg-primary text-white'
                        : 'rounded-tl-sm bg-surface border border-border/20 text-text'
                    }`}>
                      {msg.content}
                    </div>
                    <p className="text-[10px] text-text-muted/50 px-1">
                      {format(new Date(msg.created_at), 'dd MMM HH:mm', { locale: fr })}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Zone de réponse */}
          <div className="border-t border-border/20 p-4">
            {selectedTicket.status === 'closed' ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm text-text-muted">
                <AlertCircle className="h-4 w-4" />
                Ce ticket est fermé. Rouvrez-le pour répondre.
              </div>
            ) : (
              <div className="flex gap-3">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
                  placeholder="Répondre au joueur… (Ctrl+Entrée pour envoyer)"
                  rows={3}
                  className="flex-1 resize-none rounded-xl border border-border/30 bg-surface px-4 py-3 text-sm text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                />
                <button
                  onClick={sendReply}
                  disabled={!reply.trim() || sending}
                  className="flex items-center gap-2 self-end rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Envoyer
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* État vide */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-lighter">
            <MessageSquare className="h-8 w-8 text-text-muted/40" />
          </div>
          <div>
            <p className="font-semibold text-text">Sélectionne un ticket</p>
            <p className="text-sm text-text-muted">pour voir la conversation</p>
          </div>
        </div>
      )}

      {showRefund && selectedTicket && (
        <RefundModal
          ticket={selectedTicket}
          onClose={() => setShowRefund(false)}
          onSuccess={() => { setShowRefund(false); fetchTickets(); }}
        />
      )}
    </div>
  );
}

// ─── Refund modal ───────────────────────────────────────────────────────
function RefundModal({ ticket, onClose, onSuccess }: {
  ticket: SupportTicket;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [gameId, setGameId] = useState('');
  const [reason, setReason] = useState(`Refund suite ticket: ${ticket.subject}`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const n = parseInt(amount, 10);
    if (isNaN(n) || n <= 0) { setError('Montant invalide'); return; }
    if (reason.trim().length < 3) { setError('Raison obligatoire (3 caractères min)'); return; }
    setLoading(true);
    try {
      let result;
      if (gameId.trim()) {
        result = await supabase.rpc('admin_refund_game', {
          p_game_id: gameId.trim(),
          p_user_id: ticket.user_id,
          p_amount: n,
          p_reason: reason.trim(),
        });
      } else {
        result = await supabase.rpc('admin_adjust_user_coins', {
          p_user_id: ticket.user_id,
          p_delta: n,
          p_reason: `[Ticket ${ticket.id.slice(0, 8)}] ${reason.trim()}`,
        });
      }
      if (result.error) throw result.error;
      if (result.data?.success === false) throw new Error(result.data.error);

      // Marquer le ticket avec refund_status
      await supabase.from('support_tickets').update({
        refund_status: 'paid',
        refund_amount: n,
        related_game_id: gameId.trim() || null,
        financial_impact: n,
      }).eq('id', ticket.id);

      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/30 bg-surface-light shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/20 p-5">
          <div>
            <h3 className="font-bold text-text">Émettre un remboursement</h3>
            <p className="mt-0.5 text-xs text-text-muted">{ticket.username}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"
            className="rounded-lg p-1.5 text-text-muted hover:bg-surface-lighter">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Montant (coins)</label>
            <input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-lg font-bold text-text focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Game ID concerné (optionnel)
            </label>
            <input type="text" value={gameId} onChange={e => setGameId(e.target.value)}
              placeholder="UUID partie litigieuse (déclenche replay + idempotency)"
              className="w-full rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-xs font-mono text-text focus:outline-none focus:border-primary" />
            <p className="mt-1 text-[11px] text-text-muted">
              Si renseigné, prévient un double-refund pour la même partie.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">
              Raison <span className="text-danger">*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder="Décrivez la raison du remboursement..."
              aria-label="Raison du remboursement"
              className="w-full resize-none rounded-xl border border-border/30 bg-surface px-4 py-2.5 text-sm text-text focus:outline-none focus:border-primary" />
            <p className="mt-1 text-[11px] text-text-muted">Tracée dans admin_actions_log.</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-danger/10 border border-danger/20 p-3 text-sm text-danger">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl border border-border/30 py-2.5 text-sm font-semibold text-text-muted hover:bg-surface-lighter">
              Annuler
            </button>
            <button type="button" onClick={submit} disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-warning py-2.5 text-sm font-semibold text-white hover:bg-warning/80 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Confirmer refund
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
