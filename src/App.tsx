import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import UsersPage from './pages/Users';
import GamesPage from './pages/Games';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import SupportPage from './pages/Support';
import TreasuryPage from './pages/Treasury';
import AuditPage from './pages/Audit';
import AlertsPage from './pages/Alerts';
import UserDetail from './pages/UserDetail';
import GameReplay from './pages/GameReplay';
import Replay from './pages/Replay';
import Announcements from './pages/Announcements';
import FinanceReport from './pages/FinanceReport';
import Cashflow from './pages/Cashflow';
import SlotsPage from './pages/Slots';
import WheelPage from './pages/Wheel';
import BetsPage from './pages/Bets';
import NetworkHealthPage from './pages/NetworkHealth';
import Affiliates from './pages/Affiliates';
import OddsMonitor from './pages/OddsMonitor';
import OddsPapi from './pages/OddsPapi';
import FxRates from './pages/FxRates';
import Content from './pages/Content';
import { useAuth } from './lib/hooks/useAuth';
import { can, type Permission, type Role } from './lib/permissions';

// ── Garde par route : redirige si le rôle courant n'a pas la permission ──
// Défense en profondeur : la sidebar cache déjà les liens, mais sans cette
// garde un rôle restreint (ex: support) pourrait ouvrir /dashboard/treasury
// par URL directe. On le renvoie vers sa page d'accueil autorisée.
const HOME_PRIORITY: Array<[string, Permission]> = [
  ['overview', 'nav.overview'],
  ['users', 'nav.users'],
  ['analytics', 'nav.analytics'],
  ['games', 'nav.games'],
  ['support', 'nav.support'],
  ['affiliates', 'nav.affiliates'],
  ['odds', 'nav.odds'],
  ['oddspapi', 'nav.oddspapi'],
  ['treasury', 'nav.treasury'],
  ['finance', 'nav.finance'],
  ['cashflow', 'nav.cashflow'],
  ['audit', 'nav.audit'],
  ['announcements', 'nav.announcements'],
  ['alerts', 'nav.alerts'],
  ['replay', 'nav.replay'],
  ['settings', 'nav.settings'],
];

function defaultRouteFor(role: Role | string | null | undefined): string {
  const found = HOME_PRIORITY.find(([, perm]) => can(role, perm));
  return found ? found[0] : 'support';
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { profile, loading } = useAuth();
  if (loading) return null;
  const role = profile?.role as Role | undefined;
  if (!can(role, perm)) {
    return <Navigate to={`/dashboard/${defaultRouteFor(role)}`} replace />;
  }
  return <>{children}</>;
}

function RoleHome() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={defaultRouteFor(profile?.role)} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<AdminLayout />}>
          <Route index element={<RoleHome />} />
          <Route path="overview" element={<Guard perm="nav.overview"><Overview /></Guard>} />
          <Route path="users" element={<Guard perm="nav.users"><UsersPage /></Guard>} />
          <Route path="users/:id" element={<Guard perm="nav.users"><UserDetail /></Guard>} />
          <Route path="games" element={<Guard perm="nav.games"><GamesPage /></Guard>} />
          <Route path="games/:gameId/replay" element={<Guard perm="nav.games"><GameReplay /></Guard>} />
          <Route path="slots" element={<Guard perm="nav.games"><SlotsPage /></Guard>} />
          <Route path="wheel" element={<Guard perm="nav.games"><WheelPage /></Guard>} />
          <Route path="bets" element={<Guard perm="nav.games"><BetsPage /></Guard>} />
          <Route path="replay" element={<Guard perm="nav.replay"><Replay /></Guard>} />
          <Route path="analytics" element={<Guard perm="nav.analytics"><Analytics /></Guard>} />
          <Route path="network" element={<Guard perm="nav.overview"><NetworkHealthPage /></Guard>} />
          <Route path="support" element={<Guard perm="nav.support"><SupportPage /></Guard>} />
          <Route path="treasury" element={<Guard perm="nav.treasury"><TreasuryPage /></Guard>} />
          <Route path="audit" element={<Guard perm="nav.audit"><AuditPage /></Guard>} />
          <Route path="finance" element={<Guard perm="nav.finance"><FinanceReport /></Guard>} />
          <Route path="cashflow" element={<Guard perm="nav.cashflow"><Cashflow /></Guard>} />
          <Route path="alerts" element={<Guard perm="nav.alerts"><AlertsPage /></Guard>} />
          <Route path="announcements" element={<Guard perm="nav.announcements"><Announcements /></Guard>} />
          <Route path="content" element={<Guard perm="nav.announcements"><Content /></Guard>} />
          <Route path="affiliates" element={<Guard perm="nav.affiliates"><Affiliates /></Guard>} />
          <Route path="odds" element={<Guard perm="nav.odds"><OddsMonitor /></Guard>} />
          <Route path="oddspapi" element={<Guard perm="nav.oddspapi"><OddsPapi /></Guard>} />
          <Route path="fx" element={<Guard perm="nav.oddspapi"><FxRates /></Guard>} />
          <Route path="settings" element={<Guard perm="nav.settings"><Settings /></Guard>} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
