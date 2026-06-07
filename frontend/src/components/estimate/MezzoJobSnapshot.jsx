import React, { useMemo } from "react";
import { LayoutGrid, Hammer, Boxes } from "lucide-react";
import { useT } from "@/lib/i18n";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

// Which catalog sections roll into each snapshot bucket. Kept in sync with
// the 6 sections that gained "mezzo" in product_lines (see catalog_seed.py).
const MATERIAL_SECTIONS = new Set(["Window Material List"]);
const INSTALL_SECTIONS = new Set([
  "Window Installation",
  "Sliding Glass Door Install",
  "Window Exterior Trim Work",
  "Window Interior Trim Work",
  "Window Misc.",
]);

/**
 * At-a-glance snapshot of every dollar landing on the Mezzo tab —
 * window openings (W×H matrix) + install/trim labor + coil/material rolls.
 * Renders ONLY when the contractor is on the Mezzo tab so the Vero tab
 * stays uncluttered.
 */
export default function MezzoJobSnapshot({ est }) {
  const t = useT();
  const snapshot = useMemo(() => {
    const openings = est?.mezzo_openings || [];
    const openingCount = openings.reduce((s, o) => s + (Number(o.qty) || 0), 0);
    const openingDollars = openings.reduce((sum, o) => {
      const baseTotal = (Number(o.qty) || 0) * (Number(o.base_mat) || 0);
      const addersTotal = (o.adders || []).reduce(
        (a, ad) => a + (Number(ad.qty) || 0) * (Number(ad.mat) || 0),
        0
      );
      return sum + baseTotal + addersTotal;
    }, 0);

    const mezzoLines = (est?.lines || []).filter(
      (l) => (l.tab || "vinyl") === "mezzo" && (Number(l.qty) || 0) > 0
    );

    let installDollars = 0;
    let installLineCount = 0;
    let materialDollars = 0;
    let materialLineCount = 0;
    for (const l of mezzoLines) {
      const qty = Number(l.qty) || 0;
      const lineMat = qty * (Number(l.mat) || 0);
      const lineLab = qty * (Number(l.lab) || 0);
      const addersTotal = (l.adders || []).reduce(
        (a, ad) => a + (Number(ad.qty) || 0) * ((Number(ad.mat) || 0) + (Number(ad.lab) || 0)),
        0
      );
      if (MATERIAL_SECTIONS.has(l.section)) {
        materialDollars += lineMat + lineLab + addersTotal;
        materialLineCount += 1;
      } else if (INSTALL_SECTIONS.has(l.section)) {
        installDollars += lineMat + lineLab + addersTotal;
        installLineCount += 1;
      }
    }

    return {
      openingCount,
      openingDollars,
      installDollars,
      installLineCount,
      materialDollars,
      materialLineCount,
      total: openingDollars + installDollars + materialDollars,
    };
  }, [est]);

  const isEmpty =
    snapshot.openingCount === 0 &&
    snapshot.installLineCount === 0 &&
    snapshot.materialLineCount === 0;

  return (
    <section
      className="card mb-4 overflow-hidden"
      data-testid="mezzo-job-snapshot"
    >
      <header className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA]">
        <div>
          <div className="section-tag">Mezzo {t("win.snapshot")}</div>
          <div className="text-[10px] text-[#A1A1AA] mt-0.5">
            {t("win.snapshot.subtitle")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">
            {t("win.snapshot.baseTotal")}
          </div>
          <div
            className="font-mono-num text-2xl font-bold text-[#09090B] leading-tight"
            data-testid="mezzo-snapshot-total"
          >
            {fmt(snapshot.total)}
          </div>
        </div>
      </header>

      {isEmpty ? (
        <div className="px-5 py-5 text-center text-[12px] text-[#A1A1AA]">
          {t("win.snapshot.empty")}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-[#E4E4E7]">
          <StatTile
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            label={t("win.snapshot.openings")}
            value={t(snapshot.openingCount === 1 ? "win.snapshot.windowsCount" : "win.snapshot.windowsCountPlural", { n: snapshot.openingCount })}
            sub={fmt(snapshot.openingDollars)}
            accent="orange"
            testid="mezzo-snapshot-openings"
          />
          <StatTile
            icon={<Hammer className="w-3.5 h-3.5" />}
            label={t("win.snapshot.installTrim")}
            value={fmt(snapshot.installDollars)}
            sub={t(snapshot.installLineCount === 1 ? "win.snapshot.installSub" : "win.snapshot.installSubPlural", { n: snapshot.installLineCount })}
            accent="black"
            testid="mezzo-snapshot-install"
          />
          <StatTile
            icon={<Boxes className="w-3.5 h-3.5" />}
            label={t("win.snapshot.material")}
            value={fmt(snapshot.materialDollars)}
            sub={t(snapshot.materialLineCount === 1 ? "win.snapshot.materialSub" : "win.snapshot.materialSubPlural", { n: snapshot.materialLineCount })}
            accent="muted"
            testid="mezzo-snapshot-material"
          />
        </div>
      )}
    </section>
  );
}

function StatTile({ icon, label, value, sub, accent, testid }) {
  const accentText =
    accent === "orange"
      ? "text-[#F97316]"
      : accent === "black"
        ? "text-[#09090B]"
        : "text-[#52525B]";
  const accentBg =
    accent === "orange"
      ? "bg-[#FFF7ED]"
      : accent === "black"
        ? "bg-[#FAFAFA]"
        : "bg-white";
  return (
    <div className={`px-4 md:px-5 py-3 ${accentBg}`} data-testid={testid}>
      <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-bold ${accentText}`}>
        {icon}
        <span className="text-[#52525B]">{label}</span>
      </div>
      <div className={`font-mono-num text-lg font-bold mt-1.5 ${accent === "muted" ? "text-[#3F3F46]" : "text-[#09090B]"}`}>
        {value}
      </div>
      {sub ? (
        <div className="text-[11px] text-[#71717A] font-mono-num mt-0.5 truncate" title={sub}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
