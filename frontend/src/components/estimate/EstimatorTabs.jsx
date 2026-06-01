import React from "react";
import { fmt } from "@/lib/api";

/**
 * Excel-style tab strip for the multi-product estimator.
 *
 * The contractor can quote up to three parallel options on one estimate —
 * Vinyl, Ascend, and LP Smart Siding. Each tab holds its own line items so
 * the homeowner can compare options apples-to-apples on one quote.
 *
 * Per-tab subtotal = sum of (qty × (mat + lab)) for that tab's lines + its
 * misc rows. The Grand Total at the bottom of the page still rolls all
 * tabs together so the contractor sees the full quote value.
 */
export const TABS = [
  { id: "vinyl", label: "Vinyl" },
  { id: "ascend", label: "Ascend" },
  { id: "lp_smart", label: "LP Smart" },
];

function subtotalForTab(est, tabId) {
  const lines = (est?.lines || []).filter((l) => (l.tab || "vinyl") === tabId);
  const miscLab = (est?.misc_labor || []).filter((m) => (m.tab || "vinyl") === tabId);
  const miscMat = (est?.misc_material || []).filter((m) => (m.tab || "vinyl") === tabId);
  const linesSell = lines.reduce(
    (s, l) => s + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)),
    0
  );
  const miscSell =
    miscLab.reduce((s, m) => s + (m.lab || 0), 0) +
    miscMat.reduce((s, m) => s + (m.mat || 0) + (m.lab || 0), 0);
  return linesSell + miscSell;
}

function filledCountForTab(est, tabId) {
  return (est?.lines || []).filter(
    (l) => (l.tab || "vinyl") === tabId && (l.qty || 0) > 0
  ).length;
}

export default function EstimatorTabs({ est, activeTab, onChange }) {
  return (
    <div
      className="card mb-4 p-2 flex flex-wrap gap-1"
      role="tablist"
      data-testid="estimator-tabs"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const count = filledCountForTab(est, tab.id);
        const subtotal = subtotalForTab(est, tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            data-testid={`estimator-tab-${tab.id}`}
            className={[
              "flex-1 min-w-[140px] px-4 py-3 text-left border transition-colors",
              isActive
                ? "border-[#F97316] bg-orange-50"
                : "border-[#E4E4E7] bg-white hover:border-[#A1A1AA]",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={[
                  "text-xs uppercase tracking-[0.18em] font-bold",
                  isActive ? "text-[#F97316]" : "text-[#52525B]",
                ].join(" ")}
              >
                {tab.label}
              </span>
              {count > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#F4F4F5] text-[#52525B] rounded-sm">
                  {count}
                </span>
              )}
            </div>
            <div
              className={[
                "mt-1 font-mono-num text-sm",
                isActive ? "text-[#09090B] font-bold" : "text-[#71717A]",
              ].join(" ")}
            >
              {fmt(subtotal)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
