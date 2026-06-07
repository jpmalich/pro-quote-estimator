import React, { useMemo } from "react";
import { LayoutGrid, Hammer, Boxes } from "lucide-react";

const fmt = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

// Same 6 shared sections the Mezzo snapshot uses — Vero shares Install,
// Trim and Material List with Mezzo via product_lines["vero","mezzo"].
const MATERIAL_SECTIONS = new Set(["Window Material List"]);
const INSTALL_SECTIONS = new Set([
  "Window Installation",
  "Sliding Glass Door Install",
  "Window Exterior Trim Work",
  "Window Interior Trim Work",
  "Window Misc.",
]);

/**
 * At-a-glance Vero tab snapshot. Mirrors MezzoJobSnapshot but reads
 * `est.vero_openings`. Each opening's per-window price stack =
 *   base + glass + tempered + premium (all snapshotted by VeroPanel).
 */
export default function VeroJobSnapshot({ est }) {
  const snapshot = useMemo(() => {
    const openings = est?.vero_openings || [];
    const openingCount = openings.reduce((s, o) => s + (Number(o.qty) || 0), 0);
    const openingDollars = openings.reduce((sum, o) => {
      const per = (Number(o.base_mat) || 0)
        + (Number(o.glass_mat) || 0)
        + (Number(o.tempered_mat) || 0)
        + (Number(o.premium_mat) || 0);
      return sum + (Number(o.qty) || 0) * per;
    }, 0);

    const veroLines = (est?.lines || []).filter(
      (l) => (l.tab || "vinyl") === "vero" && (Number(l.qty) || 0) > 0
    );
    let installDollars = 0;
    let installLineCount = 0;
    let materialDollars = 0;
    let materialLineCount = 0;
    for (const l of veroLines) {
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
    snapshot.openingCount === 0
    && snapshot.installLineCount === 0
    && snapshot.materialLineCount === 0;

  return (
    <section className="card mb-4 overflow-hidden" data-testid="vero-job-snapshot">
      <header className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA]">
        <div>
          <div className="section-tag">Vero Job Snapshot</div>
          <div className="text-[10px] text-[#A1A1AA] mt-0.5">
            openings · install + trim labor · material rolls
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">Base Total</div>
          <div
            className="font-mono-num text-2xl font-bold text-[#09090B] leading-tight"
            data-testid="vero-snapshot-total"
          >
            {fmt(snapshot.total)}
          </div>
        </div>
      </header>
      {isEmpty ? (
        <div className="px-5 py-5 text-center text-[12px] text-[#A1A1AA]">
          Add an opening above or enter a qty on any window-install /
          trim row below — totals will populate here in real time.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-[#E4E4E7]">
          <StatTile
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            label="Window Openings"
            value={`${snapshot.openingCount} window${snapshot.openingCount === 1 ? "" : "s"}`}
            sub={fmt(snapshot.openingDollars)}
            accent="orange"
            testid="vero-snapshot-openings"
          />
          <StatTile
            icon={<Hammer className="w-3.5 h-3.5" />}
            label="Install + Trim"
            value={fmt(snapshot.installDollars)}
            sub={`${snapshot.installLineCount} line${snapshot.installLineCount === 1 ? "" : "s"} · labor`}
            accent="black"
            testid="vero-snapshot-install"
          />
          <StatTile
            icon={<Boxes className="w-3.5 h-3.5" />}
            label="Material List"
            value={fmt(snapshot.materialDollars)}
            sub={`${snapshot.materialLineCount} roll line${snapshot.materialLineCount === 1 ? "" : "s"}`}
            accent="muted"
            testid="vero-snapshot-material"
          />
        </div>
      )}
    </section>
  );
}

function StatTile({ icon, label, value, sub, accent, testid }) {
  const accentText =
    accent === "orange" ? "text-[#F97316]"
      : accent === "black" ? "text-[#09090B]"
        : "text-[#52525B]";
  const accentBg =
    accent === "orange" ? "bg-[#FFF7ED]"
      : accent === "black" ? "bg-[#FAFAFA]"
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
        <div className="text-[11px] text-[#71717A] font-mono-num mt-0.5 truncate" title={sub}>{sub}</div>
      ) : null}
    </div>
  );
}
