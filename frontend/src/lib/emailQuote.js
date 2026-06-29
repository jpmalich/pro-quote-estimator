// Build an email-safe HTML quote.
// Uses table-based layout and inline styles only — required for Gmail / Outlook / Apple Mail.
// Tailwind class names do not survive email clients; everything must be inlined.
import { tFor } from "./i18n";
import { tSection, tItem, tUnit } from "./catalogTranslations";
// Iter 78t — Elevation drawings are intentionally OMITTED from the
// customer quote PDF / email. The current 2D SVGs are useful as an
// internal contractor cross-check but openings are positioned
// approximately (no true 3D placement). Until we can do a real
// 3D render, the customer-facing document stays drawing-free to
// preserve perceived quality. Contractors still see them in-app
// (see `ElevationDrawing.jsx`) and can nudge openings interactively.
// import { buildElevationsBlock } from "./emailElevations";

const $ = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

// Brand palette — keep in sync with /app/frontend/src/index.css
const C = {
  ink: "#09090B",
  muted: "#52525B",
  faint: "#A1A1AA",
  line: "#E4E4E7",
  accent: "#F97316",
  bg: "#FAFAFA",
};

const FONT =
  "'Helvetica Neue', Helvetica, Arial, sans-serif";

function absUrl(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${process.env.REACT_APP_BACKEND_URL}${path}`;
}

// Add 30 days to the estimate date (or today, if missing) and return e.g. "Mar 16, 2026" / "16 mar 2026".
function computeExpiry(estimateDate, lang = "en") {
  const base = estimateDate ? new Date(estimateDate) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + 30);
  const locale = lang === "es" ? "es-US" : "en-US";
  return base.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}


export function buildEmailHtml({ estimate, totals, company, branding, message, acceptEmail, acceptUrl, lang = "en" }) {
  const t = (key, vars) => tFor(lang, key, vars);
  const htmlLang = lang === "es" ? "es" : "en";
  const linesByCat = (estimate.lines || [])
    .filter((l) => (l.qty || 0) > 0)
    .reduce((acc, l) => {
      (acc[l.section] = acc[l.section] || []).push(l);
      return acc;
    }, {});

  const showSupplierFooter = company?.quote_footer_enabled !== false;
  const supplierName = branding?.supplier_name || "Alside Supply";
  const companyName = company?.name || "Your Contractor";
  const logoUrl = company?.logo_url ? absUrl(company.logo_url) : null;
  const expiryStr = computeExpiry(estimate.estimate_date, lang);
  const estNumDisplay = estimate.estimate_number ? `#${estimate.estimate_number}` : "";

  // Prefer the hosted accept page (one-click). Fall back to a mailto pre-fill
  // for older callers that don't supply an accept URL.
  const mailtoHref = acceptEmail
    ? `mailto:${encodeURIComponent(acceptEmail)}` +
      `?subject=${encodeURIComponent(`Accepting estimate ${estimate.estimate_number || ""} — ${estimate.customer_name || ""}`)}` +
      `&body=${encodeURIComponent(
        `Hi,\n\nI'd like to accept the estimate ${estNumDisplay} for ${$(totals.sell)} as quoted.\nPlease let me know the next steps.\n\nThanks,\n${estimate.customer_name || ""}`
      )}`
    : null;
  const acceptHref = acceptUrl || mailtoHref;

  // ---- Builders -----------------------------------------------------------
  const cell = (content, extra = "") =>
    `<td style="padding:0;font-family:${FONT};color:${C.ink};${extra}">${content}</td>`;

  // Sections that contain the headline siding product — used to decide
  // where to inject the "Materials excluded" note (brick / stone / garage
  // zones masked off during Photo Measure).
  const SIDING_SECTIONS = new Set([
    "Vinyl Siding",
    "Ascend Cladding",
    "LP Smart Siding",
  ]);
  // Iter 78aj — soffit sections show a tiny "Includes XXX sqft of
  // porch ceiling" caption below the items so the homeowner sees
  // exactly what they're paying for instead of wondering "why is the
  // soffit count higher than I expected?".
  const SOFFIT_SECTIONS = new Set([
    "Vinyl Soffit with Siding",
    "LP SmartSide Soffit",
  ]);
  const zonesSummary = (estimate.photo_zones_summary || "").trim();
  const zonesDeducted = Number(estimate.photo_zones_deducted_sqft || 0);
  const renderExcludedNote = () =>
    zonesSummary
      ? `
      <tr>
        <td style="padding:6px 0 10px 0;font-family:${FONT};font-size:12px;color:${C.muted};font-style:italic;border-bottom:1px solid ${C.line};">
          ${esc(t("email.materialsExcluded"))}: ${esc(zonesSummary)}${zonesDeducted > 0 ? ` <span style="color:${C.faint};">(${zonesDeducted} ft² total)</span>` : ""}
        </td>
      </tr>`
      : "";

  // Iter 78aj — porch ceiling caption: "Includes 220 sqft of porch
  // ceiling (Front Porch 22'×10')". Only renders when the estimate has
  // at least one porch with non-zero area.
  const porches = Array.isArray(estimate.porch_ceilings) ? estimate.porch_ceilings : [];
  const sizedPorches = porches.filter(
    (p) => (Number(p.length_ft) || 0) > 0 && (Number(p.width_ft) || 0) > 0
  );
  const porchTotalSqft = sizedPorches.reduce(
    (s, p) => s + Number(p.length_ft) * Number(p.width_ft),
    0
  );
  const renderPorchCeilingNote = () => {
    if (porchTotalSqft <= 0) return "";
    const plural = sizedPorches.length > 1 ? "s" : "";
    const label = t("email.porchCeilingsIncluded").replace("{plural}", plural);
    const detail = sizedPorches
      .map((p) => {
        const tag = (p.label || "").trim();
        const dims = `${Number(p.length_ft)}'×${Number(p.width_ft)}'`;
        return tag ? `${esc(tag)} ${dims}` : dims;
      })
      .join(" · ");
    return `
      <tr>
        <td style="padding:6px 0 10px 0;font-family:${FONT};font-size:12px;color:${C.muted};font-style:italic;border-bottom:1px solid ${C.line};">
          ${esc(label)}: <strong style="color:${C.ink};">${Math.round(porchTotalSqft)} ft²</strong> <span style="color:${C.faint};">(${detail})</span>
        </td>
      </tr>`;
  };

  const sectionBlock = ([section, items]) => `
    <tr><td style="padding:18px 0 6px 0;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:${C.accent};border-bottom:1px solid ${C.ink};">${esc(tSection(section, lang))}</td></tr>
    ${items
      .map(
        (l) => `
      <tr>
        <td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${C.ink};border-bottom:1px solid ${C.line};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding:0;font-family:${FONT};font-size:14px;color:${C.ink};">${esc(tItem(l.name, lang))}</td>
              <td align="right" style="padding:0;font-family:${FONT};font-size:13px;color:${C.muted};white-space:nowrap;">${esc(l.qty)} ${esc(tUnit(l.unit, lang))}</td>
            </tr>
          </table>
        </td>
      </tr>`
      )
      .join("")}
    ${SIDING_SECTIONS.has(section) ? renderExcludedNote() : ""}
    ${SOFFIT_SECTIONS.has(section) ? renderPorchCeilingNote() : ""}
  `;

  const photoGrid = (estimate.photos || []).length
    ? `
      <tr><td style="padding:24px 0 8px 0;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:${C.faint};">${esc(t("email.jobPhotos"))}</td></tr>
      <tr><td style="padding:0;">
        <table role="presentation" width="100%" cellspacing="6" cellpadding="0" border="0"><tr>
          ${estimate.photos
            .slice(0, 6)
            .map(
              (p) => `
            <td width="33%" style="padding:0;">
              <img src="${absUrl(p)}" alt="" width="170" style="display:block;width:100%;max-width:170px;height:auto;border:1px solid ${C.line};border-radius:2px;">
            </td>`
            )
            .join("")}
        </tr></table>
      </td></tr>`
    : "";

  const intro = (message || "").trim()
    ? `
    <tr><td style="padding:18px 32px 0 32px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.ink};white-space:pre-line;">
      ${nl2br(message)}
    </td></tr>`
    : "";

  // Iter 71 — Per-Elevation Breakdown card. Pulled from HOVER measurements
  // persisted on the estimate (hover_measurements.per_elevation_siding).
  // Shows the homeowner exactly which side of the house is driving the
  // siding cost — natural lead-in for "want to do front + sides only?"
  // conversations. Hidden when measurements weren't imported from HOVER
  // (manual / Photo Measure / AI Measure estimates skip this section).
  const elevations = estimate.hover_measurements?.per_elevation_siding || null;
  const elevationEntries = elevations
    ? Object.entries(elevations).filter(([, v]) => Number(v) > 0)
    : [];
  const elevationTotal = elevationEntries.reduce(
    (s, [, v]) => s + Number(v || 0), 0
  );
  const elevationLabel = {
    front: t("email.elevationFront"),
    back: t("email.elevationBack"),
    left: t("email.elevationLeft"),
    right: t("email.elevationRight"),
  };
  const elevationBlock = elevationEntries.length > 0
    ? `
    <tr><td style="padding:18px 32px 8px 32px;border-top:1px solid ${C.line};font-family:${FONT};">
      <div style="font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:10px;">${esc(t("email.elevationTitle"))}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        ${elevationEntries.map(([key, sqft]) => {
          const pct = elevationTotal > 0 ? Math.round((Number(sqft) / elevationTotal) * 100) : 0;
          const label = elevationLabel[key] || key;
          return `
        <tr>
          <td style="padding:8px 0;font-family:${FONT};font-size:13px;color:${C.ink};border-bottom:1px solid ${C.line};width:30%;">${esc(label)}</td>
          <td style="padding:8px 8px;font-family:${FONT};font-size:13px;color:${C.muted};border-bottom:1px solid ${C.line};width:50%;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="padding:0;background:${C.line};height:6px;">
                <table role="presentation" width="${pct}%" cellspacing="0" cellpadding="0" border="0"><tr>
                  <td style="padding:0;background:${C.accent};height:6px;line-height:6px;font-size:0;">&nbsp;</td>
                </tr></table>
              </td>
            </tr></table>
          </td>
          <td align="right" style="padding:8px 0;font-family:${FONT};font-size:13px;color:${C.ink};font-weight:600;border-bottom:1px solid ${C.line};white-space:nowrap;width:20%;">${Math.round(Number(sqft)).toLocaleString()} ft² <span style="color:${C.faint};font-weight:400;">· ${pct}%</span></td>
        </tr>`;
        }).join("")}
        <tr>
          <td style="padding:10px 0 0 0;font-family:${FONT};font-size:13px;color:${C.muted};font-weight:600;">${esc(t("email.elevationTotal"))}</td>
          <td></td>
          <td align="right" style="padding:10px 0 0 0;font-family:${FONT};font-size:13px;color:${C.ink};font-weight:700;">${Math.round(elevationTotal).toLocaleString()} ft²</td>
        </tr>
      </table>
    </td></tr>`
    : "";

  // Iter 78t — Elevation drawings removed from customer quote PDF /
  // email until we can do a true 3D render. Contractor still views
  // them inside the app (ElevationDrawing.jsx, fully nudgeable).

  const sigBlock = estimate.estimator
    ? `
    <tr><td style="padding:8px 32px 24px 32px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">
      <div style="color:${C.ink};font-weight:600;">${esc(estimate.estimator)}</div>
      <div>${esc(companyName)}</div>
    </td></tr>`
    : "";

  // ---- Final document -----------------------------------------------------
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${t("email.estimate")} ${esc(estimate.estimate_number || "")} — ${esc(companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:${FONT};color:${C.ink};-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    ${esc(t("email.preheader", { number: estimate.estimate_number || "", amount: $(totals.sell) }))}
  </span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F4F5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid ${C.ink};">
        <!-- Header -->
        <tr><td style="padding:28px 32px;border-bottom:4px solid ${C.accent};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td valign="middle" style="font-family:${FONT};">
              ${logoUrl
                ? `<img src="${logoUrl}" alt="${esc(companyName)}" height="48" style="display:block;height:48px;width:auto;max-width:200px;">`
                : `<div style="font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink};">${esc(companyName)}</div>`}
            </td>
            <td align="right" valign="middle" style="font-family:${FONT};">
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${C.faint};font-weight:bold;">${esc(t("email.estimate"))}</div>
              <div style="font-family:${FONT};font-size:18px;font-weight:700;color:${C.ink};letter-spacing:0.5px;">${esc(estimate.estimate_number || "—")}</div>
              <div style="font-family:${FONT};font-size:12px;color:${C.muted};">${esc(estimate.estimate_date || "")}</div>
              ${expiryStr
                ? `<div style="margin-top:8px;display:inline-block;padding:4px 10px;background:#FFF7ED;border:1px solid ${C.accent};color:${C.accent};font-family:${FONT};font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;border-radius:2px;">${esc(t("email.validThrough", { date: expiryStr }))}</div>`
                : ""}
            </td>
          </tr></table>
        </td></tr>

        ${intro}
        ${sigBlock}

        <!-- Prepared For / Estimator -->
        <tr><td style="padding:8px 32px 20px 32px;border-top:1px solid ${C.line};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td width="50%" valign="top" style="padding-right:12px;font-family:${FONT};">
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:4px;">${esc(t("email.preparedFor"))}</div>
              <div style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.ink};">${esc(estimate.customer_name || "—")}</div>
              <div style="font-family:${FONT};font-size:13px;color:${C.muted};">${esc(estimate.address || "")}</div>
            </td>
            <td width="50%" valign="top" style="padding-left:12px;font-family:${FONT};">
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:4px;">${esc(t("email.estimator"))}</div>
              <div style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.ink};">${esc(estimate.estimator || "—")}</div>
            </td>
          </tr></table>
        </td></tr>

        ${estimate.notes
          ? `<tr><td style="padding:0 32px 20px 32px;border-top:1px solid ${C.line};">
              <div style="padding-top:18px;font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:6px;">${esc(t("email.scopeOfWork"))}</div>
              <div style="font-family:${FONT};font-size:14px;line-height:1.55;color:${C.ink};white-space:pre-line;">${nl2br(estimate.notes)}</div>
            </td></tr>`
          : ""}

        ${elevationBlock}

        <!-- Line items -->
        <tr><td style="padding:0 32px 20px 32px;border-top:1px solid ${C.line};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${Object.entries(linesByCat).map(sectionBlock).join("")}
            ${photoGrid}
          </table>
        </td></tr>

        <!-- Total -->
        <tr><td style="padding:24px 32px;border-top:4px solid ${C.ink};background:${C.bg};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink};letter-spacing:0.3px;">${esc(t("email.total"))}</td>
            <td align="right" style="font-family:${FONT};font-size:34px;font-weight:900;color:${C.ink};letter-spacing:-0.5px;">${$(totals.sell)}</td>
          </tr></table>
          <div style="margin-top:10px;font-family:${FONT};font-size:12px;color:${C.muted};line-height:1.5;">
            ${expiryStr
              ? t("email.validityWithDate", { date: esc(expiryStr) })
              : t("email.validityGeneric")}
          </div>
        </td></tr>

        ${acceptHref
          ? `<!-- Accept CTA -->
        <tr><td align="center" style="padding:24px 32px 8px 32px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="${C.accent}" style="border-radius:2px;">
            <a href="${acceptHref}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:14px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;background:${C.accent};border-radius:2px;">
              ${esc(t("email.acceptCta"))}
            </a>
          </td></tr></table>
          <div style="margin-top:10px;font-family:${FONT};font-size:11px;color:${C.muted};">
            ${esc(t("email.replyHint"))}
          </div>
        </td></tr>`
          : `<!-- Footer -->
        <tr><td style="padding:18px 32px;font-family:${FONT};font-size:12px;color:${C.muted};text-align:center;border-top:1px solid ${C.line};">
          ${esc(t("email.questionsFooter"))}
        </td></tr>`}

        ${showSupplierFooter
          ? `<tr><td style="padding:10px 32px;font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};text-align:center;border-top:1px solid ${C.line};">
              ${esc(t("email.materialsBy", { supplier: supplierName }))}
            </td></tr>`
          : ""}
      </table>

      <div style="padding:18px 12px;font-family:${FONT};font-size:11px;color:${C.faint};text-align:center;">
        ${esc(t("email.sentBy", { company: companyName }))}
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildEmailSubject({ estimate, company, lang = "en" }) {
  const num = estimate.estimate_number ? ` ${estimate.estimate_number}` : "";
  const who = (company?.name || "your contractor").trim();
  const cust = (estimate.customer_name || "").trim();
  const key = cust ? "email.subjectWithCustomer" : "email.subjectGeneric";
  return tFor(lang, key, { num, company: who, customer: cust });
}

export function defaultEmailGreeting({ estimate, company, lang = "en" }) {
  const first = (estimate.customer_name || "").trim().split(/\s+/)[0] || tFor(lang, "email.greetingFallbackName");
  const who = (estimate.estimator || company?.name || tFor(lang, "email.greetingFallbackWho")).trim();
  return tFor(lang, "email.greeting", { first, who });
}
