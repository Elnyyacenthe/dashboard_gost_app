import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<AdminLayout />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="treasury" element={<TreasuryPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
