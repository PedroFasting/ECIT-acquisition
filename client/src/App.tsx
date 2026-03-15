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
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/companies/:id" element={<CompanyDetailPage />} />
        <Route path="/targets" element={<TargetsListPage />} />
        <Route path="/targets/compare" element={<TargetComparePage />} />
        <Route path="/targets/:id" element={<TargetOverviewPage />} />
        <Route path="/models" element={<ModelsOverviewPage />} />
        <Route path="/models/:id" element={<ModelDetailPage />} />
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
