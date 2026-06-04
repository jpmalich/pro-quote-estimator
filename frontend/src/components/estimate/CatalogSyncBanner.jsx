// Banner that surfaces stale prices on a draft estimate. Detection is purely
// client-side: useEstimate.js already populates `defaultMat`/`defaultLab` on
// every line from the *current* catalog while `mat`/`lab` carry the values
// snapshotted at save time. When they diverge, this estimate's prices are
// behind a catalog update — the contractor can review + sync in one click.
//
// Safety: only renders on DRAFT estimates (no last_sent_at, no accepted_at)
// so we never silently change a quote the customer has already received.
import React, { useMemo, useState } from "react";
import { RefreshCw, X, Check } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useT } from "@/lib/i18n";

const DISMISS_KEY = (id) => `sync-banner-dismissed-${id}`;

function diffLines(lines) {
  const out = [];
  for (const l of lines || []) {
    if ((l.qty || 0) <= 0) continue;                 // ignore unused rows
    if (l.defaultMat == null && l.defaultLab == null) continue;
    const matChanged =
      l.defaultMat != null && Math.abs((l.mat || 0) - l.defaultMat) > 0.005;
    const labChanged =
      l.defaultLab != null && Math.abs((l.lab || 0) - l.defaultLab) > 0.005;
    if (matChanged || labChanged) {
      out.push({
        section: l.section,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        mat_old: l.mat || 0,
        mat_new: l.defaultMat,
        lab_old: l.lab || 0,
        lab_new: l.defaultLab,
        mat_changed: matChanged,
        lab_changed: labChanged,
      });
    }
  }
  return out;
}

export default function CatalogSyncBanner({ est, update }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY(est?.id)) === "1"; }
    catch { return false; }
  });

  // Only drafts are sync-eligible. Once a quote has been sent or accepted,
  // we never auto-rewrite the prices the customer saw.
  const isDraft = !est?.last_sent_at && !est?.accepted_at;
  const changes = useMemo(() => (isDraft ? diffLines(est?.lines) : []), [est?.lines, isDraft]);

  if (!isDraft || changes.length === 0 || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY(est.id), "1"); } catch { /* private mode */ }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const staleKeys = new Set(changes.map((c) => `${c.section}::${c.name}`));
      const nextLines = est.lines.map((l) => {
        if (!staleKeys.has(`${l.section}::${l.name}`)) return l;
        return {
          ...l,
          ...(l.defaultMat != null ? { mat: l.defaultMat } : {}),
          ...(l.defaultLab != null ? { lab: l.defaultLab } : {}),
        };
      });
      // Build the same payload shape useEstimate.save() uses, but with the
      // freshly-merged lines — avoids the stale-closure problem of calling
      // parent save() right after update().
      const payload = {
        customer_name: est.customer_name || "",
        address: est.address || "",
        estimate_number: est.estimate_number || "",
        estimate_date: est.estimate_date || "",
        estimator: est.estimator || "",
        notes: est.notes || "",
        siding_color: est.siding_color || "",
        ascend_color: est.ascend_color || "",
        accessories_color: est.accessories_color || "",
        outside_corner_color: est.outside_corner_color || "",
        soffit_fascia_color: est.soffit_fascia_color || "",
        window_wrap_color: est.window_wrap_color || "",
        window_frame_color: est.window_frame_color || "",
        window_interior_color: est.window_interior_color || "",
        window_exterior_color: est.window_exterior_color || "",
        waste_pct: est.waste_pct || 0,
        tax_enabled: !!est.tax_enabled,
        tax_rate: est.tax_rate || 0,
        margin_pct: est.margin_pct || 0,
        pricing_mode: est.pricing_mode || "margin",
        lines: nextLines.filter((l) => (l.qty || 0) > 0),
        misc_labor: est.misc_labor || [],
        misc_material: est.misc_material || [],
        photos: est.photos || [],
        status_label: est.status_label || "draft",
      };
      await api.put(`/estimates/${est.id}`, payload);
      update({ lines: nextLines });
      toast.success(t("est.sync.toast", { n: changes.length }));
      setOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Sync failed");
    } finally {
      setBusy(false);
    }
  };

  const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);

  return (
    <>
      <div
        className="mb-6 border-2 border-[#F97316] bg-orange-50 px-4 py-3 flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row"
        data-testid="sync-banner"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-9 h-9 bg-[#F97316] text-white flex items-center justify-center">
            <RefreshCw className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-[#09090B]">
              {t("est.sync.headline")}
            </div>
            <div className="text-xs text-[#52525B] mt-0.5">
              {t("est.sync.subline", { n: changes.length })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
          <button
            type="button"
            className="px-3 py-1.5 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-xs font-bold uppercase tracking-wider flex-1 sm:flex-none"
            onClick={dismiss}
            data-testid="sync-dismiss-btn"
          >
            {t("est.sync.dismiss")}
          </button>
          <button
            type="button"
            className="px-3 py-1.5 bg-[#09090B] text-white border border-[#09090B] hover:bg-black text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 flex-1 sm:flex-none"
            onClick={() => setOpen(true)}
            data-testid="sync-review-btn"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("est.sync.review")}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
          data-testid="sync-modal-backdrop"
        >
          <div
            className="bg-white max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            data-testid="sync-modal"
          >
            <div className="bg-[#F97316] text-white px-5 py-4 flex items-center justify-between">
              <div>
                <div className="font-heading text-lg">{t("est.sync.modal.title")}</div>
                <div className="text-xs opacity-90 mt-0.5">
                  {t("est.sync.modal.subtitle", { n: changes.length })}
                </div>
              </div>
              <button
                type="button"
                className="text-white/90 hover:text-white"
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                aria-label="Close"
                data-testid="sync-modal-close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAFA] border-b border-[#E4E4E7] sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-[#A1A1AA]">
                    <th className="px-4 py-2">{t("est.sync.col.item")}</th>
                    <th className="px-3 py-2 text-center">{t("est.sync.col.qty")}</th>
                    <th className="px-3 py-2 text-right">{t("est.sync.col.matOld")}</th>
                    <th className="px-3 py-2 text-right">{t("est.sync.col.matNew")}</th>
                    <th className="px-3 py-2 text-right">{t("est.sync.col.labOld")}</th>
                    <th className="px-3 py-2 text-right">{t("est.sync.col.labNew")}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={`${c.section}::${c.name}`} className="border-b border-[#F4F4F5]">
                      <td className="px-4 py-2 text-xs">
                        <div className="font-bold text-[#09090B]">{c.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-0.5">{c.section}</div>
                      </td>
                      <td className="px-3 py-2 text-center font-mono-num text-xs">{c.qty} {c.unit}</td>
                      <td className={`px-3 py-2 text-right font-mono-num text-xs ${c.mat_changed ? "text-[#A1A1AA] line-through" : ""}`}>{usd(c.mat_old)}</td>
                      <td className={`px-3 py-2 text-right font-mono-num text-xs font-bold ${c.mat_changed ? (c.mat_new > c.mat_old ? "text-green-700" : "text-red-700") : "text-[#A1A1AA]"}`}>
                        {c.mat_changed ? usd(c.mat_new) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono-num text-xs ${c.lab_changed ? "text-[#A1A1AA] line-through" : ""}`}>{usd(c.lab_old)}</td>
                      <td className={`px-3 py-2 text-right font-mono-num text-xs font-bold ${c.lab_changed ? (c.lab_new > c.lab_old ? "text-green-700" : "text-red-700") : "text-[#A1A1AA]"}`}>
                        {c.lab_changed ? usd(c.lab_new) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-[#E4E4E7] px-5 py-4 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 bg-white text-[#52525B] border border-[#E4E4E7] hover:bg-[#F4F4F5] text-sm font-bold uppercase tracking-wider"
                onClick={() => setOpen(false)}
                disabled={busy}
                data-testid="sync-cancel-btn"
              >
                {t("est.sync.cancel")}
              </button>
              <button
                type="button"
                className="px-4 py-2 bg-[#09090B] text-white border border-[#09090B] hover:bg-black text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
                onClick={apply}
                disabled={busy}
                data-testid="sync-apply-btn"
              >
                <Check className="w-4 h-4" />
                {busy ? t("est.sync.applying") : t("est.sync.applyButton", { n: changes.length })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
