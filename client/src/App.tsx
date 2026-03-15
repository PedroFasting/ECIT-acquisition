import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CompaniesPage from "./pages/CompaniesPage";
import CompanyDetailPage from "./pages/CompanyDetailPage";
import ModelsOverviewPage from "./pages/ModelsOverviewPage";
import ModelDetailPage from "./pages/ModelDetailPage";
import ScenariosPage from "./pages/ScenariosPage";
import ScenarioDetailPage from "./pages/ScenarioDetailPage";
import TargetsListPage from "./pages/TargetsListPage";
import TargetOverviewPage from "./pages/TargetOverviewPage";
import TargetComparePage from "./pages/TargetComparePage";
import ErrorBoundary from "./components/ErrorBoundary";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
        }
      />
        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
          <Route path="/companies" element={<ErrorBoundary><CompaniesPage /></ErrorBoundary>} />
          <Route path="/companies/:id" element={<ErrorBoundary><CompanyDetailPage /></ErrorBoundary>} />
          <Route path="/targets" element={<ErrorBoundary><TargetsListPage /></ErrorBoundary>} />
          <Route path="/targets/compare" element={<ErrorBoundary><TargetComparePage /></ErrorBoundary>} />
          <Route path="/targets/:id" element={<ErrorBoundary><TargetOverviewPage /></ErrorBoundary>} />
          <Route path="/models" element={<ErrorBoundary><ModelsOverviewPage /></ErrorBoundary>} />
          <Route path="/models/:id" element={<ErrorBoundary><ModelDetailPage /></ErrorBoundary>} />
          <Route path="/scenarios" element={<ErrorBoundary><ScenariosPage /></ErrorBoundary>} />
          <Route path="/scenarios/:id" element={<ErrorBoundary><ScenarioDetailPage /></ErrorBoundary>} />
        </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
