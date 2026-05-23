import React, { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { fmt, formatApiError, API } from "@/lib/api";
import { toast } from "sonner";
import {
  Save, Printer, Mail, ChevronDown, ChevronRight,
  ArrowLeft, ImagePlus, X, FileText, Loader2,
} from "lucide-react";
import QuoteModal from "@/components/QuoteModal";

function calcAll(est) {
  const subMat = (est.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0) +
    (est.misc_material || []).reduce((s, l) => s + (l.mat || 0), 0);
  const subLab = (est.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.lab || 0), 0) +
    (est.misc_material || []).reduce((s, l) => s + (l.lab || 0), 0) +
    (est.misc_labor || []).reduce((s, l) => s + (l.lab || 0), 0);
  const wasted = subMat * (1 + (est.waste_pct || 0) / 100);
  const tax = est.tax_enabled ? wasted * ((est.tax_rate || 0) / 100) : 0;
  const base = wasted + tax + subLab;
  const sell = base * (1 + (est.margin_pct || 0) / 100);
  const profit = sell - base;
  return { subMat, subLab, wasted, tax, base, sell, profit };
}

export default function EstimateEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [est, setEst] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [openSections, setOpenSections] = useState({});
  const [saving, setSaving] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [emailStatus, setEmailStatus] = useState({ configured: false });
  const fileRef = useRef();
  const dirtyRef = useRef(false);

  // Load estimate + catalog
  useEffect(() => {
    (async () => {
      try {
        const [e, c, em] = await Promise.all([
          api.get(`/estimates/${id}`),
          api.get(`/catalog`),
          api.get(`/email/status`),
        ]);
        setEmailStatus(em.data);
        // Merge catalog -> estimate.lines (preserve any saved qty)
        const merged = [];
        const savedByKey = {};
        (e.data.lines || []).forEach((l) => {
          savedByKey[`${l.section}::${l.name}`] = l.qty;
        });
        c.data.sections.forEach((s) =>
          s.items.forEach((it) => {
            const key = `${s.title}::${it.name}`;
            merged.push({
              section: s.title,
              name: it.name,
              unit: it.unit,
              mat: it.mat,
              lab: it.lab,
              qty: savedByKey[key] || 0,
            });
          })
        );
        setEst({ ...e.data, lines: merged });
        setCatalog(c.data.sections);
        const openAll = {};
        c.data.sections.forEach((s) => (openAll[s.title] = true));
        setOpenSections(openAll);
      } catch (e) {
        toast.error(formatApiError(e.response?.data?.detail));
        nav("/");
      }
    })();
  }, [id, nav]);

  const totals = useMemo(() => (est ? calcAll(est) : null), [est]);

  const update = (patch) => {
    setEst((e) => ({ ...e, ...patch }));
    dirtyRef.current = true;
  };

  const updateLineQty = (section, name, qty) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        l.section === section && l.name === name ? { ...l, qty: Number(qty) || 0 } : l
      ),
    }));
    dirtyRef.current = true;
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/estimates/${id}`, {
        customer_name: est.customer_name || "",
        address: est.address || "",
        estimate_number: est.estimate_number || "",
        estimate_date: est.estimate_date || "",
        estimator: est.estimator || "",
        notes: est.notes || "",
        waste_pct: est.waste_pct || 0,
        tax_enabled: !!est.tax_enabled,
        tax_rate: est.tax_rate || 0,
        margin_pct: est.margin_pct || 0,
        lines: est.lines.filter((l) => (l.qty || 0) > 0),
        misc_labor: est.misc_labor || [],
        misc_material: est.misc_material || [],
        photos: est.photos || [],
        status_label: est.status_label || "draft",
      });
      dirtyRef.current = false;
      toast.success("Saved");
      return data;
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const uploadPhoto = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/uploads", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      update({ photos: [...(est.photos || []), data.url] });
      toast.success("Photo added");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  if (!est) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-[#52525B]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading estimate…
      </div>
    );
  }

  const linesBySection = est.lines.reduce((acc, l) => {
    (acc[l.section] = acc[l.section] || []).push(l);
    return acc;
  }, {});

  return (
    <>
      {/* Sticky sell-bar */}
      <div className="sell-bar" data-testid="sticky-bar">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3 sm:gap-6">
          <Link to="/" className="text-white/70 hover:text-white" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-[180px]">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Estimate</div>
            <div className="font-heading text-base sm:text-lg truncate">
              {est.customer_name || "Untitled"} · {est.estimate_number}
            </div>
          </div>
          <div className="flex items-center gap-5 sm:gap-8">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Base</div>
              <div className="font-mono-num text-sm sm:text-base" data-testid="bar-base">{fmt(totals.base)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#F97316]">Sell</div>
              <div className="font-mono-num text-xl sm:text-2xl font-bold text-[#F97316]" data-testid="bar-sell">
                {fmt(totals.sell)}
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">Profit</div>
              <div className="font-mono-num text-sm text-[#10B981]" data-testid="bar-profit">
                {fmt(totals.profit)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24" data-testid="estimate-editor">
        {/* Job Info */}
        <section className="card p-5 sm:p-6 mb-6" data-testid="job-info">
          <div className="section-tag mb-4">Job Information</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label">Customer</label>
              <input className="input" value={est.customer_name || ""} onChange={(e) => update({ customer_name: e.target.value })} data-testid="cust-name" />
            </div>
            <div className="lg:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={est.address || ""} onChange={(e) => update({ address: e.target.value })} data-testid="cust-address" />
            </div>
            <div>
              <label className="label">Estimate #</label>
              <input className="input" value={est.estimate_number || ""} onChange={(e) => update({ estimate_number: e.target.value })} data-testid="est-num" />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={est.estimate_date || ""} onChange={(e) => update({ estimate_date: e.target.value })} data-testid="est-date" />
            </div>
            <div>
              <label className="label">Estimator</label>
              <input className="input" value={est.estimator || ""} onChange={(e) => update({ estimator: e.target.value })} data-testid="estimator-name" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Scope of Work / Notes</label>
              <textarea className="input" rows="3" value={est.notes || ""} onChange={(e) => update({ notes: e.target.value })} data-testid="notes-input" />
            </div>
          </div>
        </section>

        {/* Settings */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="card p-5">
            <div className="section-tag mb-3">Waste Factor</div>
            <div className="flex items-baseline gap-2">
              <input className="input num w-24" type="number" step="0.5" value={est.waste_pct || 0} onChange={(e) => update({ waste_pct: Number(e.target.value) || 0 })} data-testid="waste-pct" />
              <span className="text-[#52525B]">% extra material</span>
            </div>
          </div>
          <div className="card p-5">
            <div className="section-tag mb-3">Sales Tax</div>
            <label className="flex items-center gap-3 mb-3 text-sm">
              <input type="checkbox" checked={!!est.tax_enabled} onChange={(e) => update({ tax_enabled: e.target.checked })} data-testid="tax-toggle" />
              <span>Apply tax on material</span>
            </label>
            <div className="flex items-baseline gap-2">
              <input className="input num w-24" type="number" step="0.01" disabled={!est.tax_enabled} value={est.tax_rate || 0} onChange={(e) => update({ tax_rate: Number(e.target.value) || 0 })} data-testid="tax-rate" />
              <span className="text-[#52525B]">%</span>
            </div>
          </div>
          <div className="card p-5">
            <div className="section-tag mb-3">Margin</div>
            <div className="flex items-baseline gap-2 mb-3">
              <input className="input num w-24" type="number" step="1" value={est.margin_pct || 0} onChange={(e) => update({ margin_pct: Number(e.target.value) || 0 })} data-testid="margin-pct" />
              <span className="text-[#52525B]">% profit on base</span>
            </div>
            <input
              type="range" min="0" max="100" step="1" value={est.margin_pct || 0}
              onChange={(e) => update({ margin_pct: Number(e.target.value) || 0 })}
              className="w-full accent-[#F97316]"
              data-testid="margin-slider"
            />
          </div>
        </section>

        {/* Photos */}
        <section className="card p-5 mb-6" data-testid="photos-panel">
          <div className="flex items-center justify-between mb-3">
            <div className="section-tag">Job Photos</div>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} data-testid="add-photo-btn">
              <ImagePlus className="w-4 h-4" /> Add
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {(est.photos || []).length === 0 && (
              <div className="col-span-full text-sm text-[#A1A1AA] py-4">No photos yet.</div>
            )}
            {(est.photos || []).map((p, i) => (
              <div key={i} className="relative aspect-square bg-[#FAFAFA] border border-[#E4E4E7]">
                <img src={`${process.env.REACT_APP_BACKEND_URL}${p}`} alt="" className="w-full h-full object-cover" />
                <button
                  className="absolute top-1 right-1 bg-white border border-[#09090B] p-1"
                  onClick={() => update({ photos: est.photos.filter((_, j) => j !== i) })}
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Line items by section */}
        {catalog.map((s) => {
          const lines = linesBySection[s.title] || [];
          const isOpen = openSections[s.title];
          const sectionSell =
            lines.reduce((sum, l) => sum + (l.qty || 0) * ((l.mat || 0) + (l.lab || 0)), 0);
          const hasQty = lines.some((l) => (l.qty || 0) > 0);
          return (
            <section key={s.title} className="card mb-4" data-testid={`section-${s.title}`}>
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-left"
                onClick={() => setOpenSections((o) => ({ ...o, [s.title]: !o[s.title] }))}
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="section-tag">{s.title}</span>
                  {hasQty && (
                    <span className="text-[10px] font-bold px-2 py-0.5 border border-[#F97316] text-[#F97316]">
                      {lines.filter((l) => (l.qty || 0) > 0).length} items
                    </span>
                  )}
                </div>
                <div className="font-mono-num text-sm text-[#52525B]">{fmt(sectionSell)}</div>
              </button>
              {isOpen && (
                <div className="border-t border-[#E4E4E7]">
                  <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold border-b border-[#E4E4E7]">
                    <div className="col-span-5">Item</div>
                    <div className="col-span-1">Unit</div>
                    <div className="col-span-2 text-right">Mat $</div>
                    <div className="col-span-1 text-right">Qty</div>
                    <div className="col-span-1 text-right">Lab $</div>
                    <div className="col-span-2 text-right">Total</div>
                  </div>
                  {lines.map((l) => {
                    const total = (l.qty || 0) * ((l.mat || 0) + (l.lab || 0));
                    return (
                      <div key={l.name} className="grid grid-cols-12 gap-3 px-5 py-2 border-b border-[#E4E4E7] items-center">
                        <div className="col-span-12 md:col-span-5 text-sm text-[#09090B]">{l.name}</div>
                        <div className="col-span-3 md:col-span-1 text-xs text-[#A1A1AA] uppercase tracking-wider">{l.unit}</div>
                        <div className="col-span-3 md:col-span-2 text-right text-sm font-mono-num text-[#52525B]">{fmt(l.mat)}</div>
                        <div className="col-span-6 md:col-span-1">
                          <input
                            className="input num h-10 sm:h-9"
                            type="number"
                            inputMode="decimal"
                            step="0.5"
                            min="0"
                            value={l.qty || ""}
                            placeholder="0"
                            onChange={(e) => updateLineQty(l.section, l.name, e.target.value)}
                            data-testid={`qty-${s.title}-${l.name}`}
                          />
                        </div>
                        <div className="col-span-6 md:col-span-1 text-right text-sm font-mono-num text-[#52525B]">{fmt(l.lab)}</div>
                        <div className="col-span-12 md:col-span-2 text-right font-mono-num text-sm font-semibold text-[#09090B]">{fmt(total)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {/* Totals summary */}
        <section className="card p-6" data-testid="totals-summary">
          <div className="section-tag mb-4">Summary</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <Stat label="Material" val={fmt(totals.subMat)} />
            <Stat label={`+ Waste (${est.waste_pct || 0}%)`} val={fmt(totals.wasted)} />
            <Stat label={`Tax (${est.tax_enabled ? est.tax_rate : 0}%)`} val={fmt(totals.tax)} />
            <Stat label="Labor" val={fmt(totals.subLab)} />
            <Stat label="Base Cost" val={fmt(totals.base)} bold />
            <Stat label={`Sell (${est.margin_pct}%)`} val={fmt(totals.sell)} orange />
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" onClick={save} disabled={saving} data-testid="save-btn">
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn-secondary"
              onClick={async () => {
                await save();
                setShowQuote(true);
              }}
              data-testid="open-quote-btn"
            >
              <FileText className="w-4 h-4" /> Customer Quote
            </button>
            <button className="btn-secondary" onClick={() => window.print()} data-testid="print-btn">
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </section>
      </main>

      {showQuote && (
        <QuoteModal
          estimate={est}
          totals={totals}
          onClose={() => setShowQuote(false)}
          emailConfigured={emailStatus.configured}
          onEmail={async (recipient_email, html) => {
            try {
              await api.post(`/estimates/${id}/email`, {
                recipient_email,
                html_quote: html,
                subject: `Estimate ${est.estimate_number} from Wolf and Son Renovations`,
              });
              toast.success("Email sent");
              return true;
            } catch (e) {
              toast.error(formatApiError(e.response?.data?.detail));
              return false;
            }
          }}
        />
      )}
    </>
  );
}

function Stat({ label, val, orange, bold }) {
  return (
    <div className="border-l-2 border-[#E4E4E7] pl-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold">{label}</div>
      <div
        className={`font-mono-num mt-1 ${
          orange ? "text-2xl font-bold text-[#F97316]" : bold ? "text-lg font-bold text-[#09090B]" : "text-base text-[#09090B]"
        }`}
      >
        {val}
      </div>
    </div>
  );
}
