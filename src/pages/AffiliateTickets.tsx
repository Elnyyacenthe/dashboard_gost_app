// ============================================================
// AffiliateTickets — support des tickets affiliés (admin)
// ============================================================
// Liste + fil de conversation + réponse (admin_reply_ticket) + statut.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, ChevronLeft, FileText, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';

interface TicketRow {
  id: string;
  affiliate_id: string;
  category: string;
  subject: string;
  priority: string;
  status: 'open' | 'pending' | 'answered' | 'closed';
  unread_admin: boolean;
  updated_at: string;
  username: string | null;
  email: string | null;
  message_count: number;
  last_message_at: string | null;
}
interface Message {
  id: string;
  author_role: 'affiliate' | 'staff';
  body: string;
  attachments: { url: string; name: string }[];
  created_at: string;
}

const categoryLabel: Record<string, string> = {
  new_code: 'Nouveau code', payment: 'Paiement', withdrawal: 'Retrait',
  registration: 'Inscription', complaint: 'Réclamation', question: 'Question', other: 'Autre',
};
const statusBadge: Record<TicketRow['status'], string> = {
  open: 'badge-info', pending: 'badge-warning', answered: 'badge-primary', closed: 'badge-neutral',
};
const statusLabel: Record<TicketRow['status'], string> = {
  open: 'Ouvert', pending: 'En attente', answered: 'Répondu', closed: 'Fermé',
};
const FILTERS = [
  { key: 'unread', label: 'Non lus' },
  { key: 'open', label: 'Ouverts' },
  { key: 'answered', label: 'Répondus' },
  { key: 'closed', label: 'Fermés' },
  { key: 'all', label: 'Tous' },
];

export default function AffiliateTickets() {
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unread');
  const [selected, setSelected] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('admin_affiliate_tickets_view')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setRows(data as TicketRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openTicket = async (t: TicketRow) => {
    setSelected(t);
    setLoadingMsgs(true);
    const { data } = await supabase
      .from('affiliate_ticket_messages')
      .select('*')
      .eq('ticket_id', t.id)
      .order('created_at', { ascending: true });
    setMessages((data as Message[]) ?? []);
    setLoadingMsgs(false);
    await supabase.rpc('admin_mark_ticket_read', { p_ticket_id: t.id });
    loadTickets();
  };

  const reply = async () => {
    if (!selected || !body.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_reply_ticket', {
      p_ticket_id: selected.id, p_body: body.trim(), p_attachments: [],
    });
    setBusy(false);
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    setBody('');
    await openTicket(selected);
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    const { data, error } = await supabase.rpc('admin_set_ticket_status', {
      p_ticket_id: selected.id, p_status: status,
    });
    if (error || data?.success === false) {
      alert('Erreur : ' + (error?.message ?? data?.error ?? 'inconnu'));
      return;
    }
    await loadTickets();
    setSelected((s) => (s ? { ...s, status: status as TicketRow['status'] } : s));
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'unread') return rows.filter((r) => r.unread_admin);
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);
  const unreadCount = useMemo(() => rows.filter((r) => r.unread_admin).length, [rows]);

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
            {f.key === 'unread' && unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Liste */}
        <div className={`space-y-2 ${selected ? 'hidden lg:block' : 'block'}`}>
          {loading ? (
            <div className="flex h-40 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-border/30 bg-surface-light p-6 text-center text-sm text-text-muted">
              Aucun ticket.
            </div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => openTicket(t)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selected?.id === t.id ? 'border-primary bg-primary/5' : 'border-border/30 bg-surface-light hover:border-border-light'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold text-text">{t.subject}</span>
                  {t.unread_admin && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-text-muted">{t.username} · {categoryLabel[t.category]}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadge[t.status]}`}>
                    {statusLabel[t.status]}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Fil */}
        <div className={`${selected ? 'block' : 'hidden lg:block'}`}>
          {!selected ? (
            <div className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-border/30 bg-surface-light text-center text-text-muted">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="mt-3 text-sm">Sélectionne un ticket.</p>
            </div>
          ) : (
            <div className="flex h-[70vh] flex-col rounded-2xl border border-border/30 bg-surface-light">
              <div className="flex items-center justify-between gap-3 border-b border-border/20 p-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelected(null)} className="rounded-lg p-1 text-text-muted hover:bg-surface-lighter lg:hidden">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div>
                    <p className="font-black text-text">{selected.subject}</p>
                    <p className="text-[11px] text-text-muted">{selected.username} · {selected.email}</p>
                  </div>
                </div>
                <select
                  value={selected.status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-lg border border-border/40 bg-surface-light px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-primary"
                >
                  {(['open', 'pending', 'answered', 'closed'] as const).map((s) => (
                    <option key={s} value={s}>{statusLabel[s]}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {loadingMsgs ? (
                  <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  messages.map((m) => {
                    const staff = m.author_role === 'staff';
                    return (
                      <div key={m.id} className={`flex ${staff ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${staff ? 'bg-primary/15' : 'bg-surface-lighter'}`}>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                            {staff ? 'Équipe PlugBet' : (selected.username ?? 'Affilié')} · {format(new Date(m.created_at), 'dd/MM HH:mm', { locale: fr })}
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-text">{m.body}</p>
                          {m.attachments?.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {m.attachments.map((a, i) => (
                                <a key={i} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-medium text-primary-dark hover:underline">
                                  <FileText className="h-3.5 w-3.5" /> {a.name}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>

              <div className="border-t border-border/20 p-3">
                <div className="flex items-end gap-2">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={1}
                    placeholder="Répondre à l'affilié…"
                    className="max-h-32 flex-1 resize-none rounded-xl border border-border/60 bg-surface-light px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={reply}
                    disabled={busy || !body.trim()}
                    className="btn-primary flex h-11 w-11 items-center justify-center rounded-xl disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
