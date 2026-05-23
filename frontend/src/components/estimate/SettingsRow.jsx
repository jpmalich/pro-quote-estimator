import React from "react";

export default function SettingsRow({ est, update }) {
  const mode = est.pricing_mode || "margin";
  const isMargin = mode === "margin";
  // Live preview of the multiplier so the contractor knows what %  actually does
  const pct = Math.min(Number(est.margin_pct) || 0, 99);
  const effectiveMultiplier = isMargin
    ? 1 / (1 - pct / 100)
    : 1 + pct / 100;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
      <div className="card p-5">
        <div className="section-tag mb-3">Waste Factor</div>
        <div className="flex items-baseline gap-2">
          <input
            className="input num w-24"
            type="number"
            step="0.5"
            value={est.waste_pct || 0}
            onChange={(e) => update({ waste_pct: Number(e.target.value) || 0 })}
            data-testid="waste-pct"
          />
          <span className="text-[#52525B]">% extra material</span>
        </div>
      </div>
      <div className="card p-5">
        <div className="section-tag mb-3">Sales Tax</div>
        <label className="flex items-center gap-3 mb-3 text-sm">
          <input
            type="checkbox"
            checked={!!est.tax_enabled}
            onChange={(e) => update({ tax_enabled: e.target.checked })}
            data-testid="tax-toggle"
          />
          <span>Apply tax on material</span>
        </label>
        <div className="flex items-baseline gap-2">
          <input
            className="input num w-24"
            type="number"
            step="0.01"
            disabled={!est.tax_enabled}
            value={est.tax_rate || 0}
            onChange={(e) => update({ tax_rate: Number(e.target.value) || 0 })}
            data-testid="tax-rate"
          />
          <span className="text-[#52525B]">%</span>
        </div>
      </div>
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="section-tag">Profit</div>
          <div
            className="inline-flex border border-[#E4E4E7] rounded-sm overflow-hidden text-[11px] font-bold uppercase tracking-wider"
            data-testid="pricing-mode-toggle"
          >
            <button
              type="button"
              className={`px-3 py-1.5 transition ${
                isMargin
                  ? "bg-[#09090B] text-white"
                  : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
              }`}
              onClick={() => update({ pricing_mode: "margin" })}
              data-testid="pricing-mode-margin"
            >
              Margin
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 transition border-l border-[#E4E4E7] ${
                !isMargin
                  ? "bg-[#09090B] text-white"
                  : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
              }`}
              onClick={() => update({ pricing_mode: "markup" })}
              data-testid="pricing-mode-markup"
            >
              Markup
            </button>
          </div>
        </div>
        <div className="flex items-baseline gap-2 mb-2">
          <input
            className="input num w-24"
            type="number"
            step="1"
            min="0"
            max={isMargin ? 99 : undefined}
            value={est.margin_pct || 0}
            onChange={(e) => update({ margin_pct: Number(e.target.value) || 0 })}
            data-testid="margin-pct"
          />
          <span className="text-[#52525B]">
            % {isMargin ? "profit margin" : "markup on base"}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max={isMargin ? 95 : 100}
          step="1"
          value={est.margin_pct || 0}
          onChange={(e) => update({ margin_pct: Number(e.target.value) || 0 })}
          className="w-full accent-[#F97316]"
          data-testid="margin-slider"
        />
        <div className="mt-2 text-[11px] text-[#71717A] font-mono-num">
          {isMargin ? (
            <>
              Sell = Base ÷ (1 − {pct}%) ={" "}
              <span className="text-[#09090B] font-bold">
                ×{effectiveMultiplier.toFixed(3)}
              </span>
            </>
          ) : (
            <>
              Sell = Base × (1 + {pct}%) ={" "}
              <span className="text-[#09090B] font-bold">
                ×{effectiveMultiplier.toFixed(3)}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
