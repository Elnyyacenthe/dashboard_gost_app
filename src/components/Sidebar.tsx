import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Gamepad2, BarChart3, Settings, LogOut,
  MessageSquare, Vault, Scale, AlertTriangle, History, Megaphone,
  FileSpreadsheet, X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/hooks/useAuth';
import { can, type Permission, ROLE_LABEL, type Role } from '../lib/permissions';

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

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  badge?: number;
  perm: Permission;
}

export default function Sidebar({ onSignOut, open = false, onClose }: SidebarProps) {
  const unreadSupport = useUnreadSupport();
  const unresolvedAlerts = useUnresolvedAlerts();
  const { profile } = useAuth();
  const role = (profile?.role ?? 'user') as Role;

  // Groupes de navigation (chaque entrée filtrée par permission)
  const mainGroup: NavItem[] = [
    { to: '/dashboard/overview',   icon: LayoutDashboard, label: 'Overview',     perm: 'nav.overview' },
    { to: '/dashboard/users',      icon: Users,           label: 'Utilisateurs', perm: 'nav.users' },
    { to: '/dashboard/games',      icon: Gamepad2,        label: 'Parties',      perm: 'nav.games' },
    { to: '/dashboard/analytics',  icon: BarChart3,       label: 'Statistiques', perm: 'nav.analytics' },
  ];

  const opsGroup: NavItem[] = [
    { to: '/dashboard/alerts',         icon: AlertTriangle, label: 'Alertes',        badge: unresolvedAlerts, perm: 'nav.alerts' },
    { to: '/dashboard/announcements',  icon: Megaphone,     label: 'Annonces',       perm: 'nav.announcements' },
    { to: '/dashboard/replay',         icon: History,       label: 'Replay',         perm: 'nav.replay' },
    { to: '/dashboard/support',        icon: MessageSquare, label: 'Service Client', badge: unreadSupport, perm: 'nav.support' },
  ];

  const adminGroup: NavItem[] = [
    { to: '/dashboard/treasury',  icon: Vault,            label: 'Trésorerie',   perm: 'nav.treasury' },
    { to: '/dashboard/audit',     icon: Scale,            label: 'Comptabilité', perm: 'nav.audit' },
    { to: '/dashboard/finance',   icon: FileSpreadsheet,  label: 'Rapport finance', perm: 'nav.finance' },
    { to: '/dashboard/settings',  icon: Settings,         label: 'Paramètres',   perm: 'nav.settings' },
  ];

  const filterByPerm = (items: NavItem[]) => items.filter(i => can(role, i.perm));
  const mainItems  = filterByPerm(mainGroup);
  const opsItems   = filterByPerm(opsGroup);
  const adminItems = filterByPerm(adminGroup);

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
        className={`exec-sidebar fixed left-0 top-0 z-40 flex h-screen w-64 flex-col transition-transform duration-300 ease-out lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo + close (mobile) */}
        <div className="flex h-16 items-center justify-between gap-3 border-b border-white/10 px-5">
          <div className="flex items-center gap-3">
            <img
              src="/plugbet-logo.png"
              alt="Plugbet"
              className="h-9 w-auto object-contain"
              draggable={false}
            />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
                Admin
              </p>
              <p className="-mt-0.5 text-sm font-extrabold text-white">Console</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Profile mini-card */}
        {profile && (
          <div className="border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#7CCD3F] to-[#5FAF2D] text-sm font-extrabold text-white">
                {(profile.username ?? '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {profile.username ?? 'Admin'}
                </p>
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-[#7CCD3F]">
                  {ROLE_LABEL[role] ?? role}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {mainItems.length > 0 && (
            <NavGroup label="Vue d'ensemble" items={mainItems} />
          )}
          {opsItems.length > 0 && (
            <NavGroup label="Opérations" items={opsItems} />
          )}
          {adminItems.length > 0 && (
            <NavGroup label="Administration" items={adminItems} />
          )}
        </nav>

        {/* Logout */}
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-300 transition-all duration-200 hover:bg-red-500/10 hover:text-red-200"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
            Déconnexion
          </button>
        </div>
      </aside>
    </>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div>
      <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'exec-sidebar-item-active'
                  : 'text-white/65 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className="flex-1">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
