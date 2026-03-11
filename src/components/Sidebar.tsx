import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Gamepad2,
  BarChart3,
  Settings,
  LogOut,
  Dice5,
} from 'lucide-react';

interface SidebarProps {
  onSignOut: () => void;
}

const navItems = [
  { to: '/dashboard/overview', icon: LayoutDashboard, label: 'Overview' },
  { to: '/dashboard/users', icon: Users, label: 'Utilisateurs' },
  { to: '/dashboard/games', icon: Gamepad2, label: 'Parties' },
  { to: '/dashboard/analytics', icon: BarChart3, label: 'Statistiques' },
  { to: '/dashboard/settings', icon: Settings, label: 'Paramètres' },
];

export default function Sidebar({ onSignOut }: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-border/20 bg-surface-light">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border/20 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white">
          <Dice5 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text">GOST</h1>
          <p className="text-xs text-text-muted -mt-0.5">Admin Panel</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-text-muted hover:bg-surface-lighter hover:text-text'
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-border/20 p-3">
        <button
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-danger transition-all duration-200 hover:bg-danger/10"
        >
          <LogOut className="h-5 w-5" />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
