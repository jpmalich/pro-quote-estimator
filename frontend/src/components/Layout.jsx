import React from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCompany } from "@/lib/company";
import { LogOut, LayoutGrid, Settings2, Users } from "lucide-react";
import CompanyLogo from "@/components/CompanyLogo";

export default function Layout() {
  const { user, logout } = useAuth();
  const { company } = useCompany();
  const nav = useNavigate();
  const loc = useLocation();

  const linkCls = (path) =>
    `px-3 py-2 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
      loc.pathname === path || (path === "/" && loc.pathname.startsWith("/estimate"))
        ? "border-[#F97316] text-[#09090B]"
        : "border-transparent text-[#52525B] hover:text-[#09090B]"
    }`;

  return (
    <div className="min-h-screen bg-[#F4F4F5]">
      <header className="bg-white border-b border-[#E4E4E7] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-3" data-testid="brand-link">
            <CompanyLogo company={company} size={36} testid="nav-logo" />
            <div className="leading-tight">
              <div className="font-heading text-base text-[#09090B]" style={{ minHeight: "1em" }}>
                {company?.name || "\u00A0"}
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA]">Estimator</div>
            </div>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Link to="/" className={linkCls("/")} data-testid="nav-estimates">
              <LayoutGrid className="inline w-4 h-4 mr-1" /> Estimates
            </Link>
            <Link to="/catalog" className={linkCls("/catalog")} data-testid="nav-catalog">
              <Settings2 className="inline w-4 h-4 mr-1" /> Catalog
            </Link>
            <Link to="/team" className={linkCls("/team")} data-testid="nav-team">
              <Users className="inline w-4 h-4 mr-1" /> Team
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-sm font-semibold text-[#09090B]" data-testid="user-name">
                {user?.name}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">{user?.role}</div>
            </div>
            <button
              className="btn-ghost"
              onClick={async () => {
                await logout();
                nav("/login");
              }}
              data-testid="logout-btn"
              aria-label="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="sm:hidden flex border-t border-[#E4E4E7]">
          <Link to="/" className={`flex-1 text-center ${linkCls("/")}`}>Estimates</Link>
          <Link to="/catalog" className={`flex-1 text-center ${linkCls("/catalog")}`}>Catalog</Link>
          <Link to="/team" className={`flex-1 text-center ${linkCls("/team")}`}>Team</Link>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
