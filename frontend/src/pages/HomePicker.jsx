import React from "react";
import { useNavigate } from "react-router-dom";
import { Building2, HardHat } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Iter 76 — Two-step workspace picker (Howard's sketch).
 *
 * Step 1: top-level — pick ISS Quotes vs Contractor Quotes.
 * Step 2: each group routes to its own sub-picker page that lists the
 * actual workspaces inside that family.
 *
 *   /                  → this page (group picker)
 *   /picker/iss        → IssPicker (siding / windows / new-con)
 *   /picker/contractor → ContractorPicker (windows / vinyl+ascend / lp)
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
          {t("home.pickerSubtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
        <button
          type="button"
          onClick={() => nav("/picker/iss")}
          className="card text-left p-6 sm:p-10 group hover:border-[#F97316] transition-colors"
          data-testid="home-group-iss"
        >
          <div className="flex items-center gap-3 mb-5 text-[#F97316]">
            <Building2 className="w-9 h-9" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-3">
            {t("home.issGroupTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6 leading-relaxed">
            {t("home.issGroupDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.issGroupCta")}
          </div>
        </button>

        <button
          type="button"
          onClick={() => nav("/picker/contractor")}
          className="card text-left p-6 sm:p-10 group hover:border-[#F97316] transition-colors"
          data-testid="home-group-contractor"
        >
          <div className="flex items-center gap-3 mb-5 text-[#F97316]">
            <HardHat className="w-9 h-9" />
            <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
              {t("home.workspaceTag")}
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl text-[#09090B] mb-3">
            {t("home.contractorGroupTitle")}
          </h2>
          <p className="text-sm text-[#52525B] mb-6 leading-relaxed">
            {t("home.contractorGroupDesc")}
          </p>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#F97316] group-hover:underline">
            {t("home.contractorGroupCta")}
          </div>
        </button>
      </div>
    </main>
  );
}
