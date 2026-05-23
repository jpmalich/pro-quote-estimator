import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { fmt, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Plus, Trash2, FileText, Search } from "lucide-react";

export default function Dashboard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const nav = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/estimates");
      setItems(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const createEstimate = async () => {
    try {
      const { data } = await api.post("/estimates", {
        customer_name: "",
        estimate_number: `EST-${Date.now().toString().slice(-6)}`,
        estimate_date: new Date().toISOString().slice(0, 10),
      });
      nav(`/estimate/${data.id}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this estimate?")) return;
    await api.delete(`/estimates/${id}`);
    setItems((x) => x.filter((e) => e.id !== id));
    toast.success("Estimate deleted");
  };

  const calcTotals = (e) => {
    const subMat = (e.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.mat || 0), 0) +
      (e.misc_material || []).reduce((s, l) => s + (l.mat || 0), 0);
    const subLab = (e.lines || []).reduce((s, l) => s + (l.qty || 0) * (l.lab || 0), 0) +
      (e.misc_material || []).reduce((s, l) => s + (l.lab || 0), 0) +
      (e.misc_labor || []).reduce((s, l) => s + (l.lab || 0), 0);
    const wasted = subMat * (1 + (e.waste_pct || 0) / 100);
    const tax = e.tax_enabled ? wasted * ((e.tax_rate || 0) / 100) : 0;
    const base = wasted + tax + subLab;
    const sell = base * (1 + (e.margin_pct || 0) / 100);
    return { base, sell };
  };

  const filtered = items.filter((e) =>
    !q ||
    (e.customer_name || "").toLowerCase().includes(q.toLowerCase()) ||
    (e.estimate_number || "").toLowerCase().includes(q.toLowerCase()) ||
    (e.address || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-1">Dashboard</div>
          <h1 className="font-heading text-4xl sm:text-5xl text-[#09090B]">Estimates</h1>
        </div>
        <button className="btn-primary" onClick={createEstimate} data-testid="new-estimate-btn">
          <Plus className="w-4 h-4" /> New Estimate
        </button>
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1AA]" />
        <input
          className="input pl-10"
          placeholder="Search by customer, address, or estimate #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
      </div>

      <div className="card">
        <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 bg-[#E4E4E7] text-xs uppercase tracking-[0.18em] text-[#52525B] font-bold">
          <div className="col-span-2">Estimate #</div>
          <div className="col-span-4">Customer</div>
          <div className="col-span-3">Address</div>
          <div className="col-span-2 text-right">Sell Price</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[#52525B]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center" data-testid="empty-state">
            <FileText className="w-12 h-12 mx-auto text-[#A1A1AA] mb-3" />
            <div className="font-heading text-xl text-[#09090B] mb-1">No estimates yet</div>
            <div className="text-sm text-[#52525B] mb-6">Create your first estimate to get going.</div>
            <button className="btn-primary" onClick={createEstimate}>
              <Plus className="w-4 h-4" /> New Estimate
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
                  {e.estimate_number || "—"}
                </div>
                <div className="col-span-12 md:col-span-4">
                  <div className="font-semibold text-[#09090B]">{e.customer_name || "Untitled"}</div>
                  <div className="text-xs text-[#A1A1AA]">{new Date(e.updated_at).toLocaleString()}</div>
                </div>
                <div className="col-span-12 md:col-span-3 text-sm text-[#52525B] truncate">{e.address || "—"}</div>
                <div className="col-span-8 md:col-span-2 text-right font-mono-num text-lg font-bold text-[#09090B]">
                  {fmt(sell)}
                </div>
                <div className="col-span-4 md:col-span-1 text-right">
                  <button
                    className="btn-danger"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      del(e.id);
                    }}
                    aria-label="Delete"
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
