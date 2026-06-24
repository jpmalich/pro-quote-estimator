import React from "react";
import { useT } from "@/lib/i18n";
import { recomputeWasteQtys } from "@/lib/wasteLogic";

export default function SettingsRow({ est, update }) {
  const t = useT();
  const mode = est.pricing_mode || "margin";
  const isMargin = mode === "margin";
  // Iter 78 — Waste % change recomputes line.qty for any cut-prone line
  // that carries a stored raw_qty (i.e. came from a HOVER/Blueprint
  // import). Lines entered manually are untouched.
  const updateWastePct = (newPct) => {
    const lines = recomputeWasteQtys(est?.lines, newPct);
    update({ waste_pct: newPct, lines });
  };
  // Live preview of the multiplier so the contractor knows what %  actually does
  const pct = Math.min(Number(est.margin_pct) || 0, 99);
  const effectiveMultiplier = isMargin
    ? 1 / (1 - pct / 100)
    : 1 + pct / 100;
  // Windows-kind estimates price each opening individually (Vero W×H +
  // Mezzo W×H + per-line install qty), so the % siding waste factor
  // doesn't apply. Hide the card and let Sales Tax + Profit fill the row.
  const showWaste = est.kind !== "windows";

  return (
    <section className={`grid grid-cols-1 ${showWaste ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-6 mb-6`}>
      {showWaste && (
        <div className="card p-5" data-testid="waste-factor-card">
          <div className="section-tag mb-3">{t("est.wasteFactor")}</div>
          <div className="flex items-baseline gap-2">
            <input
              className="input num w-24"
              type="number"
              step="0.5"
              value={est.waste_pct || 0}
              onChange={(e) => updateWastePct(Number(e.target.value) || 0)}
              data-testid="waste-pct"
            />
            <span className="text-[#52525B]">{t("est.wasteSuffix")}</span>
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-wider text-[#A1A1AA]">
            {t("est.wasteHint")}
          </p>
          {/* Iter 78 — Waste is now baked directly into line qty on HOVER /
              Blueprint imports for siding, soffit, J-channel, finish trim,
              corners + starter. Changing the % here recomputes those line
              qtys (raw × 1+waste). Manual lines are untouched. */}
          <p className="mt-1 text-[10px] uppercase tracking-wider text-[#16A34A] font-bold">
            Baked into line qty on import — change % to recompute
          </p>
          {/* Iter 45: soffit overhang in inches — drives the
              Pieces = (Overhang × Length) ÷ panel-area formula on the
              Vinyl Soffit line. Lives in the same card as Waste Factor
              since it's the other knob that affects qty-not-price. */}
          <div className="mt-4 pt-4 border-t border-[#E4E4E7]">
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-2">
              {t("est.overhang")}
            </div>
            <div className="flex items-baseline gap-2">
              <input
                className="input num w-24"
                type="number"
                step="1"
                min="0"
                value={est.overhang_in ?? 12}
                onChange={(e) => update({ overhang_in: Number(e.target.value) || 0 })}
                data-testid="overhang-in"
              />
              <span className="text-[#52525B]">in</span>
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-wider text-[#A1A1AA]">
              {t("est.overhangHint")}
            </p>
          </div>
        </div>
      )}
      <div className="card p-5">
        <div className="section-tag mb-3">{t("est.salesTax")}</div>
        <label className="flex items-center gap-3 mb-3 text-sm">
          <input
            type="checkbox"
            checked={!!est.tax_enabled}
            onChange={(e) => update({ tax_enabled: e.target.checked })}
            data-testid="tax-toggle"
          />
          <span>{t("est.applyTaxOnMaterial")}</span>
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
          <div className="section-tag">{t("est.profit")}</div>
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
              {t("est.margin")}
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
              {t("est.markup")}
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
            {isMargin ? t("est.marginSuffix") : t("est.markupSuffix")}
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
