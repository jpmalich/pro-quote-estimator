/* ISS Siding estimate editor — single-tier, single-price-column layout.

   Sections come from /api/iss/catalog. Estimate persistence reuses the
   existing `lines[]` field on the Estimate doc, tagged with `tab="iss"`
   so the rows live alongside any siding/windows tabs if a contractor
   ever cross-references one job across workspaces.

   This page intentionally does NOT use the heavy `useEstimate` hook
   used by siding/windows — it has its own minimal state + autosave
   because the data shape is simpler. */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Lightbulb, Save } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import {
  vinylSidingColorGroupsForEstimate,
  ASCEND_COLORS,
  SOFFIT_COLOR_GROUPS,
  GUTTER_COLORS,
  WINDOW_WRAP_COLORS,
} from "@/lib/colorOptions";
import { buildMaterialListHtml, materialListFilename } from "@/lib/materialList";
import { useCompany } from "@/lib/company";
import { useBranding } from "@/lib/branding";
import { useLang } from "@/lib/i18n";
import QuoteModal from "@/components/QuoteModal";
import ISSHoverImportButton from "@/components/estimate/ISSHoverImportButton";
import AIMeasureButton from "@/components/estimate/AIMeasureButton";
import { FileText, Printer, Download, ClipboardList } from "lucide-react";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function ISSEstimateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [est, setEst] = useState(null);
  const [catalog, setCatalog] = useState({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState({});
  const [saving, setSaving] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const { company } = useCompany();
  const branding = useBranding();
  const { lang } = useLang();

  // Load estimate + catalog in parallel.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get(`/estimates/${id}`),
      api.get(`/iss/catalog`),
    ])
      .then(([estRes, catRes]) => {
        if (!alive) return;
        setEst(estRes.data);
        setCatalog(catRes.data);
      })
      .catch((e) => alive && toast.error(formatApiError(e?.response?.data?.detail)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  // Merge catalog × estimate.lines (tab=iss) into a render-ready map.
  // Saved qtys are preserved; un-touched catalog items render as qty=0.
  const lineByKey = useMemo(() => {
    const map = new Map();
    for (const l of est?.lines || []) {
      if ((l.tab || "") === "iss") {
        map.set(`${l.section}::${l.name}`, l);
      }
    }
    return map;
  }, [est?.lines]);

  // Persist qty changes (debounced).
  const userEdits = useRef(0);
  const savedUpTo = useRef(0);
  const savingNow = useRef(false);
  const flush = useCallback(async ({ force = false } = {}) => {
    if (!est) return;
    if (savingNow.current) return;
    if (!force && userEdits.current <= savedUpTo.current) return;
    const target = Math.max(userEdits.current, savedUpTo.current + 1);
    savingNow.current = true;
    setSaving(true);
    try {
      const payload = { ...est };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.user_id;
      delete payload.company_id;
      delete payload.totals;
      delete payload.estimate_number;
      const { data } = await api.put(`/estimates/${id}`, payload);
      savedUpTo.current = target;
      userEdits.current = target;
      setEst((cur) => ({ ...(cur || {}), ...data, lines: data.lines || [] }));
      if (force) toast.success("Estimate saved");
    } catch (e) {
      toast.error(formatApiError(e?.response?.data?.detail));
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  }, [est, id]);
  useEffect(() => {
    if (userEdits.current === 0) return;
    const t = setTimeout(flush, 1500);
    return () => clearTimeout(t);
  }, [est, flush]);

  const setQty = (section, name, unit, price, qty) => {
    const key = `${section}::${name}`;
    setEst((prev) => {
      if (!prev) return prev;
      const lines = [...(prev.lines || [])];
      const idx = lines.findIndex(
        (l) => (l.tab || "") === "iss" && l.section === section && l.name === name
      );
      if (idx >= 0) {
        lines[idx] = { ...lines[idx], qty: Number(qty) || 0, unit, mat: price, lab: 0, tab: "iss" };
      } else {
        lines.push({
          tab: "iss",
          section,
          name,
          unit,
          qty: Number(qty) || 0,
          mat: price,
          lab: 0,
        });
      }
      return { ...prev, lines };
    });
    userEdits.current += 1;
  };

  const updateField = (field, value) => {
    setEst((prev) => (prev ? { ...prev, [field]: value } : prev));
    userEdits.current += 1;
  };

  // Apply HOVER-derived ISS rows: upsert each {section,name,unit,qty} into
  // est.lines tagged with tab="iss". The catalog price is looked up from
  // the loaded catalog so the row carries a real unit cost. Saves to the
  // backend immediately (not via the debounced autosave) so the imported
  // data is persisted before the modal closes.
  const applyHoverLines = useCallback(async (rows) => {
    if (!rows?.length) return;
    const priceMap = new Map();
    for (const sec of catalog.sections || []) {
      for (const it of sec.items) {
        priceMap.set(`${sec.title}::${it.name}`, it.price);
      }
    }
    const current = est;
    if (!current) return;
    const lines = [...(current.lines || [])];
    for (const r of rows) {
      const key = `${r.section}::${r.name}`;
      const price = Number(priceMap.get(key) || 0);
      const idx = lines.findIndex(
        (l) => (l.tab || "") === "iss" && l.section === r.section && l.name === r.name
      );
      if (idx >= 0) {
        lines[idx] = { ...lines[idx], qty: Number(r.qty) || 0, unit: r.unit, mat: price, lab: 0, tab: "iss" };
      } else {
        lines.push({
          tab: "iss",
          section: r.section,
          name: r.name,
          unit: r.unit,
          qty: Number(r.qty) || 0,
          mat: price,
          lab: 0,
        });
      }
    }
    // Optimistic local update so the UI repaints immediately.
    setEst((prev) => (prev ? { ...prev, lines } : prev));
    setOpenSections((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.section] = true;
      return next;
    });
    // Immediate persist — bypass the debounced autosave so the data is
    // safe even if the contractor navigates away right after applying.
    setSaving(true);
    try {
      const payload = { ...current, lines };
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.user_id;
      delete payload.company_id;
      delete payload.totals;
      delete payload.estimate_number;
      const { data } = await api.put(`/estimates/${id}`, payload);
      setEst((cur) => ({ ...(cur || {}), ...data, lines: data.lines || [] }));
      // Mark autosave checkpoint so the debounced flush doesn't re-fire.
      savedUpTo.current = userEdits.current;
    } finally {
      setSaving(false);
    }
  }, [catalog, est, id]);

  const totals = useMemo(() => {
    let subTotal = 0;
    let sidingSub = 0;
    for (const sec of catalog.sections || []) {
      for (const it of sec.items) {
        const ln = lineByKey.get(`${sec.title}::${it.name}`);
        const qty = Number(ln?.qty) || 0;
        if (qty > 0) {
          const lineAmt = qty * Number(it.price || 0);
          subTotal += lineAmt;
          // Waste applies only to siding squares — the install section is
          // material-heavy and the rest is labor / hardware.
          if (sec.title === "Install Vinyl Siding") sidingSub += lineAmt;
        }
      }
    }
    const wastePct = Number(est?.waste_pct) || 0;
    const wasteAdd = sidingSub * (wastePct / 100);
    const base = subTotal + wasteAdd;
    const pct = Math.min(Number(est?.margin_pct) || 0, 99);
    const mode = est?.pricing_mode || "margin";
    const sell = mode === "markup" ? base * (1 + pct / 100) : pct >= 99 ? base : base / (1 - pct / 100);
    const profit = sell - base;
    return { subTotal, sidingSub, wasteAdd, base, sell, profit };
  }, [catalog, lineByKey, est?.waste_pct, est?.margin_pct, est?.pricing_mode]);
  const grandTotal = totals.sell;

  // Customer Quote — make sure latest changes are saved first.
  const handleOpenQuote = useCallback(async () => {
    await flush({ force: true });
    setShowQuote(true);
  }, [flush]);

  // Material List PDF — same backend route the siding flow uses.
  const handlePrintMaterials = useCallback(async () => {
    if (!est) return;
    await flush({ force: true });
    const html = buildMaterialListHtml({ estimate: est, company, branding, lang });
    try {
      const res = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/estimates/${id}/pdf`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient_email: "noreply@noreply.com", html_quote: html }),
        }
      );
      if (!res.ok) throw new Error(`PDF render failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = materialListFilename(est);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(`Could not generate material list: ${e.message}`);
    }
  }, [est, company, branding, lang, id, flush]);

  const handleExportCsv = useCallback(async () => {
    try {
      const res = await api.get(`/exports/estimates/${id}.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estimate_${est?.estimate_number || id}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  }, [id, est?.estimate_number]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAFAFA]">
        <Loader2 className="w-6 h-6 animate-spin text-[#F97316]" />
      </main>
    );
  }
  if (!est) return null;

  return (
    <main className="min-h-screen bg-[#FAFAFA] pb-24">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-40 bg-white border-b border-[#E4E4E7]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => nav("/dashboard/iss")}
            className="text-xs font-bold uppercase tracking-[0.18em] text-[#52525B] hover:text-[#09090B] flex items-center gap-1"
            data-testid="iss-back-btn"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> ISS Quotes
          </button>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">Grand Total</div>
              <div className="font-mono-num text-lg font-bold text-[#09090B]" data-testid="iss-grand-total">{fmt(grandTotal)}</div>
            </div>
            <button
              type="button"
              onClick={() => flush({ force: true })}
              disabled={saving}
              className="px-4 py-2 bg-[#09090B] text-white hover:bg-[#27272A] disabled:opacity-60 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
              data-testid="iss-save-btn"
              title="Save changes now (also auto-saves after each edit)"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
              ISS Quote · {est.estimate_number || "Draft"}
            </div>
            <ISSHoverImportButton est={est} applyLines={applyHoverLines} />
            <AIMeasureButton
              kind="iss"
              address={est?.customer_address}
              onApply={async ({ measurements }) => {
                const { buildISSLinesFromMeasurements } = await import(
                  "@/components/estimate/ISSHoverImportButton"
                );
                const rows = buildISSLinesFromMeasurements(measurements || {});
                await applyHoverLines(rows);
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Customer</label>
              <input
                className="input h-9 text-sm w-full"
                value={est.customer_name || ""}
                onChange={(e) => updateField("customer_name", e.target.value)}
                data-testid="iss-customer-name"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Address</label>
              <input
                className="input h-9 text-sm w-full"
                value={est.address || ""}
                onChange={(e) => updateField("address", e.target.value)}
                data-testid="iss-address"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Date</label>
              <input
                type="date"
                className="input h-9 text-sm w-full"
                value={est.estimate_date || ""}
                onChange={(e) => updateField("estimate_date", e.target.value)}
                data-testid="iss-date"
              />
            </div>
          </div>

          {/* Scope of Work — same field as siding estimates (notes) so it
              flows through to the PDF/email like the rest of the app. */}
          <div className="mt-3">
            <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">
              Scope of Work
            </label>
            <textarea
              className="input text-sm w-full"
              rows="3"
              value={est.notes || ""}
              onChange={(e) => updateField("notes", e.target.value)}
              data-testid="iss-notes"
            />
          </div>

          {/* Material Colors — mirrors siding estimate Job Info palette so
              the supplier pulls the right color stock for ISS jobs too. */}
          <div className="mt-4 pt-3 border-t border-[#E4E4E7]">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-2">
              Material Colors
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Siding</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.siding_color || ""}
                  onChange={(e) => updateField("siding_color", e.target.value)}
                  data-testid="iss-color-siding"
                >
                  <option value="">— Select —</option>
                  {vinylSidingColorGroupsForEstimate(est.lines || []).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Ascend</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.ascend_color || ""}
                  onChange={(e) => updateField("ascend_color", e.target.value)}
                  data-testid="iss-color-ascend"
                >
                  <option value="">— Select —</option>
                  {ASCEND_COLORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Accessories</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.accessories_color || ""}
                  onChange={(e) => updateField("accessories_color", e.target.value)}
                  data-testid="iss-color-accessories"
                >
                  <option value="">— Select —</option>
                  {vinylSidingColorGroupsForEstimate(est.lines || []).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Outside Corner</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.outside_corner_color || ""}
                  onChange={(e) => updateField("outside_corner_color", e.target.value)}
                  data-testid="iss-color-outside-corner"
                >
                  <option value="">— Select —</option>
                  {vinylSidingColorGroupsForEstimate(est.lines || []).map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Soffit / Fascia</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.soffit_fascia_color || ""}
                  onChange={(e) => updateField("soffit_fascia_color", e.target.value)}
                  data-testid="iss-color-soffit-fascia"
                >
                  <option value="">— Select —</option>
                  {SOFFIT_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Window Wrap</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.window_wrap_color || ""}
                  onChange={(e) => updateField("window_wrap_color", e.target.value)}
                  data-testid="iss-color-window-wrap"
                >
                  <option value="">— Select —</option>
                  {WINDOW_WRAP_COLORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold block mb-0.5">Gutter</label>
                <select
                  className="input h-9 text-sm w-full"
                  value={est.gutter_color || ""}
                  onChange={(e) => updateField("gutter_color", e.target.value)}
                  data-testid="iss-color-gutter"
                >
                  <option value="">— Select —</option>
                  {GUTTER_COLORS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Pricing controls — Waste Factor + Profit (no Tax for ISS). */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="card p-4" data-testid="iss-waste-card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-2">
              Waste Factor
            </div>
            <div className="flex items-baseline gap-2">
              <input
                className="input num h-9 text-sm w-24"
                type="number"
                step="0.5"
                min="0"
                value={est.waste_pct || 0}
                onChange={(e) => updateField("waste_pct", Number(e.target.value) || 0)}
                data-testid="iss-waste-pct"
              />
              <span className="text-sm text-[#52525B]">% on siding squares</span>
            </div>
            <p className="mt-2 text-[10px] uppercase tracking-wider text-[#A1A1AA]">
              Applied to Install Vinyl Siding subtotal · ${totals.sidingSub.toFixed(2)} × {Number(est.waste_pct) || 0}% = ${totals.wasteAdd.toFixed(2)}
            </p>
          </div>
          {(() => {
            const mode = est.pricing_mode || "margin";
            const isMargin = mode === "margin";
            const pct = Math.min(Number(est.margin_pct) || 0, 99);
            const mult = isMargin ? (pct >= 99 ? Infinity : 1 / (1 - pct / 100)) : 1 + pct / 100;
            return (
              <div className="card p-4" data-testid="iss-profit-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">
                    Profit
                  </div>
                  <div
                    className="inline-flex border border-[#E4E4E7] rounded-sm overflow-hidden text-[10px] font-bold uppercase tracking-wider"
                    data-testid="iss-pricing-mode-toggle"
                  >
                    <button
                      type="button"
                      className={`px-3 py-1 transition ${
                        isMargin
                          ? "bg-[#09090B] text-white"
                          : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
                      }`}
                      onClick={() => updateField("pricing_mode", "margin")}
                      data-testid="iss-pricing-mode-margin"
                    >
                      Margin
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 transition border-l border-[#E4E4E7] ${
                        !isMargin
                          ? "bg-[#09090B] text-white"
                          : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
                      }`}
                      onClick={() => updateField("pricing_mode", "markup")}
                      data-testid="iss-pricing-mode-markup"
                    >
                      Markup
                    </button>
                  </div>
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <input
                    className="input num h-9 text-sm w-24"
                    type="number"
                    step="1"
                    min="0"
                    max={isMargin ? 99 : undefined}
                    value={est.margin_pct || 0}
                    onChange={(e) => updateField("margin_pct", Number(e.target.value) || 0)}
                    data-testid="iss-margin-pct"
                  />
                  <span className="text-sm text-[#52525B]">
                    {isMargin ? "% profit margin" : "% markup on base"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={isMargin ? 95 : 100}
                  step="1"
                  value={est.margin_pct || 0}
                  onChange={(e) => updateField("margin_pct", Number(e.target.value) || 0)}
                  className="w-full accent-[#F97316]"
                  data-testid="iss-margin-slider"
                />
                <div className="mt-2 text-[11px] text-[#71717A] font-mono-num">
                  {isMargin ? (
                    <>Sell = Base ÷ (1 − {pct}%) = <span className="text-[#09090B] font-bold">×{Number.isFinite(mult) ? mult.toFixed(3) : "∞"}</span></>
                  ) : (
                    <>Sell = Base × (1 + {pct}%) = <span className="text-[#09090B] font-bold">×{mult.toFixed(3)}</span></>
                  )}
                </div>
              </div>
            );
          })()}
        </section>

        {(catalog.sections || []).map((sec) => {
          const isOpen = !!openSections[sec.title];
          const sectionTotal = sec.items.reduce((s, it) => {
            const ln = lineByKey.get(`${sec.title}::${it.name}`);
            const qty = Number(ln?.qty) || 0;
            return s + qty * Number(it.price || 0);
          }, 0);
          const filledCount = sec.items.filter((it) => {
            const ln = lineByKey.get(`${sec.title}::${it.name}`);
            return (Number(ln?.qty) || 0) > 0;
          }).length;
          // Common-but-still-unquoted count — matches the badge contractors
          // already know from the Siding section headers.
          const unfilledCommon = sec.items.filter((it) => {
            if (!it.tip) return false;
            const ln = lineByKey.get(`${sec.title}::${it.name}`);
            return (Number(ln?.qty) || 0) <= 0;
          }).length;
          return (
            <section key={sec.title} className="card mb-3" data-testid={`iss-section-${sec.title}`}>
              <button
                type="button"
                onClick={() =>
                  setOpenSections((p) => ({ ...p, [sec.title]: !p[sec.title] }))
                }
                className="w-full flex items-center justify-between px-4 md:px-5 py-3 border-b border-[#E4E4E7] bg-[#FAFAFA] hover:bg-[#F4F4F5]"
                data-testid={`iss-section-toggle-${sec.title}`}
              >
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <div className="section-tag text-left">{sec.title}</div>
                  {filledCount > 0 && (
                    <span className="bg-[#F97316] text-white px-2 py-0.5 text-[10px] tracking-wider font-bold normal-case">
                      {filledCount}
                    </span>
                  )}
                  {unfilledCommon > 0 && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 bg-yellow-100 border border-yellow-400 text-yellow-900 flex items-center gap-1"
                      title="Commonly-needed items in this section haven't been quoted yet"
                      data-testid={`iss-common-flag-${sec.title}`}
                    >
                      <Lightbulb className="w-3 h-3" />
                      {unfilledCommon}
                    </span>
                  )}
                </div>
                <span className="font-mono-num text-sm text-[#52525B]">{fmt(sectionTotal)}</span>
              </button>
              {isOpen && (
                <div className="divide-y divide-[#E4E4E7]">
                  {sec.items.map((it) => {
                    const ln = lineByKey.get(`${sec.title}::${it.name}`);
                    const qty = Number(ln?.qty) || 0;
                    const lineTotal = qty * Number(it.price || 0);
                    return (
                      <div
                        key={it.name}
                        className={`px-4 md:px-5 py-2.5 flex items-center gap-3 flex-wrap ${
                          it.tip
                            ? "bg-[#FEF3C7] border-l-4 border-[#F59E0B]"
                            : ""
                        }`}
                        data-testid={`iss-row-${sec.title}-${it.name}`}
                      >
                        <div className="flex-1 min-w-[200px] flex items-center gap-2">
                          {it.tip && (
                            <span
                              title="Commonly added on most jobs"
                              data-testid={`iss-tip-${sec.title}-${it.name}`}
                              className="flex-shrink-0"
                            >
                              <Lightbulb className="w-4 h-4 text-[#D97706] fill-[#FBBF24]" />
                            </span>
                          )}
                          <div className={`text-sm ${it.tip ? "font-semibold text-[#78350F]" : "text-[#09090B]"}`}>
                            {it.name}
                          </div>
                        </div>
                        <div className="w-16 text-right">
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step={it.unit === "ea" || it.unit === "pr" ? "1" : "0.5"}
                            value={ln ? (qty || "") : ""}
                            placeholder="0"
                            className="input num h-9 text-sm text-center w-full"
                            onChange={(e) => setQty(sec.title, it.name, it.unit, it.price, e.target.value)}
                            data-testid={`iss-qty-${sec.title}-${it.name}`}
                          />
                        </div>
                        <div className="w-12 text-center text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold">
                          {it.unit}
                        </div>
                        <div className="w-24 text-right font-mono-num text-sm text-[#52525B]">
                          {fmt(it.price)}
                        </div>
                        <div className="w-28 text-right font-mono-num text-base font-bold text-[#09090B]" data-testid={`iss-linetotal-${sec.title}-${it.name}`}>
                          {fmt(lineTotal)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {/* Summary — bottom of the editor, mirrors the Siding estimator's
            position. No Tax field per supplier request. */}
        <section className="card p-6 mt-4" data-testid="iss-totals-summary">
          <div className="section-tag mb-4 flex items-center gap-2">
            <span>Summary</span>
            <span
              className="text-[10px] font-bold px-2 py-0.5 bg-orange-50 border border-[#F97316] text-[#F97316]"
              data-testid="iss-summary-tab-badge"
            >
              ISS Quote
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <Stat label="Subtotal" val={fmt(totals.subTotal)} testid="iss-subtotal" />
            <Stat
              label={`Waste (${est.waste_pct || 0}%)`}
              val={fmt(totals.wasteAdd)}
              testid="iss-waste-add"
            />
            <Stat label="Base Cost" val={fmt(totals.base)} testid="iss-base-cost" bold />
            <Stat
              label={`Profit (${est.margin_pct || 0}% ${(est.pricing_mode || "margin")})`}
              val={fmt(totals.profit)}
              testid="iss-profit"
            />
            <Stat label="Sell Price" val={fmt(totals.sell)} testid="iss-sell-price" orange />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              onClick={() => flush({ force: true })}
              disabled={saving}
              data-testid="iss-summary-save-btn"
            >
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn-secondary"
              onClick={handleOpenQuote}
              data-testid="iss-summary-quote-btn"
            >
              <FileText className="w-4 h-4" /> Customer Quote
            </button>
            <button
              className="btn-secondary"
              onClick={handlePrintMaterials}
              data-testid="iss-summary-materials-btn"
            >
              <ClipboardList className="w-4 h-4" /> Material List
            </button>
            <button
              className="btn-secondary"
              onClick={() => window.print()}
              data-testid="iss-summary-print-btn"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
            <button
              className="btn-secondary"
              onClick={handleExportCsv}
              data-testid="iss-summary-export-csv-btn"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </section>
      </div>

      {showQuote && (
        <QuoteModal
          estimate={est}
          totals={{
            subMat: totals.subTotal,
            subLab: 0,
            wasted: totals.subTotal + totals.wasteAdd,
            tax: 0,
            base: totals.base,
            sell: totals.sell,
          }}
          onClose={() => setShowQuote(false)}
          emailConfigured={true}
          onEmail={async ({ recipient_email, html, subject, accept_token }) => {
            try {
              await api.post(`/estimates/${id}/email`, {
                recipient_email,
                html_quote: html,
                subject,
                accept_token,
              });
              toast.success("Quote sent");
              return true;
            } catch (e) {
              toast.error(formatApiError(e.response?.data?.detail));
              return false;
            }
          }}
        />
      )}
    </main>
  );
}

function Stat({ label, val, orange, bold, testid }) {
  return (
    <div className="border-l-2 border-[#E4E4E7] pl-3" data-testid={testid ? `${testid}-card` : undefined}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold">{label}</div>
      <div
        className={`font-mono-num mt-1 ${
          orange
            ? "text-2xl font-bold text-[#F97316]"
            : bold
            ? "text-lg font-bold text-[#09090B]"
            : "text-base text-[#09090B]"
        }`}
        data-testid={testid}
      >
        {val}
      </div>
    </div>
  );
}
