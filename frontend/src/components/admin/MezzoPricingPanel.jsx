import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Wrench, ClipboardPaste, Save, RotateCcw } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Pretty currency-like display: 4-decimal cap to surface drift, no $ sign
// so the grid stays compact. Use $-prefix only for previews / read-only.
const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00");

/**
 * Mezzo Pricing Admin Matrix
 *
 * 4 tiers × 4 products. Each (tier × product) loads a separate grid:
 *   rows = UI size buckets (e.g. "32-73 UI")
 *   columns = [Base, ...adders]
 *
 * Paste-from-Excel: select the destination cell, then Ctrl/Cmd+V the
 * range. We accept TSV (tabs between cols, newlines between rows) and
 * fill rightward + downward starting from the focused cell. This lets
 * Howard copy a grid out of the source Excel and drop it in directly.
 */
export default function MezzoPricingPanel({ token }) {
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [activeTier, setActiveTier] = useState(null);
  const [activeProduct, setActiveProduct] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [focusedCell, setFocusedCell] = useState(null); // { rowIdx, colIdx }

  // Load full matrix once
  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const { data: res } = await axios.get(
          `${API}/admin/mezzo/prices?token=${encodeURIComponent(token)}`
        );
        if (!alive) return;
        setMeta({
          tiers: res.tiers,
          products: res.products,
          buckets: res.buckets,
          adders: res.adders,
        });
        setData(res.data);
        setActiveTier(res.tiers[0]);
        setActiveProduct(res.products[0]);
      } catch (e) {
        toast.error("Mezzo prices failed to load: " + (e.response?.data?.detail || e.message));
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const grid = useMemo(() => {
    if (!meta || !data || !activeTier || !activeProduct) return null;
    const buckets = meta.buckets[activeProduct] || [];
    const adders = meta.adders[activeProduct] || [];
    const entry = data[activeTier]?.[activeProduct];
    if (!entry) return null;
    return { buckets, adders, base_prices: entry.base_prices, adder_prices: entry.adder_prices };
  }, [meta, data, activeTier, activeProduct]);

  const setCell = (rowIdx, colIdx, value) => {
    const numeric = value === "" ? 0 : Number(value);
    if (!Number.isFinite(numeric)) return;
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const entry = next[activeTier][activeProduct];
      const bucketLabel = grid.buckets[rowIdx].label;
      if (colIdx === 0) {
        entry.base_prices[bucketLabel] = numeric;
      } else {
        const adName = grid.adders[colIdx - 1];
        if (!entry.adder_prices[adName]) entry.adder_prices[adName] = {};
        entry.adder_prices[adName][bucketLabel] = numeric;
      }
      return next;
    });
    setDirty(true);
  };

  const onPaste = (e, rowIdx, colIdx) => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text) return;
    // Excel pastes use \r\n between rows and \t between cells. Strip
    // anything that doesn't look like a numeric matrix (e.g. dollar signs).
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.split(/\t/).map((c) => c.trim().replace(/[$,]/g, "")))
      .filter((r) => r.length > 0 && r.some((c) => c !== ""));
    if (rows.length === 0) return;
    // Multi-cell paste detected — block the default and write our grid.
    if (rows.length > 1 || (rows[0] && rows[0].length > 1)) {
      e.preventDefault();
      setData((prev) => {
        const next = JSON.parse(JSON.stringify(prev));
        const entry = next[activeTier][activeProduct];
        rows.forEach((cells, dr) => {
          const targetRow = rowIdx + dr;
          if (targetRow >= grid.buckets.length) return;
          const bucketLabel = grid.buckets[targetRow].label;
          cells.forEach((raw, dc) => {
            const targetCol = colIdx + dc;
            const parsed = Number(raw);
            const v = Number.isFinite(parsed) ? parsed : 0;
            if (targetCol === 0) {
              entry.base_prices[bucketLabel] = v;
            } else {
              const adIdx = targetCol - 1;
              if (adIdx >= grid.adders.length) return;
              const adName = grid.adders[adIdx];
              if (!entry.adder_prices[adName]) entry.adder_prices[adName] = {};
              entry.adder_prices[adName][bucketLabel] = v;
            }
          });
        });
        return next;
      });
      setDirty(true);
      toast.success(`Pasted ${rows.length} row(s) × ${rows[0]?.length || 0} col(s)`);
    }
  };

  const save = async () => {
    if (!grid) return;
    setBusy(true);
    try {
      const entry = data[activeTier][activeProduct];
      const { data: saved } = await axios.put(
        `${API}/admin/mezzo/prices?token=${encodeURIComponent(token)}`,
        {
          tier: activeTier,
          product_type: activeProduct,
          base_prices: entry.base_prices,
          adder_prices: entry.adder_prices,
        }
      );
      setData((prev) => ({
        ...prev,
        [activeTier]: {
          ...prev[activeTier],
          [activeProduct]: {
            base_prices: saved.base_prices,
            adder_prices: saved.adder_prices,
          },
        },
      }));
      setDirty(false);
      toast.success(`${activeTier} · ${activeProduct} saved`);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      const { data: res } = await axios.get(
        `${API}/admin/mezzo/prices?token=${encodeURIComponent(token)}`
      );
      setData(res.data);
      setDirty(false);
      toast.success("Reloaded from server");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!meta || !data || !grid) {
    return (
      <div className="card p-6 mt-6">
        <div className="flex items-center gap-3 mb-3">
          <Wrench className="w-5 h-5 text-[#F97316]" />
          <div className="section-tag">Mezzo Window Pricing Matrix</div>
        </div>
        <div className="text-sm text-[#A1A1AA]">Loading Mezzo prices…</div>
      </div>
    );
  }

  return (
    <div className="card p-6 mt-6" data-testid="mezzo-pricing-panel">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Wrench className="w-5 h-5 text-[#F97316]" />
          <div>
            <div className="section-tag">Mezzo Window Pricing Matrix</div>
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-0.5">
              4 tiers · 4 products · paste a grid directly from Excel
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] uppercase tracking-wider text-[#F97316] font-bold">
              Unsaved changes
            </span>
          )}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={reload}
            disabled={busy}
            data-testid="mezzo-pricing-reload-btn"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reload
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={save}
            disabled={busy || !dirty}
            data-testid="mezzo-pricing-save-btn"
          >
            <Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save Grid"}
          </button>
        </div>
      </div>

      <p className="text-sm text-[#52525B] mb-4">
        Each grid below is the pricing matrix for one tier × one product.
        Click a cell to edit, or click a cell and <strong>Ctrl/Cmd-V</strong> to
        paste a range copied straight out of Excel. Tempered Full is sqft-rated
        ($9.18 / sqft) and is not in this grid.
      </p>

      {/* Tier tabs */}
      <div
        className="flex border border-[#E4E4E7] mb-3 overflow-x-auto"
        data-testid="mezzo-pricing-tier-tabs"
      >
        {meta.tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              setActiveTier(t);
              setDirty(false);
            }}
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold whitespace-nowrap border-r border-[#E4E4E7] last:border-r-0 transition ${
              activeTier === t ? "bg-[#09090B] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
            data-testid={`mezzo-pricing-tier-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Product tabs */}
      <div
        className="flex border border-[#E4E4E7] mb-4 overflow-x-auto"
        data-testid="mezzo-pricing-product-tabs"
      >
        {meta.products.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              setActiveProduct(p);
              setDirty(false);
            }}
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold whitespace-nowrap border-r border-[#E4E4E7] last:border-r-0 transition ${
              activeProduct === p ? "bg-[#F97316] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
            data-testid={`mezzo-pricing-product-${p}`}
          >
            {p.replace("Mezzo ", "")}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-[#52525B] mb-2 flex items-center gap-1.5">
        <ClipboardPaste className="w-3.5 h-3.5 text-[#F97316]" />
        Tip: copy a block from the Mezzo Excel (Base + adder columns), click
        the top-left cell here, then press <strong className="mx-0.5">Ctrl/Cmd-V</strong>.
      </div>

      {/* Grid */}
      <div className="border border-[#E4E4E7] overflow-x-auto">
        <table className="w-full border-collapse text-xs" data-testid="mezzo-pricing-grid">
          <thead className="bg-[#FAFAFA]">
            <tr>
              <th className="sticky left-0 z-10 bg-[#FAFAFA] text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#71717A] font-bold border-r border-[#E4E4E7] min-w-[110px]">
                UI Bucket
              </th>
              <th className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#09090B] font-bold border-r border-[#E4E4E7] bg-[#FAFAFA] min-w-[100px]">
                Base
              </th>
              {grid.adders.map((a) => (
                <th
                  key={a}
                  className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#52525B] font-bold border-r border-[#E4E4E7] last:border-r-0 min-w-[100px]"
                  title={a}
                >
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.buckets.map((b, rowIdx) => (
              <tr key={b.label} className="border-t border-[#E4E4E7]">
                <td className="sticky left-0 z-10 bg-white px-2 py-0 text-[11px] font-mono-num text-[#09090B] font-semibold border-r border-[#E4E4E7] whitespace-nowrap">
                  {b.label}
                </td>
                {[0, ...grid.adders.map((_, i) => i + 1)].map((colIdx) => {
                  const isBase = colIdx === 0;
                  const value = isBase
                    ? grid.base_prices[b.label]
                    : grid.adder_prices[grid.adders[colIdx - 1]]?.[b.label];
                  const isFocused =
                    focusedCell &&
                    focusedCell.rowIdx === rowIdx &&
                    focusedCell.colIdx === colIdx;
                  return (
                    <td
                      key={colIdx}
                      className={`border-r border-[#E4E4E7] last:border-r-0 ${
                        isBase ? "bg-[#FFFBF5]" : ""
                      } ${isFocused ? "outline outline-1 outline-[#F97316]" : ""}`}
                    >
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={value ?? 0}
                        onChange={(e) => setCell(rowIdx, colIdx, e.target.value)}
                        onFocus={() => setFocusedCell({ rowIdx, colIdx })}
                        onPaste={(e) => onPaste(e, rowIdx, colIdx)}
                        className="w-full h-8 px-2 text-[11px] font-mono-num text-right bg-transparent focus:bg-[#FFF7ED] focus:outline-none"
                        data-testid={`mezzo-cell-${rowIdx}-${colIdx}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] uppercase tracking-wider text-[#A1A1AA]">
        Editing: <span className="text-[#09090B] font-bold">{activeTier}</span>
        <span className="mx-1">·</span>
        <span className="text-[#09090B] font-bold">{activeProduct}</span>
        <span className="ml-2 text-[#71717A] normal-case">
          ({grid.buckets.length} buckets × {grid.adders.length} adders)
        </span>
        <span className="ml-2 text-[#71717A] normal-case">
          · Sample: 32-73 UI Base = ${fmt(grid.base_prices[grid.buckets[0]?.label])}
        </span>
      </div>
    </div>
  );
}
