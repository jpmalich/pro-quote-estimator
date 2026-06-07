import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Wrench, ClipboardPaste, Save, RotateCcw } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "0.00");

// Vero pricing has 4 sub-matrices per (tier × product): base_prices,
// glass_packages, tempered, premium_options. We render them as separate
// tabs inside the tier×product panel so the grid doesn't get unreadable.
const GRID_KINDS = [
  { id: "base_prices", label: "Base · sister color × UI", colsKey: "_sister_colors" },
  { id: "glass_packages", label: "Glass Packages · pkg × UI", colsKey: null },
  { id: "tempered", label: "Tempered Upcharge · pkg × UI", colsKey: null },
  { id: "premium_options", label: "Premium Options · variant × UI", colsKey: null },
];

/** Determines which grid kinds actually have data for the active doc. */
function applicableGrids(doc, sizing) {
  if (sizing === "fixed_model") {
    return [
      { id: "patio_prices", label: "Base · sister color × Model", rowsKey: "_models", colsKey: "_sister_colors" },
      { id: "glass_packages_patio", label: "Glass Packages · pkg × Model", rowsKey: "_models", colsKey: null },
    ];
  }
  const out = [];
  for (const g of GRID_KINDS) {
    const has = doc && doc[g.id] && Object.keys(doc[g.id]).length > 0;
    // base_prices is always shown (so the admin can seed it); the rest
    // appear only if the product type carries that grid.
    if (g.id === "base_prices" || has) {
      out.push({ ...g, rowsKey: "_buckets" });
    }
  }
  return out;
}

export default function VeroPricingPanel({ token }) {
  const [meta, setMeta] = useState(null);
  const [data, setData] = useState(null);
  const [activeTier, setActiveTier] = useState(null);
  const [activeProduct, setActiveProduct] = useState(null);
  const [activeGrid, setActiveGrid] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const { data: res } = await axios.get(
          `${API}/admin/vero/prices?token=${encodeURIComponent(token)}`
        );
        if (!alive) return;
        setMeta({ tiers: res.tiers, products: res.products, products_meta: res.products_meta });
        setData(res.data);
        setActiveTier(res.tiers[0]);
        setActiveProduct(res.products[0]);
        // Pick first applicable grid
        const firstDoc = res.data[res.tiers[0]]?.[res.products[0]];
        const sizing = res.products_meta[res.products[0]]?.sizing || "ui_bucket";
        const grids = applicableGrids(firstDoc, sizing);
        setActiveGrid(grids[0]?.id || "base_prices");
      } catch (e) {
        toast.error("Vero prices failed to load: " + (e.response?.data?.detail || e.message));
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const activeDoc = useMemo(() => {
    if (!data || !activeTier || !activeProduct) return null;
    return data[activeTier]?.[activeProduct];
  }, [data, activeTier, activeProduct]);

  const activeSizing = useMemo(
    () => meta?.products_meta?.[activeProduct]?.sizing || "ui_bucket",
    [meta, activeProduct]
  );

  const grids = useMemo(
    () => activeDoc ? applicableGrids(activeDoc, activeSizing) : [],
    [activeDoc, activeSizing]
  );

  // Resolve current grid: rows (buckets or models), cols (sister colors
  // or named entries), and a 2D value getter / setter.
  const gridSpec = useMemo(() => {
    if (!activeDoc || !activeGrid) return null;
    const grid = grids.find((g) => g.id === activeGrid);
    if (!grid) return null;
    const rows = (grid.rowsKey ? activeDoc[grid.rowsKey] : null) || [];
    const data2d = activeDoc[grid.id] || {};
    // For base_prices / patio_prices: outer dict keys = row labels, inner keys = sister colors
    // For glass / tempered / premium: outer keys = variant names; inner keys = bucket/model labels
    let cols;
    let rows2 = rows;
    let isInverted = false;
    if (grid.id === "base_prices" || grid.id === "patio_prices") {
      cols = activeDoc._sister_colors || [];
      // rows = list of row keys
      rows2 = rows;
    } else {
      // variant × row matrix — invert so admin sees variants on the X-axis
      cols = Object.keys(data2d);  // variant names → columns
      rows2 = rows;                // buckets/models → rows
      isInverted = true;
    }
    const getCell = (rowLabel, colLabel) => {
      if (isInverted) {
        // data[variant][bucket/model]
        return data2d[colLabel]?.[rowLabel];
      }
      return data2d[rowLabel]?.[colLabel];
    };
    return { grid, rows: rows2, cols, getCell, isInverted };
  }, [activeDoc, activeGrid, grids]);

  const setCell = (rowLabel, colLabel, value) => {
    const numeric = value === "" ? 0 : Number(value);
    if (!Number.isFinite(numeric)) return;
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const entry = next[activeTier][activeProduct];
      if (!entry[activeGrid]) entry[activeGrid] = {};
      const isInverted = gridSpec?.isInverted;
      if (isInverted) {
        if (!entry[activeGrid][colLabel]) entry[activeGrid][colLabel] = {};
        entry[activeGrid][colLabel][rowLabel] = numeric;
      } else {
        if (!entry[activeGrid][rowLabel]) entry[activeGrid][rowLabel] = {};
        entry[activeGrid][rowLabel][colLabel] = numeric;
      }
      return next;
    });
    setDirty(true);
  };

  const onPaste = (e, rowIdx, colIdx) => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (!text) return;
    const rows = text
      .split(/\r?\n/)
      .map((r) => r.split(/\t/).map((c) => c.trim().replace(/[$,]/g, "")))
      .filter((r) => r.length > 0 && r.some((c) => c !== ""));
    if (rows.length === 0) return;
    if (rows.length === 1 && rows[0].length === 1) return;  // single cell — let onChange handle
    e.preventDefault();
    const spec = gridSpec;
    if (!spec) return;
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const entry = next[activeTier][activeProduct];
      if (!entry[activeGrid]) entry[activeGrid] = {};
      rows.forEach((cells, dr) => {
        const targetRow = spec.rows[rowIdx + dr];
        if (!targetRow) return;
        cells.forEach((raw, dc) => {
          const targetCol = spec.cols[colIdx + dc];
          if (!targetCol) return;
          const v = Number.isFinite(Number(raw)) ? Number(raw) : 0;
          if (spec.isInverted) {
            if (!entry[activeGrid][targetCol]) entry[activeGrid][targetCol] = {};
            entry[activeGrid][targetCol][targetRow] = v;
          } else {
            if (!entry[activeGrid][targetRow]) entry[activeGrid][targetRow] = {};
            entry[activeGrid][targetRow][targetCol] = v;
          }
        });
      });
      return next;
    });
    setDirty(true);
    toast.success(`Pasted ${rows.length} × ${rows[0]?.length || 0} cells`);
  };

  const save = async () => {
    if (!activeDoc) return;
    setBusy(true);
    try {
      const { data: saved } = await axios.put(
        `${API}/admin/vero/prices?token=${encodeURIComponent(token)}`,
        { tier: activeTier, product_type: activeProduct, payload: activeDoc }
      );
      setData((prev) => ({
        ...prev,
        [activeTier]: { ...prev[activeTier], [activeProduct]: saved },
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
        `${API}/admin/vero/prices?token=${encodeURIComponent(token)}`
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

  if (!meta || !data || !activeDoc || !gridSpec) {
    return (
      <div className="card p-6 mt-6">
        <div className="flex items-center gap-3 mb-3">
          <Wrench className="w-5 h-5 text-[#F97316]" />
          <div className="section-tag">Vero Window Pricing Matrix</div>
        </div>
        <div className="text-sm text-[#A1A1AA]">Loading Vero prices…</div>
      </div>
    );
  }

  const isEmpty = gridSpec.rows.length === 0 || gridSpec.cols.length === 0;

  return (
    <div className="card p-6 mt-6" data-testid="vero-pricing-panel">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Wrench className="w-5 h-5 text-[#F97316]" />
          <div>
            <div className="section-tag">Vero Window Pricing Matrix</div>
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-0.5">
              4 tiers · 6 products · base + glass + tempered + premium — paste from Excel
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] uppercase tracking-wider text-[#F97316] font-bold">
              Unsaved changes
            </span>
          )}
          <button type="button" className="btn-ghost text-xs" onClick={reload} disabled={busy}
                  data-testid="vero-pricing-reload-btn">
            <RotateCcw className="w-3.5 h-3.5" /> Reload
          </button>
          <button type="button" className="btn-primary text-xs" onClick={save} disabled={busy || !dirty}
                  data-testid="vero-pricing-save-btn">
            <Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save Grid"}
          </button>
        </div>
      </div>

      <p className="text-sm text-[#52525B] mb-4">
        Edit any cell or paste a range from the Vero Series pricebook
        (Ctrl/Cmd-V on the top-left target cell). Switch grids with the
        tabs below — each (tier × product) ships with up to 4 sub-grids.
      </p>

      <div className="flex border border-[#E4E4E7] mb-3 overflow-x-auto" data-testid="vero-pricing-tier-tabs">
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
            data-testid={`vero-pricing-tier-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex border border-[#E4E4E7] mb-3 overflow-x-auto" data-testid="vero-pricing-product-tabs">
        {meta.products.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              setActiveProduct(p);
              const doc = data[activeTier]?.[p];
              const grids2 = doc ? applicableGrids(doc, meta.products_meta[p]?.sizing) : [];
              setActiveGrid(grids2[0]?.id || "base_prices");
              setDirty(false);
            }}
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold whitespace-nowrap border-r border-[#E4E4E7] last:border-r-0 transition ${
              activeProduct === p ? "bg-[#F97316] text-white" : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
            data-testid={`vero-pricing-product-${p}`}
          >
            {p.replace("Vero ", "")}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 mb-3" data-testid="vero-pricing-grid-tabs">
        {grids.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Discard unsaved changes?")) return;
              setActiveGrid(g.id);
              setDirty(false);
            }}
            className={`px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold border ${
              activeGrid === g.id ? "bg-[#FFF7ED] border-[#F97316] text-[#F97316]" : "bg-white border-[#E4E4E7] text-[#52525B] hover:bg-[#FAFAFA]"
            }`}
            data-testid={`vero-pricing-grid-${g.id}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="text-[11px] text-[#52525B] mb-2 flex items-center gap-1.5">
        <ClipboardPaste className="w-3.5 h-3.5 text-[#F97316]" />
        Tip: copy a block from the Vero Excel, click the top-left target
        cell, press <strong className="mx-0.5">Ctrl/Cmd-V</strong>.
      </div>

      {isEmpty ? (
        <div className="border border-dashed border-[#E4E4E7] p-8 text-center text-sm text-[#A1A1AA]">
          No data yet for <strong>{activeTier} · {activeProduct}</strong> · {gridSpec.grid.label}.
          {activeTier !== "whole-sale" && (
            <> Seed this grid from your pricebook for {activeTier} or copy the structure from <strong>whole-sale</strong>.</>
          )}
        </div>
      ) : (
        <div className="border border-[#E4E4E7] overflow-x-auto max-h-[600px]">
          <table className="w-full border-collapse text-xs" data-testid="vero-pricing-grid">
            <thead className="bg-[#FAFAFA] sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-10 bg-[#FAFAFA] text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#71717A] font-bold border-r border-[#E4E4E7] min-w-[110px]">
                  {activeSizing === "fixed_model" ? "Model" : "UI Bucket"}
                </th>
                {gridSpec.cols.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#52525B] font-bold border-r border-[#E4E4E7] last:border-r-0 min-w-[120px]" title={c}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridSpec.rows.map((rowLabel, rowIdx) => (
                <tr key={rowLabel} className="border-t border-[#E4E4E7]">
                  <td className="sticky left-0 z-10 bg-white px-2 py-0 text-[11px] font-mono-num text-[#09090B] font-semibold border-r border-[#E4E4E7] whitespace-nowrap">
                    {rowLabel}
                  </td>
                  {gridSpec.cols.map((colLabel, colIdx) => {
                    const v = gridSpec.getCell(rowLabel, colLabel);
                    return (
                      <td key={colLabel} className="border-r border-[#E4E4E7] last:border-r-0">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={v ?? ""}
                          placeholder="0"
                          onChange={(e) => setCell(rowLabel, colLabel, e.target.value)}
                          onPaste={(e) => onPaste(e, rowIdx, colIdx)}
                          className="w-full h-8 px-2 text-[11px] font-mono-num text-right bg-transparent focus:bg-[#FFF7ED] focus:outline-none"
                          data-testid={`vero-cell-${rowIdx}-${colIdx}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-[10px] uppercase tracking-wider text-[#A1A1AA]">
        Editing: <span className="text-[#09090B] font-bold">{activeTier}</span>
        <span className="mx-1">·</span>
        <span className="text-[#09090B] font-bold">{activeProduct}</span>
        <span className="mx-1">·</span>
        <span className="text-[#09090B] font-bold">{gridSpec.grid.label}</span>
        <span className="ml-2 text-[#71717A] normal-case">
          ({gridSpec.rows.length} rows × {gridSpec.cols.length} cols)
        </span>
        {gridSpec.rows[0] && gridSpec.cols[0] && (
          <span className="ml-2 text-[#71717A] normal-case">
            · Sample: {gridSpec.rows[0]} / {gridSpec.cols[0]} = ${fmt(gridSpec.getCell(gridSpec.rows[0], gridSpec.cols[0]))}
          </span>
        )}
      </div>
    </div>
  );
}
