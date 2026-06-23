import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import api, { fmt, formatApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { Plus, Trash2, FileText, Search, Download, Copy, Link2 } from "lucide-react";
import EmailPipeline from "@/components/EmailPipeline";

// Categorize an estimate into one of the pipeline buckets based on its lifecycle fields.
function statusOf(e) {
  if (e.accepted_at) return "accepted";
  if (e.last_sent_at) return "sent";
  return "draft";
}

export default function Dashboard({ kind = "siding" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const t = useT();
  const nav = useNavigate();
  // Branding flag we use to gate copy + create-estimate metadata.
  const isWindows = kind === "windows";
  const isIss = kind === "iss";
  const isLp = kind === "lp_smart";

  const FILTERS = useMemo(
    () => [
      { key: "all", label: t("dash.filter.all") },
      { key: "draft", label: t("dash.filter.draft") },
      { key: "sent", label: t("dash.filter.sent") },
      { key: "accepted", label: t("dash.filter.accepted") },
    ],
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Scope the list to the active workspace. Backend treats estimates
      // with no `kind` field as "siding" for back-compat.
      const { data } = await api.get(`/estimates?kind=${kind}`);
      setItems(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => {
    load();
  }, [load]);

  const createEstimate = async () => {
    try {
      const { data } = await api.post("/estimates", {
        customer_name: "",
        estimate_number: `EST-${Date.now().toString().slice(-6)}`,
        estimate_date: new Date().toISOString().slice(0, 10),
        kind, // tag the new estimate with the current workspace
      });
      nav(`/estimate/${data.id}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const del = async (id) => {
    if (!window.confirm(t("dash.confirmDelete"))) return;
    await api.delete(`/estimates/${id}`);
    setItems((x) => x.filter((e) => e.id !== id));
    toast.success(t("dash.deleted"));
  };

  const duplicate = async (id) => {
    try {
      const { data } = await api.post(`/estimates/${id}/duplicate`);
      toast.success(t("dash.duplicated"));
      nav(`/estimate/${data.id}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const calcTotals = (e) => {
    const isWaste = (l) =>
      l.section === "Vinyl Siding" ||
      ((l.section === "Ascend Cladding" ||
        l.section === "Ascend Cladding/Accessories") &&
        (l.name === 'Ascend Composite Lap Siding 7"' ||
          l.name === 'Ascend Composite B&B 12" (add 30% Waste)'));
    const subMat = (e.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0) +
      (e.misc_material || []).reduce((s, l) => s + (l.mat || 0), 0);
    const subLab = (e.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.lab || 0), 0) +
      (e.misc_material || []).reduce((s, l) => s + (l.lab || 0), 0) +
      (e.misc_labor || []).reduce((s, l) => s + (l.lab || 0), 0);
    // Waste applies to siding material only — Vinyl Siding + the 2 Ascend
    // Composite products. Keeps dashboard pipeline totals aligned with the
    // per-estimate calc in lib/calc.js.
    const wasteBase = (e.lines || [])
      .filter(isWaste)
      .reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0);
    const wasted = subMat + wasteBase * ((e.waste_pct || 0) / 100);
    const tax = e.tax_enabled ? wasted * ((e.tax_rate || 0) / 100) : 0;
    const base = wasted + tax + subLab;
    const pct = (e.margin_pct || 0) / 100;
    const mode = e.pricing_mode || "markup";
    let sell;
    if (mode === "margin") {
      const denom = 1 - Math.min(pct, 0.99);
      sell = denom > 0 ? base / denom : base;
    } else {
      sell = base * (1 + pct);
    }
    return { base, sell };
  };

  // Pipeline stats: how many in each bucket + dollar values for sent (pending) and accepted (won).
  const stats = useMemo(() => {
    const out = { draft: 0, sent: 0, accepted: 0, won_total: 0, pending_total: 0 };
    for (const e of items) {
      const s = statusOf(e);
      out[s] += 1;
      const { sell } = calcTotals(e);
      if (s === "accepted") out.won_total += sell;
      if (s === "sent") out.pending_total += sell;
    }
    return out;
  }, [items]);

  const filtered = items
    .filter((e) => statusFilter === "all" || statusOf(e) === statusFilter)
    .filter((e) =>
      !q ||
      (e.customer_name || "").toLowerCase().includes(q.toLowerCase()) ||
      (e.estimate_number || "").toLowerCase().includes(q.toLowerCase()) ||
      (e.address || "").toLowerCase().includes(q.toLowerCase())
    );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-1 flex items-center gap-2">
            <span>{isWindows ? "Windows" : isLp ? "LP SmartSiding" : "Siding"} · {t("dash.eyebrow")}</span>
            <button
              type="button"
              onClick={() => nav("/")}
              className="text-[10px] text-[#F97316] hover:underline"
              data-testid="back-to-picker-btn"
            >
              ← Switch workspace
            </button>
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl text-[#09090B]">
            {isIss ? "ISS Quotes" : isWindows ? "ISS Window Quotes" : isLp ? "LP SmartSiding Quote" : t("dash.title")}
          </h1>
        </div>
        <div className="flex gap-3">
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                const res = await api.get(`/exports/estimates.csv`, { responseType: "blob" });
                const url = URL.createObjectURL(res.data);
                const a = document.createElement("a");
                a.href = url;
                a.download = "estimates.csv";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                toast.error(formatApiError(e.response?.data?.detail));
              }
            }}
            data-testid="export-all-csv-btn"
          >
            <Download className="w-4 h-4" /> {t("dash.exportCsv")}
          </button>
          <button className="btn-primary" onClick={createEstimate} data-testid="new-estimate-btn">
            <Plus className="w-4 h-4" /> {t("dash.newEstimate")}
          </button>
        </div>
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1AA] pointer-events-none" />
        <input
          className="input !pl-10"
          placeholder={t("dash.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
      </div>

      {/* Pipeline stats — Draft / Sent / Accepted with running dollar totals */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
        data-testid="pipeline-stats"
      >
        <StatCard label={t("dash.drafts")} value={stats.draft} sublabel={t("dash.drafts.sub")} />
        <StatCard
          label={t("dash.sent")}
          value={stats.sent}
          sublabel={t("dash.sent.sub", { amount: fmt(stats.pending_total) })}
          accent="orange"
        />
        <StatCard
          label={t("dash.accepted")}
          value={stats.accepted}
          sublabel={t("dash.accepted.sub", { amount: fmt(stats.won_total) })}
          accent="green"
        />
        <StatCard
          label={t("dash.winRate")}
          value={
            stats.sent + stats.accepted === 0
              ? "—"
              : `${Math.round((stats.accepted / (stats.sent + stats.accepted)) * 100)}%`
          }
          sublabel={t("dash.winRate.sub", { won: stats.accepted, total: stats.sent + stats.accepted })}
        />
      </div>

      {/* Status filter chips */}
      <div
        className="flex flex-wrap gap-2 mb-4"
        data-testid="status-filter"
      >
        {FILTERS.map((f) => {
          const active = statusFilter === f.key;
          const count = f.key === "all" ? items.length : stats[f.key];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition ${
                active
                  ? "bg-[#09090B] text-white border-[#09090B]"
                  : "bg-white text-[#52525B] border-[#E4E4E7] hover:border-[#09090B]"
              }`}
              data-testid={`filter-${f.key}`}
            >
              {f.label}
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-sm text-[10px] font-mono-num ${
                  active ? "bg-white/20 text-white" : "bg-[#F4F4F5] text-[#71717A]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card">
        <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 bg-[#E4E4E7] text-xs uppercase tracking-[0.18em] text-[#52525B] font-bold">
          <div className="col-span-2">{t("dash.col.estNum")}</div>
          <div className="col-span-4">{t("dash.col.customer")}</div>
          <div className="col-span-3">{t("dash.col.address")}</div>
          <div className="col-span-2 text-right">{t("dash.col.sellPrice")}</div>
          <div className="col-span-1 text-right">{t("dash.col.actions")}</div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[#52525B]">{t("common.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center" data-testid="empty-state">
            <FileText className="w-12 h-12 mx-auto text-[#A1A1AA] mb-3" />
            <div className="font-heading text-xl text-[#09090B] mb-1">{t("dash.empty.title")}</div>
            <div className="text-sm text-[#52525B] mb-6">{t("dash.empty.sub")}</div>
            <button className="btn-primary" onClick={createEstimate}>
              <Plus className="w-4 h-4" /> {t("dash.newEstimate")}
            </button>
          </div>
        ) : (
          filtered.map((e) => {
            const { sell } = calcTotals(e);
            return (
              <div
                key={e.id}
                className="grid grid-cols-12 gap-4 px-5 py-4 border-t border-[#E4E4E7] items-center hover:bg-[#FAFAFA] cursor-pointer"
                onClick={() => nav(`/estimate/${e.id}`)}
                data-testid={`estimate-row-${e.id}`}
              >
                <div className="col-span-12 md:col-span-2 font-mono-num text-sm text-[#09090B]">
                  <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] md:hidden">#</div>
                  <div className="flex items-center gap-1.5">
                    <span>{e.estimate_number || "—"}</span>
                    {e.paired_estimate_id && (
                      <button
                        type="button"
                        className="text-[#71717A] hover:text-[#F97316] p-0.5 -m-0.5"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          nav(`/estimate/${e.paired_estimate_id}`);
                        }}
                        title={`Paired: ${e.paired_estimate_number || "linked estimate"}`}
                        data-testid={`paired-link-${e.id}`}
                      >
                        <Link2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="col-span-12 md:col-span-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold text-[#09090B]">{e.customer_name || t("dash.untitled")}</div>
                    {e.accepted_at ? (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#DCFCE7] text-[#15803D] border border-[#86EFAC] rounded-sm"
                        title={`Accepted ${new Date(e.accepted_at).toLocaleString()}`}
                        data-testid={`status-accepted-${e.id}`}
                      >
                        ✓ {t("dash.badge.accepted")}
                      </span>
                    ) : e.last_sent_at ? (
                      <span
                        className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA] rounded-sm"
                        title={`Sent ${new Date(e.last_sent_at).toLocaleString()}`}
                        data-testid={`status-sent-${e.id}`}
                      >
                        {t("dash.badge.sent")}
                      </span>
                    ) : null}
                    <EmailPipeline est={e} />
                  </div>
                  <div className="text-xs text-[#A1A1AA]">{new Date(e.updated_at).toLocaleString()}</div>
                </div>
                <div className="col-span-12 md:col-span-3 text-sm text-[#52525B] truncate">{e.address || "—"}</div>
                <div className="col-span-8 md:col-span-2 text-right font-mono-num text-lg font-bold text-[#09090B]">
                  {fmt(sell)}
                </div>
                <div className="col-span-4 md:col-span-1 text-right flex items-center justify-end gap-1">
                  <button
                    className="btn-ghost"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      duplicate(e.id);
                    }}
                    aria-label={t("dash.duplicate.aria")}
                    title={t("dash.duplicate.title")}
                    data-testid={`duplicate-${e.id}`}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    className="btn-danger"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      del(e.id);
                    }}
                    aria-label={t("dash.delete.aria")}
                    data-testid={`delete-${e.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, sublabel, accent }) {
  // The accent strip on the left signals which bucket this card belongs to
  // (orange = Sent / pending revenue, green = Accepted / won revenue).
  const stripe =
    accent === "orange" ? "bg-[#F97316]"
      : accent === "green" ? "bg-[#16A34A]"
      : "bg-[#E4E4E7]";
  return (
    <div className="card flex overflow-hidden">
      <div className={`w-1 ${stripe}`} />
      <div className="px-4 py-3 flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold">
          {label}
        </div>
        <div className="font-mono-num text-2xl font-bold text-[#09090B] leading-tight">
          {value}
        </div>
        {sublabel ? (
          <div className="text-[11px] text-[#71717A] truncate">{sublabel}</div>
        ) : null}
      </div>
    </div>
  );
}
