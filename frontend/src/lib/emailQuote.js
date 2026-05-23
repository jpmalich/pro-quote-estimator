// Build an email-safe HTML quote.
// Uses table-based layout and inline styles only — required for Gmail / Outlook / Apple Mail.
// Tailwind class names do not survive email clients; everything must be inlined.

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

export function buildEmailHtml({ estimate, totals, company, branding, message }) {
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

  // ---- Builders -----------------------------------------------------------
  const cell = (content, extra = "") =>
    `<td style="padding:0;font-family:${FONT};color:${C.ink};${extra}">${content}</td>`;

  const sectionBlock = ([section, items]) => `
    <tr><td style="padding:18px 0 6px 0;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:${C.accent};border-bottom:1px solid ${C.ink};">${esc(section)}</td></tr>
    ${items
      .map(
        (l) => `
      <tr>
        <td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${C.ink};border-bottom:1px solid ${C.line};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding:0;font-family:${FONT};font-size:14px;color:${C.ink};">${esc(l.name)}</td>
              <td align="right" style="padding:0;font-family:${FONT};font-size:13px;color:${C.muted};white-space:nowrap;">${esc(l.qty)} ${esc(l.unit)}</td>
            </tr>
          </table>
        </td>
      </tr>`
      )
      .join("")}
  `;

  const photoGrid = (estimate.photos || []).length
    ? `
      <tr><td style="padding:24px 0 8px 0;font-family:${FONT};font-size:11px;font-weight:bold;letter-spacing:1.8px;text-transform:uppercase;color:${C.faint};">Job Photos</td></tr>
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

  const sigBlock = estimate.estimator
    ? `
    <tr><td style="padding:8px 32px 24px 32px;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted};">
      <div style="color:${C.ink};font-weight:600;">${esc(estimate.estimator)}</div>
      <div>${esc(companyName)}</div>
    </td></tr>`
    : "";

  // ---- Final document -----------------------------------------------------
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Estimate ${esc(estimate.estimate_number || "")} from ${esc(companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F4F5;font-family:${FONT};color:${C.ink};-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
    Estimate ${esc(estimate.estimate_number || "")} — ${$(totals.sell)} total. Valid 30 days.
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
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:${C.faint};font-weight:bold;">Estimate</div>
              <div style="font-family:${FONT};font-size:18px;font-weight:700;color:${C.ink};letter-spacing:0.5px;">${esc(estimate.estimate_number || "—")}</div>
              <div style="font-family:${FONT};font-size:12px;color:${C.muted};">${esc(estimate.estimate_date || "")}</div>
            </td>
          </tr></table>
        </td></tr>

        ${intro}
        ${sigBlock}

        <!-- Prepared For / Estimator -->
        <tr><td style="padding:8px 32px 20px 32px;border-top:1px solid ${C.line};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td width="50%" valign="top" style="padding-right:12px;font-family:${FONT};">
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:4px;">Prepared For</div>
              <div style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.ink};">${esc(estimate.customer_name || "—")}</div>
              <div style="font-family:${FONT};font-size:13px;color:${C.muted};">${esc(estimate.address || "")}</div>
            </td>
            <td width="50%" valign="top" style="padding-left:12px;font-family:${FONT};">
              <div style="font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:4px;">Estimator</div>
              <div style="font-family:${FONT};font-size:15px;font-weight:600;color:${C.ink};">${esc(estimate.estimator || "—")}</div>
            </td>
          </tr></table>
        </td></tr>

        ${estimate.notes
          ? `<tr><td style="padding:0 32px 20px 32px;border-top:1px solid ${C.line};">
              <div style="padding-top:18px;font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};font-weight:bold;margin-bottom:6px;">Scope of Work</div>
              <div style="font-family:${FONT};font-size:14px;line-height:1.55;color:${C.ink};white-space:pre-line;">${nl2br(estimate.notes)}</div>
            </td></tr>`
          : ""}

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
            <td style="font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink};letter-spacing:0.3px;">Total Price</td>
            <td align="right" style="font-family:${FONT};font-size:34px;font-weight:900;color:${C.ink};letter-spacing:-0.5px;">${$(totals.sell)}</td>
          </tr></table>
          <div style="margin-top:10px;font-family:${FONT};font-size:12px;color:${C.muted};line-height:1.5;">
            Valid for 30 days from the date above. Final price may vary based on site conditions discovered after work begins.
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 32px;font-family:${FONT};font-size:12px;color:${C.muted};text-align:center;border-top:1px solid ${C.line};">
          Questions about this estimate? Reply to this email and we'll get right back to you.
        </td></tr>

        ${showSupplierFooter
          ? `<tr><td style="padding:10px 32px;font-family:${FONT};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.faint};text-align:center;border-top:1px solid ${C.line};">
              Materials supplied by ${esc(supplierName)}
            </td></tr>`
          : ""}
      </table>

      <div style="padding:18px 12px;font-family:${FONT};font-size:11px;color:${C.faint};text-align:center;">
        This estimate was sent by ${esc(companyName)}.
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildEmailSubject({ estimate, company }) {
  const num = estimate.estimate_number ? ` ${estimate.estimate_number}` : "";
  const who = (company?.name || "your contractor").trim();
  const cust = (estimate.customer_name || "").trim();
  return cust
    ? `Your siding estimate${num} from ${who} — ${cust}`
    : `Your siding estimate${num} from ${who}`;
}

export function defaultEmailGreeting({ estimate, company }) {
  const first = (estimate.customer_name || "").trim().split(/\s+/)[0] || "there";
  const who = (estimate.estimator || company?.name || "Your contractor").trim();
  return `Hi ${first},

Thanks for the opportunity to quote your project — the detailed estimate is below. Take a look and reply with any questions; happy to walk through anything that isn't clear.

— ${who}`;
}
