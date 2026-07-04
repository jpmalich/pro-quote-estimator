import React from "react";
import DOMPurify from "dompurify";
import { useT, useLang } from "@/lib/i18n";
import { tColor, tColorGroup } from "@/lib/catalogTranslations";
import { vinylSidingColorGroupsForEstimate, accessoryColorGroupsForEstimate, ASCEND_COLORS, SHAKE_COLOR_GROUPS, BOARD_BATTEN_COLOR_GROUPS, SOFFIT_COLOR_GROUPS, GUTTER_COLORS, WINDOW_WRAP_COLORS, LP_SMARTSIDE_COLORS, MEZZO_EXTERIOR_COLOR_GROUPS, MEZZO_INTERIOR_COLOR_GROUPS, VERO_EXTERIOR_COLOR_GROUPS, VERO_INTERIOR_COLOR_GROUPS, VERO_LAMINATE_NAMES } from "@/lib/colorOptions";
import HoverImportButton from "@/components/estimate/HoverImportButton";
import AIMeasureButton from "@/components/estimate/AIMeasureButton";
// Iter 79j.19 — bake current waste_pct into AI-generated cut-prone
// lines on Apply, same as HOVER Import does.
import { bakeWasteIntoLines } from "@/lib/wasteLogic";
import BlueprintMeasureButton from "@/components/estimate/BlueprintMeasureButton";
import PairToLpButton from "@/components/estimate/PairToLpButton";
// Iter 78u — Compare Drawings modal trigger
import { useState } from "react";
import { Upload, FileText, Sparkles, Layers, ChevronDown, ChevronUp, MoreHorizontal, Lightbulb } from "lucide-react";
import ElevationCompareModal, { countSources } from "@/components/estimate/ElevationCompareModal";
import { isValidEmail, isValidPhone, isValidZip, formatPhoneUS } from "@/lib/validate";

// Iter 78z+++ — Cleaner job-info header. Three equal-width "tool tiles"
// for the measurement importers (HOVER · Blueprints · AI Photo), each
// with a short label so contractors don't have to read button text to
// tell them apart. PairToLp + Compare Drawings tuck into a "More tools"
// row below the tiles since they're contextual / rare. Form fields
// collapse to a 1-line summary once customer + address are filled so
// the page stops scrolling past data the contractor doesn't need to
// re-touch.
function ToolTile({ icon: Icon, label, sub, children, testid, accent = "#7C3AED" }) {
  return (
    <div
      className="border border-[var(--border)] bg-[var(--surface)] p-3 flex flex-col gap-2 min-w-0"
      data-testid={testid}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--ink-2)] truncate">
          {label}
        </div>
        {sub && (
          <span className="text-[9px] text-[var(--muted)] uppercase tracking-wider truncate ml-auto">
            {sub}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 items-start">{children}</div>
    </div>
  );
}

// Lead-source presets — slugs persist (analytics-friendly), labels via i18n.
const LEAD_SOURCES = [
  ["referral", "est.leadSource.referral"],
  ["repeat_customer", "est.leadSource.repeat"],
  ["web", "est.leadSource.web"],
  ["social", "est.leadSource.social"],
  ["yard_sign", "est.leadSource.yardSign"],
  ["truck_wrap", "est.leadSource.truckWrap"],
  ["home_show", "est.leadSource.homeShow"],
  ["supplier", "est.leadSource.supplier"],
  ["door_knock", "est.leadSource.doorKnock"],
  ["other", "est.leadSource.other"],
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WV","WI","WY"];

// Compose the canonical single-line address every existing consumer reads
// (quote docs, CSVs, dashboard, geocoding). "123 Main St, Pittsburgh, PA 15222".
function composeAddress({ street, city, state, zip }) {
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

// Best-effort parse of a legacy free-text address into parts for display.
// Only used when the structured fields are all empty; nothing is saved
// until the contractor edits a part.
function parseAddress(str) {
  const out = { street: "", city: "", state: "", zip: "" };
  const t = (str || "").trim();
  if (!t) return out;
  let rest = t;
  const zipM = rest.match(/(\d{5}(?:-\d{4})?)\s*$/);
  if (zipM) { out.zip = zipM[1]; rest = rest.slice(0, zipM.index).trim().replace(/,$/, ""); }
  const stateM = rest.match(/[,\s]([A-Za-z]{2})$/);
  if (stateM && US_STATES.includes(stateM[1].toUpperCase())) {
    out.state = stateM[1].toUpperCase();
    rest = rest.slice(0, stateM.index).trim().replace(/,$/, "");
  }
  const parts = rest.split(",").map((x) => x.trim()).filter(Boolean);
  out.street = parts[0] || "";
  out.city = parts.slice(1).join(", ");
  return out;
}

export default function JobInfoPanel({ est, update, save, setInstallMethod, setHomePre1978 }) {
  const t = useT();
  const { lang } = useLang();
  // Iter 78u — Compare Drawings modal state
  const [showCompare, setShowCompare] = useState(false);
  const numDrawingSources = countSources(est);
  // Iter 78z+++ — collapse the form section once the contractor has
  // filled the basics. They can re-expand any time via the "Edit"
  // affordance in the summary row.
  const basicsFilled = !!(est?.customer_name && est?.address);
  const [collapsed, setCollapsed] = useState(false);
  // Auto-collapse when basics become filled on first render (but only
  // once — if the user expands manually we respect their choice).
  const [autoTouched, setAutoTouched] = useState(false);
  if (!autoTouched && basicsFilled && !collapsed) {
    // schedule once to avoid setState during render
    setTimeout(() => {
      setCollapsed(true);
      setAutoTouched(true);
    }, 0);
  }
  // Brand-filtered vinyl siding color groups. Computed inline on every
  // render — cheap (an array filter over <30 items) and avoids the
  // hooks/preserve-manual-memoization lint complaint about useMemo +
  // optional chaining. Shared across siding / accessories / outside-corner
  // dropdowns so they all narrow to the active brand together.
  const vinylColorGroups = vinylSidingColorGroupsForEstimate(est?.lines || []);
  // Accessories + Outside Corner pickers also include Ascend so an
  // Ascend-quote contractor can match the corner posts without leaving
  // the field.
  const accessoryColorGroups = accessoryColorGroupsForEstimate(est?.lines || []);
  // Iter 77 — LP SmartSide estimates use the factory ExpertFinish 16-color
  // palette across every applicable color picker, with renamed labels
  // ("LP Siding Color", "Trim Color") and no Window Wrap dropdown.
  const isLp = est?.kind === "lp_smart";
  // Structured address parts. Parts are canonical once set; legacy
  // estimates that only carry the composed string get a display-time parse.
  const jobParts = (est?.address_street || est?.address_city || est?.address_state || est?.address_zip)
    ? { street: est.address_street || "", city: est.address_city || "", state: est.address_state || "", zip: est.address_zip || "" }
    : parseAddress(est?.address);
  const billParts = (est?.billing_street || est?.billing_city || est?.billing_state || est?.billing_zip)
    ? { street: est.billing_street || "", city: est.billing_city || "", state: est.billing_state || "", zip: est.billing_zip || "" }
    : parseAddress(est?.billing_address);
  const setJobPart = (field, value) => {
    const merged = { ...jobParts, [field]: value };
    update({
      address_street: merged.street,
      address_city: merged.city,
      address_state: merged.state,
      address_zip: merged.zip,
      address: composeAddress(merged),
    });
  };
  // Soft validation — warn after first blur, never block (soft-required policy).
  const [touched, setTouched] = useState({});
  const markTouched = (k) => setTouched((t) => ({ ...t, [k]: true }));
  const softBad = {
    email: touched.email && !isValidEmail(est?.customer_email),
    phone: touched.phone && !isValidPhone(est?.customer_phone),
    phoneAlt: touched.phoneAlt && !isValidPhone(est?.customer_phone_alt),
    fax: touched.fax && !isValidPhone(est?.customer_fax),
    zip: touched.zip && !isValidZip(est?.address_zip),
    billZip: touched.billZip && !isValidZip(est?.billing_zip),
  };
  // Normalize a cleanly-entered 10-digit phone to (AAA) BBB-CCCC on blur.
  const blurPhone = (key, field) => {
    markTouched(key);
    const formatted = formatPhoneUS(est?.[field]);
    if (formatted !== est?.[field]) update({ [field]: formatted });
  };
  const FieldWarning = ({ id, show, children }) =>
    show ? (
      <div id={id} className="text-[11px] text-[var(--warning-text)] mt-1">
        {children}
      </div>
    ) : null;

    const setBillPart = (field, value) => {
    const merged = { ...billParts, [field]: value };
    update({
      billing_street: merged.street,
      billing_city: merged.city,
      billing_state: merged.state,
      billing_zip: merged.zip,
      billing_address: composeAddress(merged),
    });
  };
  return (
    <section className="card p-5 sm:p-6 mb-6" data-testid="job-info">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="section-tag">{t("est.jobInfo")}</div>
          {collapsed && basicsFilled && (
            <div className="text-xs text-[var(--ink-2)] flex items-center gap-2 flex-wrap" data-testid="job-info-summary">
              <span className="font-bold text-[var(--ink)]">{est.customer_name}</span>
              {est.customer_company && (
                <>
                  <span className="text-[var(--muted)]">·</span>
                  <span>{est.customer_company}</span>
                </>
              )}
              <span className="text-[var(--muted)]">·</span>
              <span>{est.address}</span>
              {(est.customer_phone || est.customer_email) && (
                <>
                  <span className="text-[var(--muted)]">·</span>
                  <span className="text-[var(--muted)]">{est.customer_phone || est.customer_email}</span>
                </>
              )}
              {est.estimate_number && (
                <>
                  <span className="text-[var(--muted)]">·</span>
                  <span className="font-mono-num text-[var(--muted)]">{est.estimate_number}</span>
                </>
              )}
            </div>
          )}
          {!(est.customer_email || "").trim() && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 bg-[var(--hint-bg-2)] border border-[var(--hint-line)] text-[var(--hint-ink-2)] flex items-center gap-1"
              data-testid="contact-hint"
            >
              <Lightbulb className="w-3 h-3" aria-hidden="true" />
              {t("est.contactHint")}
            </span>
          )}
        </div>
        {basicsFilled && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-[10px] uppercase tracking-wider font-bold text-[var(--ai)] hover:text-[#5B21B6] flex items-center gap-1"
            data-testid="job-info-toggle"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-3 h-3" /> Edit
              </>
            ) : (
              <>
                <ChevronUp className="w-3 h-3" /> Collapse
              </>
            )}
          </button>
        )}
      </div>

      {/* Iter 78z+++ — Measurement tools tile row. Three equal-width
          tiles so HOVER / Blueprints / AI Photo Measure look like the
          parallel choices they actually are. Each tile is a launcher
          + its contextual sub-actions (Restore HOVER, Tag Profiles,
          waste-default caption, resume banner). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3" data-testid="measurement-tools-row">
        <ToolTile icon={Upload} label="HOVER PDF" accent="#09090B" testid="tool-tile-hover">
          <HoverImportButton est={est} update={update} save={save} />
        </ToolTile>
        <ToolTile icon={FileText} label="Blueprints" accent="#7C3AED" testid="tool-tile-blueprint">
          <BlueprintMeasureButton est={est} update={update} save={save} />
        </ToolTile>
        <ToolTile icon={Sparkles} label="AI Photo Measure" accent="#7C3AED" testid="tool-tile-ai">
          <AIMeasureButton
            kind={est.kind || "siding"}
            address={est?.address}
            overhangIn={est?.overhang_in ?? 12}
            estimateId={est?.id}
            estimate={est}
            onApply={async ({ lines: aiLines, measurements }) => {
              // Iter 79j.19 — bake the contractor's waste % into cut-prone
              // AI lines exactly like HOVER Import: raw measurement kept in
              // raw_qty, qty bumped to raw × (1 + waste/100). Non-cut lines
              // (labor, gutter, downspouts) pass through untouched.
              const wastePct = Number(est?.waste_pct ?? 0);
              const bakedLines = bakeWasteIntoLines(aiLines || [], wastePct);
              const existing = est.lines || [];
              const keyOf = (l) => `${l.tab || "vinyl"}::${l.section}::${l.name}`;
              const byKey = new Map(existing.map((l, i) => [keyOf(l), i]));
              const next = [...existing];
              // Iter 78z++++ — LP Smart has its own workspace; drop LP rows
              // from AI imports onto siding-kind estimates. lp_smart-kind
              // estimates still accept LP rows (they're the primary tab).
              const srcKind = est.kind || "siding";
              const SIDING_TABS = new Set(srcKind === "siding"
                ? ["vinyl", "ascend"]
                : ["vinyl", "ascend", "lp_smart"]);
              const WINDOWS_TABS = new Set(["windows"]);
              for (const ln of bakedLines) {
                const isSiding = SIDING_TABS.has(ln.tab || "vinyl");
                const isWindows = WINDOWS_TABS.has(ln.tab || "vinyl");
                if (srcKind === "windows" ? !isWindows : !isSiding) continue;
                const key = keyOf(ln);
                const idx = byKey.get(key);
                if (idx == null) {
                  // raw_qty preserved so future waste-% changes recompute correctly
                  next.push({ tab: ln.tab || "vinyl", section: ln.section, name: ln.name, unit: ln.unit, qty: ln.qty, raw_qty: ln.raw_qty, mat: 0, lab: 0 });
                } else {
                  // Only stamp raw_qty when the incoming AI line has one
                  // (cut-prone); others keep the existing row's value.
                  next[idx] = { ...next[idx], qty: ln.qty, ...(ln.raw_qty != null ? { raw_qty: ln.raw_qty } : {}) };
                }
              }
              // Surface masked-out zones (brick, stone, garage, stucco) on
              // the estimate so the PDF / email can show "Materials
              // excluded: ..." under the siding row.
              const patch = { lines: next };
              if (measurements?._photo_zones_summary) {
                patch.photo_zones_summary = measurements._photo_zones_summary;
                patch.photo_zones_deducted_sqft = measurements._photo_zones_deducted_sqft || 0;
              }
              update(patch);
              if (save) await save({ ...est, ...patch });
            }}
          />
        </ToolTile>
      </div>

      {/* Iter 78z+++ — Workspace-level / contextual tools. Pair to LP
          is a workspace switcher, not a job-info action — it lives
          here in a low-emphasis row so it's reachable but doesn't
          compete with the importers. Compare Drawings only renders
          when 2+ measurement sources exist. */}
      {((est?.kind || "siding") === "siding" || numDrawingSources >= 2) && (
        <div className="flex flex-wrap gap-2 mb-4 justify-end" data-testid="job-info-more-tools">
          {numDrawingSources >= 2 && (
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold text-[var(--muted)] hover:text-[var(--ai)] flex items-center gap-1"
              title="Side-by-side compare drawings across your measurement sources"
              data-testid="compare-drawings-btn"
            >
              <Layers className="w-3 h-3" />
              Compare ({numDrawingSources})
            </button>
          )}
          <PairToLpButton est={est} />
        </div>
      )}

      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${collapsed ? "hidden" : ""}`}
        data-testid="job-info-form"
      >
        {/* ---- Customer: who ---- */}
        <div className="sm:col-span-2 lg:col-span-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold">
            {t("est.customerInfo")}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cust-name">{t("est.customer")}</label>
          <input
            id="cust-name"
            className="input"
            value={est.customer_name || ""}
            onChange={(e) => update({ customer_name: e.target.value })}
            autoComplete="off"
              data-testid="cust-name"
          />
        </div>
        <div>
          <label className="label" htmlFor="cust-company">{t("est.company")}</label>
          <input
            id="cust-company"
            className="input"
            value={est.customer_company || ""}
            onChange={(e) => update({ customer_company: e.target.value })}
            autoComplete="off"
              data-testid="cust-company"
          />
        </div>
        <div>
          <label className="label" htmlFor="cust-contact-title">{t("est.contactTitle")}</label>
          <input
            id="cust-contact-title"
            className="input"
            value={est.customer_contact_title || ""}
            onChange={(e) => update({ customer_contact_title: e.target.value })}
            autoComplete="off"
              data-testid="cust-contact-title"
          />
        </div>

        {/* ---- Contact & Lead: how to reach them ---- */}
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold">
            {t("est.contactInfo")}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="cust-phone">{t("est.phoneCell")}</label>
          <input
            id="cust-phone"
            className="input"
            type="tel"
            value={est.customer_phone || ""}
            onChange={(e) => update({ customer_phone: e.target.value })}
                onBlur={() => blurPhone("phone", "customer_phone")}
                placeholder={t("est.exPhone")}
                aria-invalid={softBad.phone || undefined}
                aria-describedby={softBad.phone ? "cust-phone-warn" : undefined}
            autoComplete="off"
              data-testid="cust-phone"
          />
              <FieldWarning id="cust-phone-warn" show={softBad.phone}>{t("est.invalidPhone")}</FieldWarning>
        </div>
        <div>
          <label className="label" htmlFor="cust-phone-alt">{t("est.phoneAlt")}</label>
          <input
            id="cust-phone-alt"
            className="input"
            type="tel"
            value={est.customer_phone_alt || ""}
            onChange={(e) => update({ customer_phone_alt: e.target.value })}
                onBlur={() => blurPhone("phoneAlt", "customer_phone_alt")}
                placeholder={t("est.exPhone")}
                aria-invalid={softBad.phoneAlt || undefined}
                aria-describedby={softBad.phoneAlt ? "cust-phone-alt-warn" : undefined}
            autoComplete="off"
              data-testid="cust-phone-alt"
          />
              <FieldWarning id="cust-phone-alt-warn" show={softBad.phoneAlt}>{t("est.invalidPhone")}</FieldWarning>
        </div>
        <div>
          <label className="label" htmlFor="cust-fax">{t("est.fax")}</label>
          <input
            id="cust-fax"
            className="input"
            type="tel"
            value={est.customer_fax || ""}
            onChange={(e) => update({ customer_fax: e.target.value })}
                onBlur={() => blurPhone("fax", "customer_fax")}
                placeholder={t("est.exPhone")}
                aria-invalid={softBad.fax || undefined}
                aria-describedby={softBad.fax ? "cust-fax-warn" : undefined}
            autoComplete="off"
              data-testid="cust-fax"
          />
              <FieldWarning id="cust-fax-warn" show={softBad.fax}>{t("est.invalidPhone")}</FieldWarning>
        </div>
        <div>
          <label className="label" htmlFor="cust-email">{t("est.email")}</label>
          <input
            id="cust-email"
            className="input"
            type="email"
            autoComplete="off"
            value={est.customer_email || ""}
            onChange={(e) => update({ customer_email: e.target.value })}
                onBlur={() => markTouched("email")}
                placeholder={t("est.exEmail")}
                aria-invalid={softBad.email || undefined}
                aria-describedby={softBad.email ? "cust-email-warn" : undefined}
            data-testid="cust-email"
          />
              <FieldWarning id="cust-email-warn" show={softBad.email}>{t("est.invalidEmail")}</FieldWarning>
        </div>
        <div>
          <label className="label" htmlFor="cust-contact-method">{t("est.contactMethod")}</label>
          <select
            id="cust-contact-method"
            className="input"
            value={est.customer_contact_method || ""}
            onChange={(e) => update({ customer_contact_method: e.target.value })}
            autoComplete="off"
              data-testid="cust-contact-method"
          >
            <option value="">—</option>
            <option value="cell">{t("est.contactMethod.cell")}</option>
            <option value="landline">{t("est.contactMethod.landline")}</option>
            <option value="email">{t("est.contactMethod.email")}</option>
            <option value="text">{t("est.contactMethod.text")}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lead-source">{t("est.leadSource")}</label>
          <select
            id="lead-source"
            className="input"
            value={est.lead_source || ""}
            onChange={(e) => update({ lead_source: e.target.value })}
            data-testid="lead-source"
          >
            <option value="">—</option>
            {LEAD_SOURCES.map(([slug, key]) => (
              <option key={slug} value={slug}>{t(key)}</option>
            ))}
          </select>
          {(est.lead_source === "other" || est.lead_source === "referral") && (
            <input
              className="input mt-2"
              placeholder={t("est.leadSourceDetail")}
              aria-label={t("est.leadSourceDetail")}
              value={est.lead_source_detail || ""}
              onChange={(e) => update({ lead_source_detail: e.target.value })}
              autoComplete="off"
              data-testid="lead-source-detail"
            />
          )}
        </div>

        {/* ---- Addresses: where ---- */}
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold">
            {t("est.addresses")}
          </div>
        </div>
        <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="label" htmlFor="cust-street">{t("est.street")}</label>
            <input
              id="cust-street"
              className="input"
              autoComplete="off"
              value={jobParts.street}
              onChange={(e) => setJobPart("street", e.target.value)}
              data-testid="cust-street"
            />
          </div>
          <div className="lg:col-span-1">
            <label className="label" htmlFor="cust-city">{t("est.city")}</label>
            <input
              id="cust-city"
              className="input"
              value={jobParts.city}
              onChange={(e) => setJobPart("city", e.target.value)}
              autoComplete="off"
              data-testid="cust-city"
            />
          </div>
          <div className="lg:col-span-1">
            <label className="label" htmlFor="cust-state">{t("est.state")}</label>
            <select
              id="cust-state"
              className="input"
              value={jobParts.state}
              onChange={(e) => setJobPart("state", e.target.value)}
              autoComplete="off"
              data-testid="cust-state"
            >
              <option value="">—</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-1">
            <label className="label" htmlFor="cust-zip">{t("est.zip")}</label>
            <input
              id="cust-zip"
              className="input"
              inputMode="numeric"
              maxLength={10}
              value={jobParts.zip}
              onChange={(e) => setJobPart("zip", e.target.value)}
              onBlur={() => markTouched("zip")}
              placeholder={t("est.exZip")}
              aria-invalid={softBad.zip || undefined}
              aria-describedby={softBad.zip ? "cust-zip-warn" : undefined}
              autoComplete="off"
              data-testid="cust-zip"
            />
            <FieldWarning id="cust-zip-warn" show={softBad.zip}>{t("est.invalidZip")}</FieldWarning>
          </div>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={!(est.billing_address || "").trim()}
              onChange={(e) =>
                e.target.checked
                  ? update({ billing_address: "", billing_street: "", billing_city: "", billing_state: "", billing_zip: "" })
                  : update({
                      billing_address: est.address || "",
                      billing_street: jobParts.street,
                      billing_city: jobParts.city,
                      billing_state: jobParts.state,
                      billing_zip: jobParts.zip,
                    })
              }
              data-testid="billing-same-checkbox"
            />
            {t("est.billingSame")}
          </label>
          {!!(est.billing_address || "").trim() && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="label" htmlFor="billing-street">{t("est.street")}</label>
                <input
                  id="billing-street"
                  className="input"
                  value={billParts.street}
                  onChange={(e) => setBillPart("street", e.target.value)}
                  autoComplete="off"
              data-testid="billing-street"
                />
              </div>
              <div className="lg:col-span-1">
                <label className="label" htmlFor="billing-city">{t("est.city")}</label>
                <input
                  id="billing-city"
                  className="input"
                  value={billParts.city}
                  onChange={(e) => setBillPart("city", e.target.value)}
                  autoComplete="off"
              data-testid="billing-city"
                />
              </div>
              <div className="lg:col-span-1">
                <label className="label" htmlFor="billing-state">{t("est.state")}</label>
                <select
                  id="billing-state"
                  className="input"
                  value={billParts.state}
                  onChange={(e) => setBillPart("state", e.target.value)}
                  autoComplete="off"
              data-testid="billing-state"
                >
                  <option value="">—</option>
                  {US_STATES.map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-1">
                <label className="label" htmlFor="billing-zip">{t("est.zip")}</label>
                <input
                  id="billing-zip"
                  className="input"
                  inputMode="numeric"
                  maxLength={10}
                  value={billParts.zip}
                  onChange={(e) => setBillPart("zip", e.target.value)}
                  onBlur={() => markTouched("billZip")}
                  placeholder={t("est.exZip")}
                  aria-invalid={softBad.billZip || undefined}
                  aria-describedby={softBad.billZip ? "billing-zip-warn" : undefined}
                  autoComplete="off"
              data-testid="billing-zip"
                />
                <FieldWarning id="billing-zip-warn" show={softBad.billZip}>{t("est.invalidZip")}</FieldWarning>
              </div>
            </div>
          )}
        </div>

        {/* ---- Estimate: job meta ---- */}
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold">
            {t("est.estimateMeta")}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="est-num">{t("est.estimateNum")}</label>
          <input
            id="est-num"
            className="input"
            value={est.estimate_number || ""}
            onChange={(e) => update({ estimate_number: e.target.value })}
            data-testid="est-num"
          />
        </div>
        <div>
          <label className="label" htmlFor="est-date">{t("est.date")}</label>
          <input
            id="est-date"
            className="input"
            type="date"
            value={est.estimate_date || ""}
            onChange={(e) => update({ estimate_date: e.target.value })}
            data-testid="est-date"
          />
        </div>
        <div>
          <label className="label" htmlFor="estimator-name">{t("est.estimator")}</label>
          <input
            id="estimator-name"
            className="input"
            value={est.estimator || ""}
            onChange={(e) => update({ estimator: e.target.value })}
            data-testid="estimator-name"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="label" htmlFor="notes-input">{t("est.scope")}</label>
          <textarea
            id="notes-input"
            className="input"
            rows="3"
            value={est.notes || ""}
            onChange={(e) => update({ notes: e.target.value })}
            data-testid="notes-input"
          />
        </div>

        {/* Estimate-level colors — appear on the material list so the supplier
            pulls the right color stock for the whole job. Siding-kind only;
            window-only estimates show the Window Colors block below. */}
        {est.kind !== "windows" && (
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold mb-2">
            {t("est.colors")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="label">{isLp ? t("est.color.lpSiding") : t("est.color.siding")}</label>
              <select
                className="input"
                value={est.siding_color || ""}
                onChange={(e) => update({ siding_color: e.target.value })}
                data-testid="color-siding"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : vinylColorGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            {/* Iter 77 — LP SmartSiding doesn't use Ascend or Pelican Bay
                shake palettes; Howard asked to hide those two selectors on
                the LP workspace. Siding (vinyl/ascend) and ISS keep them. */}
            {est.kind !== "lp_smart" && (
            <div>
              <label className="label">{t("est.color.ascend")}</label>
              <select
                className="input"
                value={est.ascend_color || ""}
                onChange={(e) => update({ ascend_color: e.target.value })}
                data-testid="color-ascend"
              >
                <option value="">— Select —</option>
                {ASCEND_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            )}
            {est.kind !== "lp_smart" && (
            <div>
              <label className="label">{t("est.color.shake")}</label>
              <select
                className="input"
                value={est.shake_color || ""}
                onChange={(e) => update({ shake_color: e.target.value })}
                data-testid="color-shake"
              >
                <option value="">— Select —</option>
                {SHAKE_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            )}
            <div>
              <label className="label">{t("est.color.boardBatten")}</label>
              <select
                className="input"
                value={est.board_batten_color || ""}
                onChange={(e) => update({ board_batten_color: e.target.value })}
                data-testid="color-board-batten"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : BOARD_BATTEN_COLOR_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            <div>
              <label className="label">{isLp ? t("est.color.trim") : t("est.color.accessories")}</label>
              <select
                className="input"
                value={est.accessories_color || ""}
                onChange={(e) => update({ accessories_color: e.target.value })}
                data-testid="color-accessories"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : accessoryColorGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.outsideCorner")}</label>
              <select
                className="input"
                value={est.outside_corner_color || ""}
                onChange={(e) => update({ outside_corner_color: e.target.value })}
                data-testid="color-outside-corner"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : accessoryColorGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.soffitFascia")}</label>
              <select
                className="input"
                value={est.soffit_fascia_color || ""}
                onChange={(e) => update({ soffit_fascia_color: e.target.value })}
                data-testid="color-soffit-fascia"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : SOFFIT_COLOR_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            {/* Iter 77 — LP SmartSide doesn't quote window wrap (factory
                trim handles window perimeters); hide the picker on LP. */}
            {!isLp && (
            <div>
              <label className="label">{t("est.color.windowWrap")}</label>
              <select
                className="input"
                value={est.window_wrap_color || ""}
                onChange={(e) => update({ window_wrap_color: e.target.value })}
                data-testid="color-window-wrap"
              >
                <option value="">— Select —</option>
                {WINDOW_WRAP_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            )}
            <div>
              <label className="label">{t("est.color.gutter")}</label>
              <select
                className="input"
                value={est.gutter_color || ""}
                onChange={(e) => update({ gutter_color: e.target.value })}
                data-testid="color-gutter"
              >
                <option value="">— Select —</option>
                {GUTTER_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        )}

        {/* Window-product colors — Windows-kind estimates only. Siding
            estimates use the Window Wrap field above for capping color;
            frame / interior / exterior are window-product attributes. */}
        {est.kind === "windows" && (
        <div className="sm:col-span-2 lg:col-span-3 pt-2 space-y-5">
          {/* Iter 36: Install method + Lead-Safe — windows-job-level
              switches that auto-fill the matching install / lead-safe
              rows so contractors don't have to remember to add them. */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold mb-2">
              Window Job Setup
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="label">Default install method</label>
                <div className="grid grid-cols-2 gap-1.5" data-testid="install-method-toggle">
                  {[
                    { id: "pocket", label: "Pocket" },
                    { id: "full_fin", label: "Full Fin" },
                  ].map((opt) => {
                    const active = (est.install_method || "") === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border ${
                          active
                            ? "bg-[var(--bar-bg)] text-white border-[var(--border-strong)]"
                            : "bg-[var(--surface)] text-[var(--ink-2)] border-[var(--border)] hover:border-[var(--border-strong)]"
                        }`}
                        onClick={() =>
                          setInstallMethod && setInstallMethod(active ? "" : opt.id)
                        }
                        data-testid={`install-method-${opt.id}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[var(--muted)] mt-1.5 leading-snug">
                  Picks which install row the total window count flows into.
                  Override per-row anytime.
                </p>
              </div>
              <div>
                <label className="label">Lead-Safe RRP</label>
                <label
                  className={`flex items-start gap-2.5 px-3 py-2.5 border cursor-pointer ${
                    est.home_pre_1978
                      ? "bg-[#FEF3C7] border-[#F59E0B]"
                      : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--border-strong)]"
                  }`}
                  data-testid="pre-1978-toggle"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 mt-0.5 accent-[var(--brand)] flex-shrink-0"
                    checked={!!est.home_pre_1978}
                    onChange={(ev) =>
                      setHomePre1978 && setHomePre1978(ev.target.checked)
                    }
                    data-testid="pre-1978-checkbox"
                  />
                  <div className="text-xs leading-snug">
                    <div className="font-bold text-[var(--ink)]">
                      Home built before 1978
                    </div>
                    <div className="text-[var(--muted)]">
                      Auto-adds Lead Safe Test Fee + Installation Practices for every window.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-bold mb-3">
            {t("est.colors.windows")}
          </div>

          {/* VERO color block — hidden per user request (pricing TBD). White
              forced as the only color choice; the picker is suppressed until
              pricing for the other extruded / laminate / painted finishes is
              re-clarified. */}
          {false && (
          <div className="border border-[var(--border)] bg-[var(--surface)] p-4 mb-3">
            <div className="text-[11px] uppercase tracking-wider text-[var(--ink)] font-bold mb-3">
              Vero
              <span className="ml-2 text-[var(--muted)] font-normal normal-case tracking-normal">
                {t("win.colors.veroDesc")}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t("win.color.exterior")}</label>
                <select
                  className="input"
                  value={est.window_exterior_color || ""}
                  onChange={(e) => update({ window_exterior_color: e.target.value })}
                  data-testid="color-vero-exterior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {VERO_EXTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t("win.color.interior")}</label>
                <select
                  className="input"
                  value={est.window_interior_color || ""}
                  onChange={(e) => update({ window_interior_color: e.target.value })}
                  data-testid="color-vero-interior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {VERO_INTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            {/* Laminate ⇒ white base only. Warn if a tan extruded base is
                paired with a laminate exterior/interior. */}
            {(() => {
              const ext = est.window_exterior_color || "";
              const intr = est.window_interior_color || "";
              const hasLaminate = VERO_LAMINATE_NAMES.has(ext) || VERO_LAMINATE_NAMES.has(intr);
              const conflictsWithTan =
                (VERO_LAMINATE_NAMES.has(ext) && intr === "Tan") ||
                (VERO_LAMINATE_NAMES.has(intr) && ext === "Tan");
              if (conflictsWithTan) {
                return (
                  <div
                    className="mt-2 px-3 py-2 bg-[var(--danger-soft)] border-l-2 border-[#DC2626] text-[11px] text-[#991B1B]"
                    data-testid="vero-laminate-warning"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("win.color.laminateWarn")) }}
                  />
                );
              }
              if (hasLaminate) {
                return (
                  <div
                    className="mt-2 px-3 py-2 bg-[#F0F9FF] border-l-2 border-[#0284C7] text-[11px] text-[#075985]"
                    data-testid="vero-laminate-notice"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("win.color.laminateNotice")) }}
                  />
                );
              }
              return null;
            })()}
          </div>
          )}

          {/* MEZZO color block — solid extruded + FrameWorks / Woodgrain */}
          <div className="border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[11px] uppercase tracking-wider text-[var(--ink)] font-bold mb-3">
              Mezzo
              <span className="ml-2 text-[var(--muted)] font-normal normal-case tracking-normal">
                {t("win.colors.mezzoDesc")}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t("win.color.exterior")}</label>
                <select
                  className="input"
                  value={est.mezzo_exterior_color || ""}
                  onChange={(e) => update({ mezzo_exterior_color: e.target.value })}
                  data-testid="color-mezzo-exterior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {MEZZO_EXTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t("win.color.interior")}</label>
                <select
                  className="input"
                  value={est.mezzo_interior_color || ""}
                  onChange={(e) => update({ mezzo_interior_color: e.target.value })}
                  data-testid="color-mezzo-interior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {MEZZO_INTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
          </div>
          </div>
        </div>
        )}
      </div>
      <ElevationCompareModal
        est={est}
        open={showCompare}
        onClose={() => setShowCompare(false)}
      />
    </section>
  );
}
