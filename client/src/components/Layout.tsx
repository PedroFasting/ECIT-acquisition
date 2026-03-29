import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Building2,
  GitMerge,
  LogOut,
  Target,
  Globe,
  FileSpreadsheet,
} from "lucide-react";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const toggleLanguage = () => {
    const next = i18n.language === "nb" ? "en" : "nb";
    i18n.changeLanguage(next);
  };

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: t("nav.overview") },
    { to: "/companies", icon: Building2, label: t("nav.companies") },
    { to: "/targets", icon: Target, label: t("nav.targets") },
    { to: "/models", icon: FileSpreadsheet, label: t("nav.models") },
    { to: "/scenarios", icon: GitMerge, label: t("nav.scenarios") },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-ecit-dark text-white flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold tracking-tight">ECIT Acquisition</h1>
          <p className="text-xs text-white/50 mt-1">{t("nav.subtitle")}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          {/* Language switcher */}
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/5 transition-colors mb-3"
          >
            <Globe size={14} />
            {i18n.language === "nb" ? "English" : "Norsk"}
          </button>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">{user?.name}</p>
              <p className="text-xs text-white/40">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              title={t("nav.logout")}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
