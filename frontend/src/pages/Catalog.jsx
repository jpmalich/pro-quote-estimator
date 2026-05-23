import React, { useEffect, useState } from "react";
import api, { fmt, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Save, RotateCcw, Plus, Trash2 } from "lucide-react";

export default function Catalog() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/catalog");
      setSections(data.sections || []);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const updateItem = (si, ii, key, val) => {
    setSections((arr) => {
      const next = JSON.parse(JSON.stringify(arr));
      next[si].items[ii][key] = key === "name" || key === "unit" ? val : Number(val) || 0;
      return next;
    });
  };
  const addItem = (si) => {
    setSections((arr) => {
      const next = JSON.parse(JSON.stringify(arr));
      next[si].items.push({ name: "New item", unit: "Each", mat: 0, lab: 0 });
      return next;
    });
  };
  const removeItem = (si, ii) => {
    setSections((arr) => {
      const next = JSON.parse(JSON.stringify(arr));
      next[si].items.splice(ii, 1);
      return next;
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.put("/catalog", { sections });
      toast.success("Catalog saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (!window.confirm("Reset catalog to factory defaults? Your edits will be lost."))
      return;
    const { data } = await api.post("/catalog/reset");
    setSections(data.sections);
    toast.success("Reset to defaults");
  };

  if (loading) return <div className="p-10 text-center text-[#52525B]">Loading…</div>;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="catalog-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-1">Settings</div>
          <h1 className="font-heading text-4xl text-[#09090B]">Price Catalog</h1>
          <p className="text-sm text-[#52525B] mt-2">
            Edit material &amp; labor costs. Changes apply to new estimates and recalculations.
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary" onClick={reset} data-testid="reset-catalog-btn">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button className="btn-primary" onClick={save} disabled={saving} data-testid="save-catalog-btn">
            <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Catalog"}
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {sections.map((s, si) => (
          <div key={si} className="card">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#E4E4E7]">
              <div className="section-tag">{s.title}</div>
              <button className="btn-ghost" onClick={() => addItem(si)} data-testid={`add-item-${si}`}>
                <Plus className="w-4 h-4" /> Item
              </button>
            </div>
            <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2 text-[10px] uppercase tracking-[0.18em] text-[#A1A1AA] font-bold border-b border-[#E4E4E7]">
              <div className="col-span-5">Item</div>
              <div className="col-span-2">Unit</div>
              <div className="col-span-2 text-right">Material</div>
              <div className="col-span-2 text-right">Labor</div>
              <div className="col-span-1"></div>
            </div>
            {s.items.map((it, ii) => (
              <div key={ii} className="grid grid-cols-12 gap-3 px-5 py-2 border-b border-[#E4E4E7] items-center">
                <input
                  className="input col-span-12 md:col-span-5"
                  value={it.name}
                  onChange={(e) => updateItem(si, ii, "name", e.target.value)}
                />
                <input
                  className="input col-span-4 md:col-span-2"
                  value={it.unit}
                  onChange={(e) => updateItem(si, ii, "unit", e.target.value)}
                />
                <input
                  className="input num col-span-4 md:col-span-2"
                  type="number"
                  step="0.01"
                  value={it.mat}
                  onChange={(e) => updateItem(si, ii, "mat", e.target.value)}
                />
                <input
                  className="input num col-span-3 md:col-span-2"
                  type="number"
                  step="0.01"
                  value={it.lab}
                  onChange={(e) => updateItem(si, ii, "lab", e.target.value)}
                />
                <button
                  className="btn-danger col-span-1 justify-self-end"
                  onClick={() => removeItem(si, ii)}
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
