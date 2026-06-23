import React from "react";
import { useNavigate } from "react-router-dom";
import { Home as HomeIcon, RectangleHorizontal, Layers } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Workspace picker — the landing screen after login. Two big cards let the
 * contractor pick which workspace to enter:
 *   - Siding Quotes (kind=siding)  → /dashboard/siding
 *   - Window Quotes (kind=windows) → /dashboard/windows
 *
 * Each workspace has its own estimate list, its own creation flow, and a
 * different tab visibility set inside the estimate editor.
 *
 * Each card has a data-testid so the testing agent can wire up flows.
 */
export default function HomePicker() {
  const t = useT();
  const nav = useNavigate();
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
      <div className="mb-10 sm:mb-12">
        <div className="section-tag mb-3">{t("home.pickerTag") || "Workspace"}</div>
        <h1 className="font-heading text-3xl sm:text-4xl text-[#09090B]">
          {t("home.pickerTitle") || "Choose what you’re quoting"}
        </h1>
        <p className="mt-2 text-[#52525B] max-w-2xl text-sm sm:text-base">
          {t("home.pickerSubtitle") ||
            "Siding and windows live in separate workspaces. Each one keeps its own list of quotes."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <button
          type="button"
          onClick={() => nav("/dashboard/iss")}
          className="card text-left p-6 sm:p-8 group hover:border-[#F97316] transition-colors"
          data-testid="home-card-iss"
        >
          <div className="flex items-center gap-3 mb-4 text-[#F97316]">
            <Layers className="w-8 h-8" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-2">
            {t("home.issTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6">
            {t("home.issDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.issCta")}
          </div>
        </button>

        <button
          type="button"
          onClick={() => nav("/dashboard/siding")}
          className="card text-left p-6 sm:p-8 group hover:border-[#F97316] transition-colors"
          data-testid="home-card-siding"
        >
          <div className="flex items-center gap-3 mb-4 text-[#F97316]">
            <HomeIcon className="w-8 h-8" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-2">
            {t("home.sidingTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6">
            {t("home.sidingDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.sidingCta")}
          </div>
        </button>

        {/* Iter 73 — LP SmartSide split into its own workspace per
            Howard's request. Same card pattern as the other workspaces;
            estimates created here get kind="lp_smart" and only the LP
            Smart tab is visible inside the editor. */}
        <button
          type="button"
          onClick={() => nav("/dashboard/lp_smart")}
          className="card text-left p-6 sm:p-8 group hover:border-[#F97316] transition-colors"
          data-testid="home-card-lp_smart"
        >
          <div className="flex items-center gap-3 mb-4 text-[#F97316]">
            <Layers className="w-8 h-8" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-2">
            {t("home.lpTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6">
            {t("home.lpDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.lpCta")}
          </div>
        </button>

        <button
          type="button"
          onClick={() => nav("/dashboard/windows")}
          className="card text-left p-6 sm:p-8 group hover:border-[#F97316] transition-colors"
          data-testid="home-card-windows"
        >
          <div className="flex items-center gap-3 mb-4 text-[#F97316]">
            <RectangleHorizontal className="w-8 h-8" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-2">
            {t("home.windowsTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6">
            {t("home.windowsDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.windowsCta")}
          </div>
        </button>
      </div>
    </main>
  );
}
