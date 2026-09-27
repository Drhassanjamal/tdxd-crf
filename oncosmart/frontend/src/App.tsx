import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/Layout';
import { PageLoader } from './components/ui';
import { useAuth } from './hooks/useAuth';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { AuditPage } from './pages/AuditPage';
import { ChairsPage } from './pages/ChairsPage';
import { DashboardPage } from './pages/DashboardPage';
import { InfusionPage } from './pages/InfusionPage';
import { LoginPage } from './pages/LoginPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrderEditorPage } from './pages/OrderEditorPage';
import { OrdersPage } from './pages/OrdersPage';
import { PatientChartPage } from './pages/PatientChartPage';
import { PatientsPage } from './pages/PatientsPage';
import { PrintPage } from './pages/PrintPage';
import { ProtocolsPage } from './pages/ProtocolsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

function Guard({ permission, children }: { permission?: string; children: JSX.Element }) {
  const { can } = useAuth();
  if (permission && !can(permission)) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/print/:kind/:id" element={<PrintPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="patients" element={<Guard permission="patients.read"><PatientsPage /></Guard>} />
        <Route path="patients/:id" element={<Guard permission="patients.read"><PatientChartPage /></Guard>} />
        <Route path="appointments" element={<Guard permission="appointments.read"><AppointmentsPage /></Guard>} />
        <Route path="infusion" element={<Guard permission="infusion.read"><InfusionPage /></Guard>} />
        <Route path="orders" element={<Guard permission="orders.read"><OrdersPage /></Guard>} />
        <Route path="orders/new" element={<Guard permission="orders.prescribe"><OrderEditorPage /></Guard>} />
        <Route path="orders/:id" element={<Guard permission="orders.read"><OrderDetailPage /></Guard>} />
        <Route path="orders/:id/edit" element={<Guard permission="orders.prescribe"><OrderEditorPage /></Guard>} />
        <Route path="protocols" element={<Guard permission="protocols.read"><ProtocolsPage /></Guard>} />
        <Route path="chairs" element={<Guard permission="chairs.read"><ChairsPage /></Guard>} />
        <Route path="reports" element={<Guard permission="reports.read"><ReportsPage /></Guard>} />
        <Route path="users" element={<Guard permission="users.manage"><UsersPage /></Guard>} />
        <Route path="settings" element={<Guard permission="settings.manage"><SettingsPage /></Guard>} />
        <Route path="audit" element={<Guard permission="audit.read"><AuditPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
