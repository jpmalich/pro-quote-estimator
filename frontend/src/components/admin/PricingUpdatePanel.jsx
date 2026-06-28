// Supplier-admin pricing-update workflow. Three tabs:
//   1. Quick Bump  — apply a % to mat/lab across selected tiers
//   2. Upload      — drop a CSV/XLSX with the new prices
//   3. Export      — download current prices to edit in Excel
// All flows funnel through a single DiffPreview so the supplier reviews
// every cell before any write happens.
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Upload, Download, Percent, RefreshCw, Check, X } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function PricingUpdatePanel({ token }) {
  const [tab, setTab] = useState("bump");        // "bump" | "upload" | "export"
  const [tiers, setTiers] = useState([]);
  const [changes, setChanges] = useState(null);  // staged preview
  const [unmatched, setUnmatched] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API}/admin/tiers`, { headers: { "X-Admin-Token": token } });
        setTiers(data);
      } catch (e) {
        toast.error(e.response?.data?.detail || e.message);
      }
    })();
  }, [token]);

  const applyChanges = useCallback(async () => {
    if (!changes?.length) return;
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/pricing/apply`,
        { changes },
        { headers: { "X-Admin-Token": token } },
      );
      toast.success(`Applied ${data.applied} price ${data.applied === 1 ? "change" : "changes"}`);
      setChanges(null);
      setUnmatched([]);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  }, [changes, token]);

  return (
    <div className="card p-6 mt-6" data-testid="pricing-update-panel">
      <div className="flex items-center gap-3 mb-2">
        <RefreshCw className="w-5 h-5 text-[#F97316]" />
        <div className="section-tag">Pricing Updates</div>
      </div>
      <p className="text-sm text-[#52525B] mb-4">
        Bulk-update catalog prices when Alside raises rates. All changes preview as a diff
        before anything is saved — review the table and click Apply when you&apos;re ready.
      </p>

      {/* Tab bar */}
      <div className="inline-flex border border-[#E4E4E7] rounded-sm overflow-hidden text-sm font-bold uppercase tracking-wider mb-5">
        {[
          { key: "bump", label: "Quick Bump", icon: <Percent className="w-3.5 h-3.5" /> },
          { key: "upload", label: "Upload CSV/Excel", icon: <Upload className="w-3.5 h-3.5" /> },
          { key: "export", label: "Export", icon: <Download className="w-3.5 h-3.5" /> },
        ].map((t, i) => (
          <button
            key={t.key}
            type="button"
            className={`px-4 py-2 flex items-center gap-2 transition ${i > 0 ? "border-l border-[#E4E4E7]" : ""} ${
              tab === t.key ? "bg-[#09090B] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
            onClick={() => setTab(t.key)}
            data-testid={`pricing-tab-${t.key}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bump" && (
        <BumpForm tiers={tiers} token={token} setChanges={setChanges} setUnmatched={setUnmatched} />
      )}
      {tab === "upload" && (
        <UploadForm token={token} setChanges={setChanges} setUnmatched={setUnmatched} />
      )}
      {tab === "export" && <ExportPanel token={token} />}

      {/* Diff preview (shared across bump + upload) */}
      {changes !== null && (
        <DiffPreview
          changes={changes}
          unmatched={unmatched}
          onCancel={() => { setChanges(null); setUnmatched([]); }}
          onApply={applyChanges}
          busy={busy}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Bump form
// ---------------------------------------------------------------------------
function BumpForm({ tiers, token, setChanges, setUnmatched }) {
  const [percent, setPercent] = useState(4.5);
  const [target, setTarget] = useState("mat");
  const [tierIds, setTierIds] = useState([]);  // [] = all
  const [busy, setBusy] = useState(false);

  const toggleTier = (id) => {
    setTierIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const preview = async () => {
    if (!percent || isNaN(Number(percent))) {
      toast.error("Enter a percentage (e.g. 4.5 for +4.5%)");
      return;
    }
    setBusy(true);
    try {
      const { data } = await axios.post(
        `${API}/admin/pricing/preview-bump`,
        {
          percent: Number(percent),
          target,
          scope: { tier_ids: tierIds.length ? tierIds : null, section_titles: null },
        },
        { headers: { "X-Admin-Token": token } },
      );
      setChanges(data.changes || []);
      setUnmatched([]);
      if (!data.changes?.length) {
        toast("No changes — current prices already match.");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Percentage change</label>
          <div className="flex items-stretch">
            <input
              type="number"
              step="0.1"
              className="input num"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              data-testid="bump-percent"
            />
            <div className="px-3 flex items-center bg-[#FAFAFA] border border-l-0 border-[#E4E4E7] text-[#52525B] font-mono-num">%</div>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-1">
            Positive = increase. Negative = decrease.
          </p>
        </div>

        <div>
          <label className="label">Apply to</label>
          <select
            className="input"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            data-testid="bump-target"
          >
            <option value="mat">Material only</option>
            <option value="lab">Labor only</option>
            <option value="both">Material + Labor</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            className="btn-primary w-full"
            onClick={preview}
            disabled={busy}
            data-testid="bump-preview-btn"
          >
            {busy ? "Computing…" : "Preview Changes"}
          </button>
        </div>
      </div>

      <div>
        <label className="label">Tiers to update</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTierIds([])}
            className={`px-3 py-1.5 border text-xs uppercase tracking-wider font-bold transition ${
              tierIds.length === 0
                ? "bg-[#09090B] text-white border-[#09090B]"
                : "bg-white text-[#52525B] border-[#E4E4E7] hover:border-[#09090B]"
            }`}
            data-testid="bump-tier-all"
          >
            All tiers
          </button>
          {tiers.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTier(t.id)}
              className={`px-3 py-1.5 border text-xs uppercase tracking-wider font-bold transition ${
                tierIds.includes(t.id)
                  ? "bg-[#F97316] text-white border-[#F97316]"
                  : "bg-white text-[#52525B] border-[#E4E4E7] hover:border-[#F97316]"
              }`}
              data-testid={`bump-tier-${t.name}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload form
// ---------------------------------------------------------------------------
function UploadForm({ token, setChanges, setUnmatched }) {
  const [busy, setBusy] = useState(false);
  const fileRef = React.useRef();

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("commit", "false");
      const { data } = await axios.post(
        `${API}/admin/pricing/upload`,
        fd,
        { headers: { "Content-Type": "multipart/form-data", "X-Admin-Token": token } },
      );
      setChanges(data.changes || []);
      setUnmatched(data.unmatched || []);
      if (!data.changes?.length && !data.unmatched?.length) {
        toast("File parsed — no changes detected.");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#52525B]">
        Upload a <strong>CSV</strong> or <strong>Excel (.xlsx)</strong> file with the new prices.
        Required columns: <code className="font-mono-num text-xs">tier, section, name, unit, mat, lab</code>.
        Tip: <strong>Export</strong> the current pricing first to get the exact format.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
        data-testid="upload-pricing-input"
      />
      <button
        type="button"
        className="btn-primary"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        data-testid="upload-pricing-btn"
      >
        <Upload className="w-4 h-4" />
        {busy ? "Reading file…" : "Choose CSV / Excel"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function ExportPanel({ token }) {
  const download = async () => {
    // SEC-006 — Iter 78z++++: header-based auth. We can't use
    // window.location.href anymore (it can't attach the header), so we
    // fetch the CSV as a blob and synthesize a download link.
    try {
      const res = await axios.get(`${API}/admin/pricing/export`, {
        responseType: "blob",
        headers: { "X-Admin-Token": token },
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `pricing-${today}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || "Export failed");
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#52525B]">
        Download a CSV snapshot of every tier × section × item with current prices.
        Open in Excel, edit the <code className="font-mono-num text-xs">mat</code> and{" "}
        <code className="font-mono-num text-xs">lab</code> columns, save, and re-upload via the Upload tab.
      </p>
      <button
        type="button"
        className="btn-primary"
        onClick={download}
        data-testid="export-pricing-btn"
      >
        <Download className="w-4 h-4" />
        Download Current Pricing (CSV)
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff preview (shared)
// ---------------------------------------------------------------------------
function DiffPreview({ changes, unmatched, onCancel, onApply, busy }) {
  const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
  const total = changes.length;
  const increases = changes.filter((c) => c.new > c.old).length;
  const decreases = changes.filter((c) => c.new < c.old).length;

  return (
    <div className="mt-6 border-2 border-[#F97316] bg-orange-50" data-testid="diff-preview">
      <div className="bg-[#F97316] text-white px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-heading text-base">Review changes</div>
          <div className="text-xs opacity-90 mt-0.5">
            {total} change{total === 1 ? "" : "s"} · {increases} up · {decreases} down
            {unmatched.length > 0 && ` · ${unmatched.length} unmatched`}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 bg-white text-[#52525B] border border-white hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider flex items-center gap-1.5"
            onClick={onCancel}
            disabled={busy}
            data-testid="diff-cancel-btn"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 bg-[#09090B] text-white border border-[#09090B] hover:bg-black text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
            onClick={onApply}
            disabled={busy || total === 0}
            data-testid="diff-apply-btn"
          >
            <Check className="w-3.5 h-3.5" /> {busy ? "Applying…" : `Apply ${total}`}
          </button>
        </div>
      </div>

      {unmatched.length > 0 && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <div className="text-xs uppercase tracking-wider font-bold text-red-700 mb-2">
            Unmatched rows (skipped)
          </div>
          <ul className="text-xs text-red-900 space-y-1 font-mono-num">
            {unmatched.slice(0, 10).map((u) => (
              <li key={`${u.row}-${u.tier || ""}-${u.name || ""}`}>
                Row {u.row}: {u.tier || "?"} · {u.section || "?"} · {u.name || "?"} — <em>{u.reason}</em>
              </li>
            ))}
            {unmatched.length > 10 && <li>…and {unmatched.length - 10} more</li>}
          </ul>
        </div>
      )}

      {total === 0 ? (
        <div className="p-6 text-sm text-[#52525B] text-center">
          No price changes to apply.
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-[#E4E4E7] sticky top-0">
              <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2 text-center">Field</th>
                <th className="px-3 py-2 text-right">Old</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Δ</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {changes.map((c) => {
                const delta = c.new - c.old;
                const pct = c.old ? (delta / c.old) * 100 : 0;
                return (
                  <tr key={`${c.tier_id}-${c.section}-${c.name}-${c.field}`} className="border-b border-[#F4F4F5] hover:bg-[#FAFAFA]">
                    <td className="px-3 py-1.5 font-mono-num text-xs text-[#52525B]">{c.tier_name}</td>
                    <td className="px-3 py-1.5 text-xs text-[#52525B]">{c.section}</td>
                    <td className="px-3 py-1.5 text-xs">{c.name}</td>
                    <td className="px-3 py-1.5 text-center text-[10px] uppercase font-bold tracking-wider text-[#A1A1AA]">{c.field}</td>
                    <td className="px-3 py-1.5 text-right font-mono-num text-xs text-[#A1A1AA] line-through">{usd(c.old)}</td>
                    <td className="px-3 py-1.5 text-right font-mono-num text-xs font-bold">{usd(c.new)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono-num text-xs font-bold ${delta > 0 ? "text-green-700" : "text-red-700"}`}>
                      {delta > 0 ? "+" : ""}{usd(delta)} <span className="opacity-60">({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
