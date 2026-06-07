import { useEffect, useState, useCallback, useRef } from "react";
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
// Both the new "Ascend Cladding" section AND the legacy combined
// "Ascend Cladding/Accessories" section route to the Ascend tab.
function legacyTabForSection(sectionTitle) {
  return sectionTitle === "Ascend Cladding" ||
    sectionTitle === "Ascend Cladding/Accessories"
    ? "ascend"
    : "vinyl";
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
  // User-edit counter — bumped on every user mutation (update, qty, field,
  // reset). The autosave effect watches this so it can fire ONLY for real
  // user edits, never for the initial load or for est updates triggered
  // by save() itself (e.g. status_label changes from the server).
  const [userEdits, setUserEdits] = useState(0);
  const savingRef = useRef(false);
  // Tracks the userEdits value as of the last successful save (explicit
  // OR debounced). The debounce effect skips firing when userEdits has
  // NOT advanced past this — prevents double-saves like the HOVER Apply
  // flow that explicitly saves immediately AND bumps the counter (which
  // would otherwise re-fire 2 seconds later with the same data).
  const savedUpToRef = useRef(0);

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
                // Iter 36: per-line adders (windows-tab only). Preserved
                // verbatim across catalog merges so toggled upgrades
                // round-trip cleanly through save/reload. Backfill qty
                // on legacy adders that were saved before per-adder qty
                // existed (default to line.qty so old behavior holds).
                adders: saved && Array.isArray(saved.adders)
                  ? saved.adders.map((a) => ({
                      ...a,
                      qty: a.qty != null ? Number(a.qty) : (Number(saved.qty) || 0),
                    }))
                  : [],
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
    setUserEdits((n) => n + 1);
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
    setUserEdits((n) => n + 1);
  }, []);

  const updateLineField = useCallback((tab, section, name, field, value) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        matchLine(l, tab, section, name) ? { ...l, [field]: Number(value) || 0 } : l
      ),
    }));
    setUserEdits((n) => n + 1);
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
    setUserEdits((n) => n + 1);
  }, []);

  // Iter 36: toggle an adder on/off for a specific window line. `adderDef`
  // is the catalog entry { name, mat, lab } from section.adders — when
  // toggled on we append it with qty defaulting to line.qty (so the
  // common case "all 10 windows get Tempered glass" works without
  // typing); when toggled off we remove the entry matching by name.
  const toggleLineAdder = useCallback((tab, section, name, adderDef) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) => {
        if (!matchLine(l, tab, section, name)) return l;
        const current = Array.isArray(l.adders) ? l.adders : [];
        const exists = current.some((a) => a.name === adderDef.name);
        const next = exists
          ? current.filter((a) => a.name !== adderDef.name)
          : [
              ...current,
              {
                name: adderDef.name,
                mat: Number(adderDef.mat) || 0,
                lab: Number(adderDef.lab) || 0,
                qty: Number(l.qty) || 0,
              },
            ];
        return { ...l, adders: next };
      }),
    }));
    setUserEdits((n) => n + 1);
  }, []);

  // Iter 36: update qty on a specific adder entry. Lets the contractor
  // say "10 Double Hung windows, but only 3 get Tempered glass" without
  // creating a separate line.
  const updateAdderQty = useCallback((tab, section, name, adderName, qty) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) => {
        if (!matchLine(l, tab, section, name)) return l;
        const next = (l.adders || []).map((a) =>
          a.name === adderName ? { ...a, qty: Number(qty) || 0 } : a
        );
        return { ...l, adders: next };
      }),
    }));
    setUserEdits((n) => n + 1);
  }, []);

  // Iter 36: sum the qty across every Vero window line so install +
  // lead-safe rows can auto-track. Memoised so callers can read it
  // cheaply during the same render pass.
  const totalWindowQty = useCallback((source) => {
    const lines = (source || est)?.lines || [];
    return lines
      .filter((l) => l.section && l.section.startsWith("Vero ") && l.section.endsWith("Windows"))
      .reduce((s, l) => s + (Number(l.qty) || 0), 0);
  }, [est]);

  // Iter 36: set the windows-tab install method. Auto-migrates the qty
  // from any currently-populated install line to the matching install
  // line and zeroes the others. Contractor can still manually override
  // afterwards if they have a mixed-method job.
  const INSTALL_LINE_FOR_METHOD = {
    pocket: "Window DH/Slider - Pocket Install",
    full_fin: "Window - Full Fin Replacement",
    block_frame: "Window - Block Frame Replacement",
  };
  const setInstallMethod = useCallback((method) => {
    setEst((e) => {
      if (!e) return e;
      const target = INSTALL_LINE_FOR_METHOD[method];
      const allInstallNames = Object.values(INSTALL_LINE_FOR_METHOD);
      const totalQty = (e.lines || [])
        .filter((l) => l.section && l.section.startsWith("Vero ") && l.section.endsWith("Windows"))
        .reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const lines = (e.lines || []).map((l) => {
        if (l.section !== "Window Installation" || !allInstallNames.includes(l.name)) return l;
        if (l.name === target) return { ...l, qty: totalQty };
        return { ...l, qty: 0 };
      });
      return { ...e, install_method: method || "", lines };
    });
    setUserEdits((n) => n + 1);
  // INSTALL_LINE_FOR_METHOD is a stable module-scope literal — safe to
  // omit from deps without dragging a useMemo into the file.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Iter 36: toggle "home built before 1978" — when checked, auto-fill
  // Lead Safe Test Fee (qty=1) + Lead Safe Installation Practices
  // (qty=total window count). When unchecked, zero both.
  const setHomePre1978 = useCallback((checked) => {
    setEst((e) => {
      if (!e) return e;
      const totalQty = (e.lines || [])
        .filter((l) => l.section && l.section.startsWith("Vero ") && l.section.endsWith("Windows"))
        .reduce((s, l) => s + (Number(l.qty) || 0), 0);
      const lines = (e.lines || []).map((l) => {
        if (l.section !== "Window Installation") return l;
        if (l.name === "Lead Safe - Test Fee (all homes 1978 and older are tested)") {
          return { ...l, qty: checked ? 1 : 0 };
        }
        if (l.name === "Lead Safe Installation Practices For Window Installation") {
          return { ...l, qty: checked ? totalQty : 0 };
        }
        return l;
      });
      return { ...e, home_pre_1978: !!checked, lines };
    });
    setUserEdits((n) => n + 1);
  }, []);

  // Build the PUT payload from an estimate object. Used by both save()
  // and any caller that needs to persist freshly-merged data without
  // waiting for React state to flush (e.g. HOVER apply, catalog sync —
  // both update() THEN save() in one user gesture and would otherwise
  // hit the stale-closure issue).
  const buildPayload = useCallback((source) => {
    return {
      kind: source.kind || "siding",
      customer_name: source.customer_name || "",
      address: source.address || "",
      estimate_number: source.estimate_number || "",
      estimate_date: source.estimate_date || "",
      estimator: source.estimator || "",
      notes: source.notes || "",
      siding_color: source.siding_color || "",
      ascend_color: source.ascend_color || "",
      accessories_color: source.accessories_color || "",
      outside_corner_color: source.outside_corner_color || "",
      soffit_fascia_color: source.soffit_fascia_color || "",
      window_wrap_color: source.window_wrap_color || "",
      gutter_color: source.gutter_color || "",
      window_frame_color: source.window_frame_color || "",
      window_interior_color: source.window_interior_color || "",
      window_exterior_color: source.window_exterior_color || "",
      mezzo_interior_color: source.mezzo_interior_color || "",
      mezzo_exterior_color: source.mezzo_exterior_color || "",
      waste_pct: source.waste_pct || 0,
      tax_enabled: !!source.tax_enabled,
      tax_rate: source.tax_rate || 0,
      margin_pct: source.margin_pct || 0,
      pricing_mode: source.pricing_mode || "margin",
      lines: (source.lines || [])
        .filter((l) => (l.qty || 0) > 0)
        .map((l) => ({
          tab: l.tab || "vinyl",
          section: l.section,
          name: l.name,
          unit: l.unit,
          qty: l.qty,
          mat: l.mat,
          lab: l.lab,
          ami_part: l.ami_part || null,
          // Iter 36: persist selected per-line adders (windows-tab only).
          adders: Array.isArray(l.adders)
            ? l.adders.map((a) => ({
                name: a.name,
                mat: Number(a.mat) || 0,
                lab: Number(a.lab) || 0,
                qty: Number(a.qty) || 0,
              }))
            : [],
        })),
      misc_labor: (source.misc_labor || []).map((m) => ({ ...m, tab: m.tab || "vinyl" })),
      misc_material: (source.misc_material || []).map((m) => ({ ...m, tab: m.tab || "vinyl" })),
      // Iter 37: Mezzo openings (W×H-driven) round-trip on the estimate
      // document so price snapshots stay reproducible.
      mezzo_openings: (source.mezzo_openings || []).map((op) => ({
        id: op.id,
        product_type: op.product_type,
        label: op.label || "",
        width: Number(op.width) || 0,
        height: Number(op.height) || 0,
        qty: Number(op.qty) || 0,
        base_mat: Number(op.base_mat) || 0,
        bucket_label: op.bucket_label || "",
        adders: Array.isArray(op.adders)
          ? op.adders.map((a) => ({
              name: a.name,
              mat: Number(a.mat) || 0,
              lab: Number(a.lab) || 0,
              qty: Number(a.qty) || 0,
            }))
          : [],
      })),
      // Iter 39: Vero W×H openings — same opening-snapshot pattern as
      // Mezzo but adds sister-color/glass/tempered/premium picks.
      vero_openings: (source.vero_openings || []).map((op) => ({
        id: op.id,
        product_type: op.product_type,
        sizing: op.sizing || "ui_bucket",
        label: op.label || "",
        width: Number(op.width) || 0,
        height: Number(op.height) || 0,
        model: op.model || "",
        qty: Number(op.qty) || 0,
        sister_color: op.sister_color || "",
        glass_package: op.glass_package || "",
        tempered_upcharge: op.tempered_upcharge || "",
        premium_options: Array.isArray(op.premium_options) ? op.premium_options : [],
        bucket_label: op.bucket_label || "",
        base_mat: Number(op.base_mat) || 0,
        glass_mat: Number(op.glass_mat) || 0,
        tempered_mat: Number(op.tempered_mat) || 0,
        premium_mat: Number(op.premium_mat) || 0,
      })),
      photos: source.photos || [],
      status_label: source.status_label || "draft",
      install_method: source.install_method || "",
      home_pre_1978: !!source.home_pre_1978,
    };
  }, []);

  const save = useCallback(async (overrideEst) => {
    const source = overrideEst || est;
    if (!source) return;
    savingRef.current = true;
    // Snapshot the edit-count NOW so we can mark "saved up to here" even
    // if more edits arrive while the PUT is in flight.
    const editsAtSave = userEditsRef.current;
    try {
      const { data } = await api.put(`/estimates/${id}`, buildPayload(source));
      savedUpToRef.current = editsAtSave;
      toast.success("Saved");
      return data;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      savingRef.current = false;
    }
  }, [est, id, buildPayload]);

  // Quiet autosave — same PUT as save() but no toast (so the user isn't
  // spammed every 2s while typing). Reads the LATEST est via ref so the
  // debounce timer always saves the freshest state.
  const estRef = useRef(est);
  useEffect(() => { estRef.current = est; }, [est]);
  // Same idea for userEdits — save() reads via ref so it can mark
  // savedUpToRef without re-deriving deps.
  const userEditsRef = useRef(userEdits);
  useEffect(() => { userEditsRef.current = userEdits; }, [userEdits]);

  const autosave = useCallback(async () => {
    const source = estRef.current;
    if (!source) return;
    if (savingRef.current) return;
    // Skip if nothing has changed since the last successful save (covers
    // the HOVER-apply case where save() already persisted explicitly).
    if (userEditsRef.current <= savedUpToRef.current) return;
    savingRef.current = true;
    const editsAtSave = userEditsRef.current;
    try {
      await api.put(`/estimates/${id}`, buildPayload(source));
      savedUpToRef.current = editsAtSave;
    } catch {
      // Silently swallow — user can hit Save manually for a toast.
      // Network blips shouldn't bug them every 2 seconds.
    } finally {
      savingRef.current = false;
    }
  }, [id, buildPayload]);

  // Debounced autosave: whenever the user-edit counter ticks, schedule a
  // PUT 2 seconds later. Subsequent edits within that window reset the
  // timer. This way "type qty=10, click away, refresh" never loses the
  // change without the user remembering to hit Save.
  useEffect(() => {
    if (userEdits === 0) return;            // skip initial load
    const t = setTimeout(autosave, 2000);
    return () => clearTimeout(t);
  }, [userEdits, autosave]);

  // Track whether the user has actually edited anything since mount so
  // we only flush on unmount when there's something to save. Updated by
  // an effect on userEdits.
  const hasEditsRef = useRef(false);
  useEffect(() => {
    if (userEdits > 0) hasEditsRef.current = true;
  }, [userEdits]);

  // SPA back-navigation flush: when the editor unmounts (e.g. the user
  // clicks Back/Dashboard from the StickyBar instead of closing the tab),
  // pagehide/beforeunload don't fire. Fire one keepalive PUT on unmount
  // if there have been any user edits — harmlessly redundant when the
  // debounced autosave already ran, but covers "type → immediately Back".
  useEffect(() => {
    return () => {
      if (!hasEditsRef.current) return;
      const source = estRef.current;
      if (!source) return;
      try {
        fetch(`${api.defaults.baseURL}/estimates/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(source)),
          keepalive: true,
        }).catch(() => {});
      } catch { /* best-effort */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // unmount-only effect; closures capture latest via refs

  // Flush any pending autosave when the tab is closed / hidden so the
  // contractor doesn't lose recent edits when navigating away quickly.
  // Uses fetch with keepalive instead of sendBeacon because (a) sendBeacon
  // swallows server-side 401s silently and (b) keepalive carries the
  // same access_token cookie axios uses elsewhere — keeping auth behavior
  // identical to the regular save path.
  useEffect(() => {
    if (userEdits === 0) return;
    const flush = () => {
      const source = estRef.current;
      if (!source) return;
      try {
        const url = `${api.defaults.baseURL}/estimates/${id}`;
        fetch(url, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(source)),
          keepalive: true,
        }).catch(() => {});
      } catch { /* ignore — best-effort flush */ }
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [id, userEdits, buildPayload]);

  return { est, catalog, loading, emailStatus, update, updateLineQty, updateLineField, resetLineToDefault, toggleLineAdder, updateAdderQty, setInstallMethod, setHomePre1978, totalWindowQty, save };
}
