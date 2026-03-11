import { useState, useRef, useEffect } from 'react';
import { Bell, LogOut, ChevronDown } from 'lucide-react';
import type { Profile } from '../types';

interface HeaderProps {
  profile: Profile | null;
  onSignOut: () => void;
}

export default function Header({ profile, onSignOut }: HeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [notifCount] = useState(3);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/20 bg-surface/80 px-6 backdrop-blur-xl">
      <div>
        <h2 className="text-lg font-semibold text-text">Dashboard</h2>
        <p className="text-xs text-text-muted">Bienvenue, {profile?.username ?? 'Admin'}</p>
      </div>

      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button className="relative rounded-xl p-2 text-text-muted transition-colors hover:bg-surface-lighter hover:text-text">
          <Bell className="h-5 w-5" />
          {notifCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {notifCount}
            </span>
          )}
        </button>

        {/* Profile dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-surface-lighter"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
              {profile?.username?.charAt(0).toUpperCase() ?? 'A'}
            </div>
            <span className="hidden text-sm font-medium text-text md:block">
              {profile?.username ?? 'Admin'}
            </span>
            <ChevronDown className="h-4 w-4 text-text-muted" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-xl border border-border/30 bg-surface-light shadow-xl animate-fade-in">
              <div className="border-b border-border/20 px-4 py-3">
                <p className="text-sm font-semibold text-text">{profile?.username}</p>
                <p className="text-xs text-text-muted">{profile?.email}</p>
              </div>
              <button
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
