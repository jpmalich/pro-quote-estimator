// Build a print-ready Material List for a given estimate.
// Lists items with qty > 0, with AMI part #, description, unit, raw qty,
// and waste-applied qty. Renders via the existing /api/estimates/{id}/pdf
// endpoint (WeasyPrint).

import { tSection, tItem, tUnit } from "./catalogTranslations";

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const C = {
  ink: "#09090B",
  muted: "#52525B",
  faint: "#A1A1AA",
  line: "#D4D4D8",
  accent: "#F97316",
  bg: "#FAFAFA",
  bgRow: "#FAFAFA",
};

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Round qty UP to the nearest 0.5 — siding/coils don't come in fractional pieces.
function roundUpHalf(n) {
  if (!isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * 2) / 2;
}

function absUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${process.env.REACT_APP_BACKEND_URL}${path}`;
}

export function buildMaterialListHtml({ estimate, company, branding, lang = "en" }) {
  const wastePct = Number(estimate.waste_pct) || 0;
  // Group by TAB first, then by section. Section names like "Siding
  // Accessories" and "Vinyl Soffit with Siding" are shared between the
  // Vinyl and Ascend tabs — without a tab-level header the supplier
  // material list would mix items from both into one bucket.
  const TAB_LABEL = {
    vinyl: "Vinyl Siding",
    ascend: "Ascend Composite Siding",
    lp_smart: "LP SmartSide",
    windows: "Windows",
    iss: "ISS Siding",
  };
  const TAB_ORDER = ["vinyl", "ascend", "lp_smart", "windows", "iss"];
  const linesByTab = (estimate.lines || [])
    // Material list goes to Alside to pull materials — skip qty=0 and skip
    // labor-only items (mat=$0.00 like "Cap entry door") since there's
    // nothing for the supplier to pull for those.
    .filter((l) => (l.qty || 0) > 0 && (Number(l.mat) || 0) > 0)
    .reduce((acc, l) => {
      const tab = l.tab || "vinyl";
      (acc[tab] = acc[tab] || {});
      (acc[tab][l.section] = acc[tab][l.section] || []).push(l);
      return acc;
    }, {});
  const tabOrder = TAB_ORDER.filter((t) => linesByTab[t]);

  const supplierName = branding?.supplier_name || "Alside Supply";
  const companyName = company?.name || "Your Contractor";
  const logoUrl = company?.logo_url ? absUrl(company.logo_url) : null;

  const todayStr = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const sectionRows = ([sectionName, items]) => {
    // Iter 78 — waste is now baked into line.qty on import for cut-prone
    // items (siding, soffit, J, finish trim, corners, starter). For
    // those, line.raw_qty carries the original measurement so we can
    // display "Raw → Order" without re-applying waste here (which would
    // double-count). Lines entered manually have no raw_qty and the two
    // columns match.
    const rawOf = (l) => {
      const r = Number(l.raw_qty);
      return isFinite(r) && r > 0 ? r : Number(l.qty) || 0;
    };
    const orderOf = (l) => Number(l.qty) || 0;
    const totalRaw = items.reduce((s, l) => s + rawOf(l), 0);
    const totalOrder = items.reduce((s, l) => s + orderOf(l), 0);
    return (
      `<tr class="section-row"><td colspan="5">
        <span class="section-name">${esc(tSection(sectionName, lang))}</span>
        <span class="section-count">${items.length} item${items.length === 1 ? "" : "s"}</span>
      </td></tr>` +
      items
        .map((l) => {
          return `<tr class="item-row">
            <td class="cell-ami">${l.ami_part ? esc(l.ami_part) : '<span class="dim">—</span>'}</td>
            <td class="cell-desc">${esc(tItem(l.name, lang))}</td>
            <td class="cell-unit">${esc(tUnit(l.unit, lang))}</td>
            <td class="cell-num">${rawOf(l)}</td>
            <td class="cell-num cell-order">${orderOf(l)}</td>
          </tr>`;
        })
        .join("") +
      `<tr class="section-total">
        <td colspan="3"></td>
        <td class="cell-num">${totalRaw}</td>
        <td class="cell-num cell-order">${totalOrder}</td>
      </tr>`
    );
  };

  const sectionsHtml = tabOrder
    .map((tabId) => {
      const sectionsForTab = Object.entries(linesByTab[tabId])
        .map(sectionRows)
        .join("");
      return (
        `<tr class="tab-row"><td colspan="5">${esc(TAB_LABEL[tabId])}</td></tr>` +
        sectionsForTab
      );
    })
    .join("");
  const hasLines = tabOrder.length > 0;

  const colorCell = (label, value) => `
    <td class="color-cell">
      <div class="color-label">${esc(label)}</div>
      <div class="color-value">${
        value ? esc(value) : '<span class="dim">________________</span>'
      }</div>
    </td>`;

  return `<!doctype html>
<html lang="${lang === "es" ? "es" : "en"}">
<head>
<meta charset="utf-8">
<title>Material List — ${esc(estimate.estimate_number || "")}</title>
<style>
  /* Print page setup — WeasyPrint honors @page for margins and size. */
  @page { size: Letter; margin: 0.55in 0.55in 0.65in 0.55in; }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: #FFFFFF;
    font-family: ${FONT}; color: ${C.ink};
    -webkit-font-smoothing: antialiased;
  }

  /* --- HEADER --- */
  .header {
    width: 100%;
    border-bottom: 3px solid ${C.accent};
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .header td { vertical-align: middle; }
  .header .brand img { display: block; height: 42px; width: auto; max-width: 200px; }
  .header .brand .co-name { font-size: 20px; font-weight: 800; color: ${C.ink}; }
  .header .brand .doctype {
    margin-top: 5px;
    font-size: 9px;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
  }
  .header .meta { text-align: right; }
  .header .meta .lbl {
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
  }
  .header .meta .num {
    font-size: 16px;
    font-weight: 700;
    color: ${C.ink};
  }
  .header .meta .date { font-size: 11px; color: ${C.muted}; }

  /* --- JOB INFO --- */
  .jobinfo { width: 100%; margin-bottom: 16px; }
  .jobinfo td { vertical-align: top; padding-right: 12px; width: 33%; }
  .jobinfo td:last-child { padding-right: 0; }
  .jobinfo .lbl {
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
    margin-bottom: 2px;
  }
  .jobinfo .val { font-size: 13px; font-weight: 600; color: ${C.ink}; }
  .jobinfo .val.small { font-size: 12px; font-weight: 500; color: ${C.muted}; }

  /* --- WASTE NOTICE --- */
  .notice {
    background: ${C.bg};
    border-left: 3px solid ${C.accent};
    padding: 9px 13px;
    margin-bottom: 16px;
    font-size: 10.5px;
    color: ${C.muted};
    line-height: 1.45;
  }
  .notice strong { color: ${C.ink}; }

  /* --- COLORS BAND --- */
  .colors { width: 100%; border: 1px solid ${C.line}; margin-bottom: 18px; }
  .colors .colors-head td {
    background: ${C.bg};
    padding: 5px 12px;
    font-size: 9px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
    border-bottom: 1px solid ${C.line};
  }
  .colors .color-cell {
    width: 25%;
    vertical-align: top;
    padding: 8px 12px;
    border-right: 1px solid ${C.line};
  }
  .colors .color-cell:last-child { border-right: none; }
  .colors .color-label {
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
    margin-bottom: 3px;
  }
  .colors .color-value {
    font-size: 13px;
    font-weight: 600;
    color: ${C.ink};
    min-height: 18px;
  }

  /* --- MATERIAL TABLE --- */
  .materials {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed; /* critical for alignment — locks col widths from <colgroup> */
  }
  .materials thead th {
    padding: 7px 8px;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: ${C.faint};
    font-weight: bold;
    border-bottom: 2px solid ${C.ink};
    vertical-align: bottom;
  }
  .materials thead .th-order { background: ${C.bg}; }
  .materials thead .th-order small {
    display: block;
    font-size: 7.5px;
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
    color: ${C.muted};
    margin-top: 1px;
  }
  .materials .tab-row td {
    padding: 22px 8px 6px 8px;
    border-bottom: 3px solid ${C.ink};
    font-size: 12.5px;
    font-weight: bold;
    letter-spacing: 2.4px;
    text-transform: uppercase;
    color: ${C.ink};
    background: ${C.bg};
  }
  .materials .section-row td {
    padding: 14px 8px 5px 8px;
    border-bottom: 1px solid ${C.ink};
    font-size: 10.5px;
    font-weight: bold;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    color: ${C.accent};
  }
  .materials .section-row .section-count {
    float: right;
    color: ${C.muted};
    font-weight: 600;
    letter-spacing: 1px;
  }
  .materials .item-row td {
    padding: 7px 8px;
    border-bottom: 1px solid ${C.line};
    vertical-align: middle;
    font-size: 12.5px;
  }
  .materials .item-row .cell-ami {
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: ${C.muted};
    white-space: nowrap;
  }
  .materials .item-row .cell-desc { color: ${C.ink}; word-wrap: break-word; }
  .materials .item-row .cell-unit {
    text-align: center;
    color: ${C.muted};
    font-size: 11.5px;
  }
  .materials .cell-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: ${C.ink};
  }
  .materials .cell-order {
    background: ${C.bg};
    font-weight: 700;
  }
  .materials .section-total td {
    padding: 6px 8px;
    border-top: 1px solid ${C.ink};
    border-bottom: 1px solid transparent;
    font-size: 10.5px;
    color: ${C.faint};
  }
  .materials .section-total .cell-num { color: ${C.faint}; font-weight: 600; }
  .materials .section-total .cell-order { background: ${C.bg}; }
  .dim { color: ${C.faint}; font-weight: normal; }

  /* --- EMPTY STATE --- */
  .empty {
    padding: 28px;
    text-align: center;
    border: 1px dashed ${C.line};
    color: ${C.muted};
    font-size: 12px;
  }

  /* --- FOOTER --- */
  .footer {
    margin-top: 26px;
    padding-top: 12px;
    border-top: 1px solid ${C.line};
    font-size: 10px;
    color: ${C.faint};
    text-align: center;
  }
</style>
</head>
<body>
  <table class="header" cellspacing="0" cellpadding="0"><tr>
    <td class="brand">
      ${
        logoUrl
          ? `<img src="${logoUrl}" alt="${esc(companyName)}">`
          : `<div class="co-name">${esc(companyName)}</div>`
      }
      <div class="doctype">Material List</div>
    </td>
    <td class="meta">
      <div class="lbl">Estimate</div>
      <div class="num">${esc(estimate.estimate_number || "—")}</div>
      <div class="date">Printed ${esc(todayStr)}</div>
    </td>
  </tr></table>

  <table class="jobinfo" cellspacing="0" cellpadding="0"><tr>
    <td>
      <div class="lbl">Customer</div>
      <div class="val">${esc(estimate.customer_name || "—")}</div>
    </td>
    <td>
      <div class="lbl">Job Address</div>
      <div class="val small">${esc(estimate.address || "—")}</div>
    </td>
    <td>
      <div class="lbl">Estimator</div>
      <div class="val">${esc(estimate.estimator || "—")}</div>
    </td>
  </tr></table>

  <div class="notice">
    <strong>Order Quantity</strong> shows the qty <em>with</em> ${wastePct}% waste factor applied (rounded up).
    Hand this list to ${esc(supplierName)} to pull / quote materials.
  </div>

  <table class="colors" cellspacing="0" cellpadding="0">
    <tr class="colors-head"><td colspan="6">Material Colors</td></tr>
    <tr>
      ${colorCell(estimate.kind === "lp_smart" ? "LP Siding" : "Siding", estimate.siding_color)}
      ${estimate.kind === "lp_smart" ? "" : colorCell("Ascend", estimate.ascend_color)}
      ${estimate.kind === "lp_smart" ? "" : colorCell("Shake (Pelican Bay)", estimate.shake_color)}
      ${colorCell("Board & Batten", estimate.board_batten_color)}
      ${colorCell(estimate.kind === "lp_smart" ? "Trim" : "Accessories", estimate.accessories_color)}
      ${colorCell("Outside Corner", estimate.outside_corner_color)}
      ${colorCell("Soffit / Fascia", estimate.soffit_fascia_color)}
      ${estimate.kind === "lp_smart" ? "" : colorCell("Window Wrap", estimate.window_wrap_color)}
      ${colorCell("Gutter / Downspout", estimate.gutter_color)}
    </tr>
  </table>

  ${
    (estimate.window_frame_color || estimate.window_interior_color || estimate.window_exterior_color)
      ? `<table class="colors" cellspacing="0" cellpadding="0">
    <tr class="colors-head"><td colspan="3">Window Colors</td></tr>
    <tr>
      ${colorCell("Frame", estimate.window_frame_color)}
      ${colorCell("Interior", estimate.window_interior_color)}
      ${colorCell("Exterior", estimate.window_exterior_color)}
    </tr>
  </table>`
      : ""
  }

  ${
    hasLines
      ? `<table class="materials" cellspacing="0" cellpadding="0">
    <colgroup>
      <col style="width: 14%;">
      <col style="width: 50%;">
      <col style="width: 9%;">
      <col style="width: 12%;">
      <col style="width: 15%;">
    </colgroup>
    <thead>
      <tr>
        <th style="text-align:left;">AMI #</th>
        <th style="text-align:left;">Description</th>
        <th style="text-align:center;">Unit</th>
        <th style="text-align:right;">Job Qty</th>
        <th class="th-order" style="text-align:right;">Order Qty<small>+${wastePct}% waste</small></th>
      </tr>
    </thead>
    <tbody>${sectionsHtml}</tbody>
  </table>`
      : `<div class="empty">No materials yet. Add quantities on the estimate, then print the material list.</div>`
  }

  <div class="footer">
    Prepared by ${esc(companyName)} · Materials supplied by ${esc(supplierName)}
  </div>
</body>
</html>`;
}

export function materialListFilename(estimate) {
  const parts = [];
  if (estimate.estimate_number) parts.push(estimate.estimate_number);
  if (estimate.customer_name) parts.push(estimate.customer_name.replace(/\s+/g, "_"));
  parts.push("materials");
  return `${parts.join("-")}.pdf`;
}
