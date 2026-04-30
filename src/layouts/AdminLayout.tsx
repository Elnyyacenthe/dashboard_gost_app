import { useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { useAuth } from '../lib/hooks/useAuth';
import { useEffect } from 'react';

export default function AdminLayout() {
  const { user, profile, loading, isAdmin, isSuperAdmin, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close drawer on route change (mobile UX)
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-text-muted">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar onSignOut={signOut} open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="lg:ml-64">
        <Header profile={profile} onSignOut={signOut} isSuperAdmin={isSuperAdmin} onMenuClick={() => setMobileOpen(true)} />
        <main className="p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
