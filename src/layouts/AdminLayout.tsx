import { useState, useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { useAuth } from '../lib/hooks/useAuth';

export default function AdminLayout() {
  const { user, profile, loading, isAdmin, isSuperAdmin, isModerator, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-text-secondary">Chargement…</p>
        </div>
      </div>
    );
  }

  // Bloquer accès si pas un rôle dashboard
  const hasAnyAccess = isAdmin || isSuperAdmin || isModerator;
  if (!user || !hasAnyAccess) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar onSignOut={signOut} open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:ml-64">
        <Header
          profile={profile}
          onSignOut={signOut}
          isSuperAdmin={isSuperAdmin}
          onMenuClick={() => setMobileOpen(true)}
        />
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
