// Takeoff Reconciliation Card
//
// Iter 78 (LETRICK follow-up): drop-in panel rendered inside the HOVER
// import and Blueprint Read preview modals. Shows three columns per row
// so Howard can spot drift between what the AI/HOVER returned and what
// the catalog will actually quote:
//
//   • Raw measurement   — the source number (eaves_lf, siding_sqft, etc.)
//   • Formula yields    — the line-qty the catalog mapper produced
//   • Order at X% waste — formula qty × (1 + waste/100), only for items
//                         where waste applies (siding + soffit panels)
//
// Reads `measurements` + `lines` from the takeoff result and the
// estimate's `waste_pct`. Pure presentation — no side effects.
import React from "react";

// Items to surface, in display order. Each entry maps:
//   label  — what the contractor sees
//   raw    — function(measurements) → "108 LF" / "1,800 ft²" / "—"
//   item   — exact catalog item name to look up in `lines`
//   tab    — which tab the line lives on (vinyl is the canonical
//             takeoff target — other tabs mirror)
//   waste  — true if catalog-level waste applies (Siding, Soffit panels)
const RECON_ROWS = [
  {
    label: "Siding",
    raw: (m) => fmtSq(m.siding_sqft),
    item: "Install Vinyl Siding",
    tab: "vinyl",
    waste: true,
  },
  {
    label: "Outside corners",
    raw: (m) => fmtLf(m.outside_corner_lf),
    item: "Outside corners Standard color",
    tab: "vinyl",
    waste: false,
  },
  {
    label: "Inside corners",
    raw: (m) => fmtLf(m.inside_corner_lf),
    item: "Inside Corners (Siding) Standard color",
    tab: "vinyl",
    waste: false,
  },
  {
    label: "J-Channel",
    raw: () => "—",
    item: '3/4" J-Channel Standard color (2 per Sq of siding)',
    tab: "vinyl",
    waste: false,
  },
  {
    label: "Finish Trim",
    raw: () => "—",
    item: "Finish Trim Standard color",
    tab: "vinyl",
    waste: false,
  },
  {
    label: "Soffit (Charter Oak)",
    raw: (m) => fmtSqft(m.soffit_sqft),
    item: "Charter Oak Soffit Standard color",
    tab: "vinyl",
    waste: true,
  },
  {
    label: "Soffit J-Channel",
    raw: () => "—",
    item: '3/4" Soffit J-Channel (Charter Oak) Standard color',
    tab: "vinyl",
    waste: false,
  },
  {
    label: "Gutter",
    raw: (m) => fmtLf(m.eaves_lf),
    item: 'Gutter 6"',
    tab: "vinyl",
    waste: false,
  },
  {
    label: "Downspouts",
    raw: () => "—",
    item: 'Downspout 6"',
    tab: "vinyl",
    waste: false,
  },
  {
    label: "End caps",
    raw: () => "—",
    item: "End Cap",
    tab: "vinyl",
    waste: false,
  },
];

const num = (v) => (v == null ? null : Number(v));
const fmt = (v, decimals = 0) =>
  v == null || isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
      });
const fmtLf = (v) => (v == null ? "—" : `${fmt(v, 0)} LF`);
const fmtSqft = (v) => (v == null ? "—" : `${fmt(v, 0)} ft²`);
const fmtSq = (v) => {
  const n = num(v);
  if (n == null || isNaN(n)) return "—";
  return `${(n / 100).toFixed(1)} SQ`;
};

const roundUpHalf = (n) => {
  const x = Number(n);
  if (!isFinite(x) || x <= 0) return 0;
  return Math.ceil(x * 2) / 2;
};

export default function TakeoffReconCard({ measurements, lines, wastePct = 0 }) {
  if (!measurements || !lines || !lines.length) return null;
  const pct = Math.max(0, Number(wastePct) || 0);

  // Build a quick lookup: item name (lowercase) → first matching line.
  // Prefer same-tab matches; fall back to any tab so kind=ascend or
  // kind=lp estimates still surface a row.
  const byName = (name, tab) => {
    const lc = (name || "").toLowerCase();
    return (
      lines.find(
        (l) =>
          (l.name || "").toLowerCase() === lc && (l.tab || "vinyl") === tab
      ) ||
      lines.find((l) => (l.name || "").toLowerCase() === lc) ||
      null
    );
  };

  const rows = RECON_ROWS.map((r) => {
    const ln = byName(r.item, r.tab);
    if (!ln) return null;
    const qty = Number(ln.qty) || 0;
    const unit = ln.unit || "";
    const orderQty = r.waste ? roundUpHalf(qty * (1 + pct / 100)) : qty;
    return {
      label: r.label,
      raw: r.raw(measurements),
      formula: qty > 0 ? `${fmt(qty, 1)} ${unit}` : "—",
      order: orderQty > 0 ? `${fmt(orderQty, 1)} ${unit}` : "—",
      drift: r.waste && pct > 0 && orderQty > qty,
    };
  }).filter(Boolean);

  if (!rows.length) return null;

  return (
    <section
      className="p-5 border-b border-[#E4E4E7] bg-white"
      data-testid="takeoff-recon-card"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider font-bold text-[#A1A1AA]">
          Takeoff Reconciliation
        </div>
        <div className="text-[10px] uppercase tracking-wider text-[#71717A]">
          Waste · <span className="font-bold text-[#09090B]">{pct}%</span>{" "}
          <span className="text-[#A1A1AA]">(Siding + Soffit panels only)</span>
        </div>
      </div>
      <p className="text-[11px] text-[#52525B] leading-snug mb-3">
        AI reads the raw measurements; the catalog mapper converts them to
        line quantities; the Order column applies the waste factor so you
        can spot drift against what you&apos;d actually need to order.
      </p>
      <div className="border border-[#E4E4E7] overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[#FAFAFA] text-[10px] uppercase tracking-wider text-[#71717A]">
            <tr>
              <th className="text-left px-3 py-2">Item</th>
              <th className="text-right px-3 py-2 w-32">AI raw</th>
              <th className="text-right px-3 py-2 w-32">Formula yields</th>
              <th className="text-right px-3 py-2 w-36">
                Order @ {pct}% waste
              </th>
            </tr>
          </thead>
          <tbody className="font-mono-num">
            {rows.map((r, i) => (
              <tr
                key={r.label}
                className={i % 2 ? "bg-white" : "bg-[#FAFAFA]"}
                data-testid={`recon-row-${r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <td className="px-3 py-1.5 text-[#09090B] font-bold font-sans">
                  {r.label}
                </td>
                <td className="px-3 py-1.5 text-right text-[#52525B]">{r.raw}</td>
                <td className="px-3 py-1.5 text-right text-[#09090B]">
                  {r.formula}
                </td>
                <td
                  className={`px-3 py-1.5 text-right ${
                    r.drift ? "text-[#F97316] font-bold" : "text-[#09090B]"
                  }`}
                >
                  {r.order}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
