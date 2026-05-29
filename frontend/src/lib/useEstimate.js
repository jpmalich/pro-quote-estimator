import { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

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
        // Preserve any per-line overrides (qty, lab, mat) that were saved on this estimate
        const savedByKey = {};
        (e.data.lines || []).forEach((l) => {
          savedByKey[`${l.section}::${l.name}`] = l;
        });
        const merged = [];
        c.data.sections.forEach((s) =>
          s.items.forEach((it) => {
            const key = `${s.title}::${it.name}`;
            const saved = savedByKey[key];
            merged.push({
              section: s.title,
              name: it.name,
              unit: it.unit,
              mat: saved && saved.mat != null ? saved.mat : it.mat,
              lab: saved && saved.lab != null ? saved.lab : it.lab,
              qty: saved ? saved.qty || 0 : 0,
              // SKU snapshot — taken from catalog so re-saves keep history consistent
              ami_part: it.ami_part || (saved ? saved.ami_part : null) || null,
              // Catalog defaults — used to flag overrides in the UI
              defaultMat: it.mat,
              defaultLab: it.lab,
            });
          })
        );
        setEst({ ...e.data, lines: merged });
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

  const updateLineQty = useCallback((section, name, qty) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        l.section === section && l.name === name ? { ...l, qty: Number(qty) || 0 } : l
      ),
    }));
  }, []);

  const updateLineField = useCallback((section, name, field, value) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        l.section === section && l.name === name ? { ...l, [field]: Number(value) || 0 } : l
      ),
    }));
  }, []);

  const resetLineToDefault = useCallback((section, name) => {
    setEst((e) => ({
      ...e,
      lines: e.lines.map((l) =>
        l.section === section && l.name === name
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
        lines: est.lines.filter((l) => (l.qty || 0) > 0),
        misc_labor: est.misc_labor || [],
        misc_material: est.misc_material || [],
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
