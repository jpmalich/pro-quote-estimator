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
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Lightbulb } from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import {
  vinylSidingColorGroupsForEstimate,
  ASCEND_COLORS,
  SOFFIT_COLOR_GROUPS,
  GUTTER_COLORS,
  WINDOW_WRAP_COLORS,
} from "@/lib/colorOptions";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function ISSEstimateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [est, setEst] = useState(null);
  const [catalog, setCatalog] = useState({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [openSections, setOpenSections] = useState({});
  const [saving, setSaving] = useState(false);

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
  const flush = useCallback(async () => {
    if (!est) return;
    if (savingNow.current) return;
    if (userEdits.current <= savedUpTo.current) return;
    const target = userEdits.current;
    savingNow.current = true;
    setSaving(true);
    try {
      const payload = { ...est };
      // Strip read-only fields the API rejects.
      delete payload.id;
      delete payload.created_at;
      delete payload.updated_at;
      delete payload.user_id;
      delete payload.company_id;
      delete payload.totals;
      delete payload.estimate_number;
      const { data } = await api.put(`/estimates/${id}`, payload);
      savedUpTo.current = target;
      setEst((cur) => ({ ...(cur || {}), ...data, lines: data.lines || [] }));
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

  const grandTotal = useMemo(() => {
    let total = 0;
    for (const sec of catalog.sections || []) {
      for (const it of sec.items) {
        const ln = lineByKey.get(`${sec.title}::${it.name}`);
        const qty = Number(ln?.qty) || 0;
        if (qty > 0) total += qty * Number(it.price || 0);
      }
    }
    return total;
  }, [catalog, lineByKey]);

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
            {saving && (
              <span className="text-[10px] uppercase tracking-wider text-[#F97316] font-bold" data-testid="iss-saving">
                Saving…
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-6">
        <div className="card p-4 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold mb-2">
            ISS Quote · {est.estimate_number || "Draft"}
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
                        className="px-4 md:px-5 py-2.5 flex items-center gap-3 flex-wrap"
                        data-testid={`iss-row-${sec.title}-${it.name}`}
                      >
                        <div className="flex-1 min-w-[200px] flex items-center gap-1.5">
                          {it.tip && (
                            <span
                              title="Commonly added on most jobs"
                              data-testid={`iss-tip-${sec.title}-${it.name}`}
                              className="flex-shrink-0"
                            >
                              <Lightbulb className="w-3.5 h-3.5 text-[#F59E0B]" />
                            </span>
                          )}
                          <div className="text-sm text-[#09090B]">{it.name}</div>
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
      </div>
    </main>
  );
}
