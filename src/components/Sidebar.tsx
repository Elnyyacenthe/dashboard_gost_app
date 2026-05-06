import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Gamepad2,
  BarChart3,
  Settings,
  LogOut,
  Dice5,
  MessageSquare,
  Vault,
  Scale,
  AlertTriangle,
  History,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';

interface SidebarProps {
  onSignOut: () => void;
  open?: boolean;
  onClose?: () => void;
}

function useUnreadSupport() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      const { count: c } = await supabase
        .from('support_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('unread_admin', true);
      setCount(c ?? 0);
    };
    fetch();

    const sub = supabase
      .channel('sidebar-support-unread')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, fetch)
      .subscribe();

    return () => { sub.unsubscribe(); };
  }, []);

  return count;
}

function useUnresolvedAlerts() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const fetch = async () => {
      const { count: c } = await supabase
        .from('admin_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', false);
      setCount(c ?? 0);
    };
    fetch();
    const sub = supabase
      .channel('sidebar-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_alerts' }, fetch)
      .subscribe();
    return () => { sub.unsubscribe(); };
  }, []);
  return count;
}

export default function Sidebar({ onSignOut, open = false, onClose }: SidebarProps) {
  const unreadSupport = useUnreadSupport();
  const unresolvedAlerts = useUnresolvedAlerts();
  const { isSuperAdmin } = useAuth();

  const navItems = [
    { to: '/dashboard/overview',   icon: LayoutDashboard, label: 'Overview',       badge: 0,                show: true },
    { to: '/dashboard/users',      icon: Users,           label: 'Utilisateurs',   badge: 0,                show: true },
    { to: '/dashboard/games',      icon: Gamepad2,        label: 'Parties',        badge: 0,                show: true },
    { to: '/dashboard/analytics',  icon: BarChart3,       label: 'Statistiques',   badge: 0,                show: true },
    { to: '/dashboard/alerts',     icon: AlertTriangle,   label: 'Alertes',        badge: unresolvedAlerts, show: true },
    { to: '/dashboard/treasury',   icon: Vault,           label: 'Trésorerie',     badge: 0,                show: isSuperAdmin },
    { to: '/dashboard/audit',      icon: Scale,           label: 'Comptabilité',   badge: 0,                show: isSuperAdmin },
    { to: '/dashboard/replay',     icon: History,         label: 'Replay',         badge: 0,                show: isSuperAdmin },
    { to: '/dashboard/support',    icon: MessageSquare,   label: 'Service Client', badge: unreadSupport,    show: true },
    { to: '/dashboard/settings',   icon: Settings,        label: 'Paramètres',     badge: 0,                show: true },
  ].filter(i => i.show);

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidebar-bg fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border/40 transition-transform duration-300 ease-out lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between gap-3 border-b border-border/40 px-5">
        <div className="flex items-center gap-3">
          <div className="logo-gradient flex h-10 w-10 items-center justify-center rounded-xl text-surface">
            <Dice5 className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-text">GOST</h1>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-primary -mt-0.5">
              Admin Panel
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le menu"
          className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-lighter hover:text-text lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-secondary hover:bg-surface-lighter hover:text-text'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="active-indicator absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full" />
                )}
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className="flex-1">{item.label}</span>
                {item.badge > 0 && (
                  <span className="badge-danger flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold text-white">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-border/40 p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-danger transition-all duration-200 hover:bg-danger/10"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
          Déconnexion
        </button>
      </div>
    </aside>
    </>
  );
}
