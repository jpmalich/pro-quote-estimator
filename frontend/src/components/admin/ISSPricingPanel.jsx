// Supplier-admin ISS pricing panel.
//
// ISS has 56 lines and prices move independently per line (no flat %),
// so the UI exposes only:
//   • Export  → download the current catalog as CSV
//   • Upload  → drop a CSV/XLSX with the new prices
//
// The upload returns a diff (changes + unmatched rows) which is rendered
// in a preview table. The supplier reviews and clicks Apply to commit.
import React, { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Upload, Download, Check, X, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function ISSPricingPanel({ token }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { changes, unmatched }
  const [applying, setApplying] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const res = await axios.get(`${API}/admin/iss/export`, {
        responseType: "blob",
        headers: { "X-Admin-Token": token },
      });
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `iss-pricing-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("ISS catalog exported");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setBusy(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(
        `${API}/admin/iss/upload`,
        fd,
        { headers: { "Content-Type": "multipart/form-data", "X-Admin-Token": token } },
      );
      setPreview(data);
      if (!data.changes?.length && !data.unmatched?.length) {
        toast.info("No price changes detected");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyChanges = async () => {
    if (!preview?.changes?.length) return;
    setApplying(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/iss/apply`,
        { changes: preview.changes },
        { headers: { "X-Admin-Token": token } },
      );
      toast.success(`Applied ${data.applied} price ${data.applied === 1 ? "change" : "changes"}`);
      setPreview(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="card p-6 mt-6" data-testid="iss-pricing-panel">
      <div className="flex items-center gap-3 mb-2">
        <RefreshCw className="w-5 h-5 text-[#F97316]" />
        <div className="section-tag">ISS Pricing Updates</div>
      </div>
      <p className="text-sm text-[#52525B] mb-4">
        ISS prices float per line. Download the current CSV, edit it in Excel,
        and re-upload — every cell change shows up as a diff before anything is saved.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          className="px-3 py-1.5 bg-white text-[#09090B] border border-[#09090B] hover:bg-[#FAFAFA] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
          onClick={handleExport}
          disabled={busy}
          data-testid="iss-pricing-export-btn"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0])}
          data-testid="iss-pricing-upload-input"
        />
        <button
          type="button"
          className="px-3 py-1.5 bg-[#09090B] text-white hover:bg-[#27272A] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          data-testid="iss-pricing-upload-btn"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {busy ? "Reading…" : "Upload CSV / Excel"}
        </button>
        <span className="text-[10px] text-[#A1A1AA] uppercase tracking-wider">
          Required columns: section, name, unit, price
        </span>
      </div>

      {preview && (
        <div className="border border-[#E4E4E7] rounded-sm" data-testid="iss-pricing-preview">
          <div className="px-4 py-3 bg-[#FAFAFA] border-b border-[#E4E4E7] flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-[#09090B]">
              Diff Preview · {preview.changes?.length || 0} change
              {preview.changes?.length === 1 ? "" : "s"}
              {preview.unmatched?.length ? `, ${preview.unmatched.length} unmatched` : ""}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-1.5 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
                onClick={() => setPreview(null)}
                data-testid="iss-pricing-cancel-btn"
              >
                <X className="w-3.5 h-3.5" />
                Discard
              </button>
              <button
                type="button"
                className="px-3 py-1.5 bg-[#F97316] text-white hover:bg-[#EA580C] text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                onClick={applyChanges}
                disabled={!preview.changes?.length || applying}
                data-testid="iss-pricing-apply-btn"
              >
                {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {applying ? "Applying…" : `Apply ${preview.changes?.length || 0}`}
              </button>
            </div>
          </div>

          {preview.changes?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA] border-b border-[#E4E4E7] bg-[#FAFAFA]">
                  <th className="px-4 py-2">Section</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2 text-right">Old</th>
                  <th className="px-3 py-2 text-right">New</th>
                  <th className="px-3 py-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c, i) => {
                  const delta = c.new - c.old;
                  const pct = c.old ? (delta / c.old) * 100 : 0;
                  return (
                    <tr
                      key={`${c.section}::${c.name}::${i}`}
                      className="border-b border-[#F4F4F5]"
                      data-testid={`iss-pricing-row-${c.section}-${c.name}`}
                    >
                      <td className="px-4 py-2 text-xs text-[#52525B]">{c.section}</td>
                      <td className="px-3 py-2 text-xs text-[#09090B]">{c.name}</td>
                      <td className="px-3 py-2 text-xs text-[#52525B]">{c.unit}</td>
                      <td className="px-3 py-2 text-right font-mono-num text-xs text-[#A1A1AA] line-through">${c.old.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono-num text-xs font-bold text-[#09090B]">${c.new.toFixed(2)}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono-num text-xs font-bold ${
                          delta >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"
                        }`}
                      >
                        {delta >= 0 ? "+" : ""}${delta.toFixed(2)} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-3 text-sm text-[#52525B]">No price differences detected.</div>
          )}

          {preview.unmatched?.length ? (
            <div className="border-t border-[#E4E4E7] px-4 py-3 bg-yellow-50">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-yellow-900">
                <AlertTriangle className="w-3.5 h-3.5" />
                Unmatched rows ({preview.unmatched.length})
              </div>
              <ul className="text-xs text-[#52525B] space-y-1">
                {preview.unmatched.map((u, i) => {
                  // Row number comes from the upload parser; combine with
                  // section+name for a stable key even when 2 rows fail
                  // with the same row number (shouldn't happen, but cheap
                  // insurance vs a bare array index).
                  const k = `${u.row}-${u.section || ""}-${u.name || ""}-${i}`;
                  return (
                    <li key={k} data-testid={`iss-pricing-unmatched-${i}`}>
                      Row {u.row}: <span className="font-mono">{u.section || "?"} · {u.name || "?"}</span> — {u.reason}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
