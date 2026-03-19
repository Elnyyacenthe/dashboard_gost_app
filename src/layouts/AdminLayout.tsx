import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { useAuth } from '../lib/hooks/useAuth';

export default function AdminLayout() {
  const { user, profile, loading, isAdmin, isSuperAdmin, signOut } = useAuth();

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
      <Sidebar onSignOut={signOut} />
      <div className="ml-64">
        <Header profile={profile} onSignOut={signOut} isSuperAdmin={isSuperAdmin} />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
