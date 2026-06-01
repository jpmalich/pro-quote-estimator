import { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Tab model
// ---------------------------------------------------------------------------
// The estimator now supports three parallel "tabs" so the contractor can quote
// the same property in three product lines on one estimate:
//   - vinyl    → traditional Alside Vinyl Siding
//   - ascend   → Ascend Composite Cladding
//   - lp_smart → LP SmartSide engineered wood (catalog populated later)
//
// Each catalog section declares which tabs it belongs to (product_lines from
// the catalog API). Sections shared across product lines (e.g. Tear-Off,
// Gutter, Misc. Labor) appear in MULTIPLE tabs — and each tab holds its own
// independent line items + quantities so the homeowner can see real apples-
// to-apples options side-by-side.
//
// Saved estimate lines carry a `tab` field. Legacy lines (saved before this
// feature) get backfilled based on their section name on first load.
export const TAB_IDS = ["vinyl", "ascend", "lp_smart"];

// Back-compat: legacy Ascend lines → ascend tab; everything else → vinyl.
function legacyTabForSection(sectionTitle) {
  return sectionTitle === "Ascend Cladding/Accessories" ? "ascend" : "vinyl";
}

function inferTab(line) {
  if (line?.tab && TAB_IDS.includes(line.tab)) return line.tab;
  return legacyTabForSection(line?.section);
}

// Compose key used to look up a saved line: tab + section + name uniquely
// identifies a row across all tabs.
function lineKey(tab, section, name) {
  return `${tab}::${section}::${name}`;
}

export default function useEstimate(id) {
  const [est, setEst] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailStatus, setEmailStatus] = useState({ configured: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e, c, em] = await Promise.all([
          api.get(`/estimates/${id}`),
          api.get(`/catalog`),
          api.get(`/email/status`),
        ]);
        if (cancelled) return;

        // Index saved lines by (tab, section, name). Backfill tab for legacy
        // lines that pre-date this field so existing quotes load correctly.
        const savedByKey = {};
        (e.data.lines || []).forEach((l) => {
          const tab = inferTab(l);
          savedByKey[lineKey(tab, l.section, l.name)] = { ...l, tab };
        });

        // Build the merged line set: one entry per (tab, section, name) tuple
        // for every catalog item × every tab that section belongs to. This is
        // what powers the UI — each tab gets its own editable rows.
        const merged = [];
        c.data.sections.forEach((s) => {
          const productLines = s.product_lines || ["vinyl", "ascend"];
          s.items.forEach((it) => {
            productLines.forEach((tab) => {
              const k = lineKey(tab, s.title, it.name);
              const saved = savedByKey[k];
              merged.push({
                tab,
                section: s.title,
                name: it.name,
                unit: it.unit,
                mat: saved && saved.mat != null ? saved.mat : it.mat,
                lab: saved && saved.lab != null ? saved.lab : it.lab,
                qty: saved ? saved.qty || 0 : 0,
                ami_part: it.ami_part || (saved ? saved.ami_part : null) || null,
                // Catalog defaults — used to flag overrides in the UI.
                defaultMat: it.mat,
                defaultLab: it.lab,
              });
            });
          });
        });

        // Backfill tab on misc rows too — legacy misc rows go to vinyl.
        const backfillMisc = (rows) =>
          (rows || []).map((m) => ({
            ...m,
            tab: TAB_IDS.includes(m.tab) ? m.tab : "vinyl",
          }));

        setEst({
          ...e.data,
          lines: merged,
          misc_labor: backfillMisc(e.data.misc_labor),
          misc_material: backfillMisc(e.data.misc_material),
        });
        setCatalog(c.data.sections);
        setEmailStatus(em.data);
      } catch (err) {
        toast.error(formatApiError(err.response?.data?.detail));
        setEst(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const update = useCallback((patch) => {
    setEst((e) => ({ ...e, ...patch }));
  }, []);

  // Matchers now take the tab too — a section + name can exist on multiple
  // tabs with independent quantities, so we must scope updates to one tab.
  const matchLine = (l, tab, section, name) =>
    l.tab === tab && l.section === section && l.name === name;

  const updateLineQty = useCallback((tab, section, name, qty) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        matchLine(l, tab, section, name) ? { ...l, qty: Number(qty) || 0 } : l
      ),
    }));
  }, []);

  const updateLineField = useCallback((tab, section, name, field, value) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        matchLine(l, tab, section, name) ? { ...l, [field]: Number(value) || 0 } : l
      ),
    }));
  }, []);

  const resetLineToDefault = useCallback((tab, section, name) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        matchLine(l, tab, section, name)
          ? { ...l, mat: l.defaultMat, lab: l.defaultLab }
          : l
      ),
    }));
  }, []);

  const save = useCallback(async () => {
    if (!est) return;
    try {
      const payload = {
        customer_name: est.customer_name || "",
        address: est.address || "",
        estimate_number: est.estimate_number || "",
        estimate_date: est.estimate_date || "",
        estimator: est.estimator || "",
        notes: est.notes || "",
        siding_color: est.siding_color || "",
        accessories_color: est.accessories_color || "",
        outside_corner_color: est.outside_corner_color || "",
        soffit_fascia_color: est.soffit_fascia_color || "",
        window_wrap_color: est.window_wrap_color || "",
        waste_pct: est.waste_pct || 0,
        tax_enabled: !!est.tax_enabled,
        tax_rate: est.tax_rate || 0,
        margin_pct: est.margin_pct || 0,
        pricing_mode: est.pricing_mode || "margin",
        lines: est.lines
          .filter((l) => (l.qty || 0) > 0)
          .map((l) => ({
            // Persist the tab so multi-product quotes round-trip cleanly.
            tab: l.tab || "vinyl",
            section: l.section,
            name: l.name,
            unit: l.unit,
            qty: l.qty,
            mat: l.mat,
            lab: l.lab,
            ami_part: l.ami_part || null,
          })),
        misc_labor: (est.misc_labor || []).map((m) => ({
          ...m,
          tab: m.tab || "vinyl",
        })),
        misc_material: (est.misc_material || []).map((m) => ({
          ...m,
          tab: m.tab || "vinyl",
        })),
        photos: est.photos || [],
        status_label: est.status_label || "draft",
      };
      const { data } = await api.put(`/estimates/${id}`, payload);
      toast.success("Saved");
      return data;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [est, id]);

  return { est, catalog, loading, emailStatus, update, updateLineQty, updateLineField, resetLineToDefault, save };
}
