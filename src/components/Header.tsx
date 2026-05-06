import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, ChevronDown, UserX, RotateCcw, UserCheck, Info, X, Menu } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '../lib/supabaseClient';
import type { Profile } from '../types';

interface HeaderProps {
  profile: Profile | null;
  onSignOut: () => void;
  isSuperAdmin?: boolean;
  onMenuClick?: () => void;
}

interface Notif {
  id: string;
  type: 'blocked' | 'unblocked' | 'coins_reset' | 'role_change' | 'info';
  message: string;
  read: boolean;
  created_at: string;
}

// Génère des notifications réelles depuis les changements récents de user_profiles
async function fetchNotifications(): Promise<Notif[]> {
  const notifs: Notif[] = [];

  try {
    // Joueurs bloqués récemment
    const { data: blocked } = await supabase
      .from('user_profiles')
      .select('id, username, created_at')
      .eq('is_blocked', true)
      .order('created_at', { ascending: false })
      .limit(3);

    blocked?.forEach(u => {
      notifs.push({
        id: `blocked-${u.id}`,
        type: 'blocked',
        message: `${u.username} a été bloqué`,
        read: false,
        created_at: u.created_at,
      });
    });

    // Joueurs inscrits récemment (dernières 48h)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: newPlayers } = await supabase
      .from('user_profiles')
      .select('id, username, created_at')
      .gte('created_at', twoDaysAgo)
      .order('created_at', { ascending: false })
      .limit(5);

    newPlayers?.forEach(u => {
      notifs.push({
        id: `new-${u.id}`,
        type: 'info',
        message: `Nouveau joueur : ${u.username}`,
        read: false,
        created_at: u.created_at,
      });
    });
  } catch (e) {
    console.error('fetchNotifications error:', e);
  }

  // Trier par date desc
  return notifs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 8);
}

const notifIcon: Record<Notif['type'], React.ReactNode> = {
  blocked:     <UserX className="h-4 w-4 text-danger" />,
  unblocked:   <UserCheck className="h-4 w-4 text-success" />,
  coins_reset: <RotateCcw className="h-4 w-4 text-warning" />,
  role_change: <UserCheck className="h-4 w-4 text-info" />,
  info:        <Info className="h-4 w-4 text-info" />,
};

export default function Header({ profile, onSignOut, isSuperAdmin = false, onMenuClick }: HeaderProps) {
  const [showMenu, setShowMenu]   = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [notifs, setNotifs]       = useState<Notif[]>([]);
  const [readIds, setReadIds]     = useState<Set<string>>(new Set());
  const [loadingNotif, setLoadingNotif] = useState(false);

  const menuRef  = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifs.filter(n => !readIds.has(n.id)).length;

  // Fermer les dropdowns au clic extérieur
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotif(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const openNotifications = async () => {
    if (showNotif) { setShowNotif(false); return; }
    setShowNotif(true);
    setShowMenu(false);
    if (notifs.length === 0) {
      setLoadingNotif(true);
      const data = await fetchNotifications();
      setNotifs(data);
      setLoadingNotif(false);
    }
  };

  const markAllRead = () => {
    setReadIds(new Set(notifs.map(n => n.id)));
  };

  const dismiss = (id: string) => {
    setNotifs(prev => prev.filter(n => n.id !== id));
    setReadIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border/20 bg-surface/80 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Ouvrir le menu"
          className="-ml-1 rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-lighter hover:text-text lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-text sm:text-lg">Dashboard</h2>
          <p className="truncate text-xs text-text-muted">Bienvenue, {profile?.username ?? 'Admin'}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-3">

        {/* ── Notifications ── */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={openNotifications}
            aria-label="Notifications"
            className="relative rounded-xl p-2 text-text-muted transition-colors hover:bg-surface-lighter hover:text-text"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotif && (
            <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-2xl border border-border/30 bg-surface-light shadow-2xl animate-fade-in sm:w-80">
              {/* Header panel */}
              <div className="flex items-center justify-between border-b border-border/20 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-text">Notifications</p>
                  {unreadCount > 0 && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">{unreadCount}</span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllRead} className="text-xs text-text-muted transition-colors hover:text-primary">
                    Tout marquer lu
                  </button>
                )}
              </div>

              {/* Liste */}
              <div className="max-h-80 overflow-y-auto">
                {loadingNotif ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                ) : notifs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10">
                    <Bell className="h-8 w-8 text-text-muted/40" />
                    <p className="text-sm text-text-muted">Aucune notification</p>
                  </div>
                ) : (
                  notifs.map(n => {
                    const isRead = readIds.has(n.id);
                    return (
                      <div
                        key={n.id}
                        className={`flex items-start gap-3 border-b border-border/10 px-4 py-3 transition-colors hover:bg-surface-lighter ${
                          isRead ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-lighter">
                          {notifIcon[n.type]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm leading-snug ${isRead ? 'text-text-muted' : 'font-medium text-text'}`}>
                            {n.message}
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: fr })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => dismiss(n.id)}
                          aria-label="Supprimer cette notification"
                          className="mt-0.5 shrink-0 rounded p-0.5 text-text-muted/50 transition-colors hover:text-text"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              {notifs.length > 0 && (
                <div className="border-t border-border/20 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => { setNotifs([]); setReadIds(new Set()); }}
                    className="w-full text-center text-xs text-text-muted transition-colors hover:text-danger"
                  >
                    Effacer toutes les notifications
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Profile dropdown ── */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => { setShowMenu(!showMenu); setShowNotif(false); }}
            className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-lighter"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
              {profile?.username?.charAt(0).toUpperCase() ?? 'A'}
            </div>
            <span className="hidden text-sm font-medium text-text md:block">
              {profile?.username ?? 'Admin'}
            </span>
            <ChevronDown className={`h-4 w-4 text-text-muted transition-transform duration-200 ${showMenu ? 'rotate-180' : ''}`} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-border/30 bg-surface-light shadow-xl animate-fade-in">
              <div className="border-b border-border/20 px-4 py-3">
                <p className="text-sm font-semibold text-text">{profile?.username}</p>
                <p className="text-xs text-text-muted truncate">{profile?.email}</p>
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  isSuperAdmin ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary'
                }`}>
                  {isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN'}
                </span>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-danger transition-colors hover:bg-danger/10"
              >
                <LogOut className="h-4 w-4" />
                Déconnexion
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
