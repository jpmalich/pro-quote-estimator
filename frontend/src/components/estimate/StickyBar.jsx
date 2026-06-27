import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { fmt } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { VISIBLE_TAB_DEFS } from "@/lib/tabsConfig";

/**
 * Sticky bar at the top of the estimate editor.
 *
 * Shows three side-by-side mini-totals — one per product-line tab (Vinyl,
 * Ascend, LP Smart). The active tab is highlighted in orange so the
 * contractor always knows which option they're currently editing while
 * still seeing all three at a glance.
 *
 * Props:
 *   est            — the estimate doc (used only for header info)
 *   tabTotals      — [{ id, label, totals }] where totals is calcTotals() output
 *   activeTab      — id of the currently active tab
 */
const TAB_DEFS = VISIBLE_TAB_DEFS;

export default function StickyBar({ est, tabTotals, activeTab, tabs = TAB_DEFS }) {
  const t = useT();
  // Build a lookup so we render in the canonical Vinyl → Ascend → LP order
  // regardless of what order the parent passed.
  const byId = Object.fromEntries((tabTotals || []).map((tt) => [tt.id, tt]));
  return (
    <div className="sell-bar" data-testid="sticky-bar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3 sm:gap-6">
        <Link to="/" className="text-white/70 hover:text-white" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-[180px]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">{t("est.barLabel")}</div>
          <div className="font-heading text-base sm:text-lg truncate">
            {est.customer_name || `${t("est.untitled")} · ${est.estimate_number || ""}`}
          </div>
        </div>
        <div className="flex items-stretch gap-2 sm:gap-3 flex-wrap">
          {tabs.map((td) => {
            const tt = byId[td.id];
            if (!tt) return null;
            const isActive = td.id === activeTab;
            return (
              <TabBlock
                key={td.id}
                label={td.label}
                baseLabel={t("est.bar.base")}
                base={tt.totals.base}
                sell={tt.totals.sell}
                profit={tt.totals.profit}
                active={isActive}
                testid={`bar-tab-${td.id}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TabBlock({ label, baseLabel, base, sell, profit, active, testid }) {
  // Active tab gets an orange underline + brighter sell color. Inactive
  // tabs render at lower opacity so the eye lands on the one being edited.
  return (
    <div
      className={`px-3 py-1 border-l ${active ? "border-[#F97316]" : "border-white/15"} ${
        active ? "" : "opacity-60"
      }`}
      data-testid={testid}
    >
      <div
        className={`text-[10px] uppercase tracking-[0.18em] font-bold ${
          active ? "text-[#F97316]" : "text-white/60"
        }`}
      >
        {label}
      </div>
      <div
        className={`font-mono-num text-base sm:text-xl font-bold ${
          active ? "text-[#F97316]" : "text-white"
        }`}
        data-testid={`${testid}-sell`}
      >
        {fmt(sell)}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-[10px] text-white/50 font-mono-num" data-testid={`${testid}-base`}>
          {baseLabel} {fmt(base)}
        </span>
        <span
          className="text-[10px] font-mono-num"
          style={{ color: profit >= 0 ? "#10B981" : "#F87171" }}
          data-testid={`${testid}-profit`}
        >
          + {fmt(profit)}
        </span>
      </div>
    </div>
  );
}
