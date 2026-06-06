import React from "react";
import { useT } from "@/lib/i18n";
import { VINYL_SIDING_COLOR_GROUPS, ASCEND_COLORS, SOFFIT_COLOR_GROUPS, GUTTER_COLORS } from "@/lib/colorOptions";
import HoverImportButton from "@/components/estimate/HoverImportButton";

export default function JobInfoPanel({ est, update, save }) {
  const t = useT();
  return (
    <section className="card p-5 sm:p-6 mb-6" data-testid="job-info">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="section-tag">{t("est.jobInfo")}</div>
        <HoverImportButton est={est} update={update} save={save} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="label">{t("est.customer")}</label>
          <input
            className="input"
            value={est.customer_name || ""}
            onChange={(e) => update({ customer_name: e.target.value })}
            data-testid="cust-name"
          />
        </div>
        <div className="lg:col-span-2">
          <label className="label">{t("est.address")}</label>
          <input
            className="input"
            value={est.address || ""}
            onChange={(e) => update({ address: e.target.value })}
            data-testid="cust-address"
          />
        </div>
        <div>
          <label className="label">{t("est.estimateNum")}</label>
          <input
            className="input"
            value={est.estimate_number || ""}
            onChange={(e) => update({ estimate_number: e.target.value })}
            data-testid="est-num"
          />
        </div>
        <div>
          <label className="label">{t("est.date")}</label>
          <input
            className="input"
            type="date"
            value={est.estimate_date || ""}
            onChange={(e) => update({ estimate_date: e.target.value })}
            data-testid="est-date"
          />
        </div>
        <div>
          <label className="label">{t("est.estimator")}</label>
          <input
            className="input"
            value={est.estimator || ""}
            onChange={(e) => update({ estimator: e.target.value })}
            data-testid="estimator-name"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="label">{t("est.scope")}</label>
          <textarea
            className="input"
            rows="3"
            value={est.notes || ""}
            onChange={(e) => update({ notes: e.target.value })}
            data-testid="notes-input"
          />
        </div>

        {/* Estimate-level colors — appear on the material list so the supplier
            pulls the right color stock for the whole job. */}
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-2">
            {t("est.colors")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="label">{t("est.color.siding")}</label>
              <select
                className="input"
                value={est.siding_color || ""}
                onChange={(e) => update({ siding_color: e.target.value })}
                data-testid="color-siding"
              >
                <option value="">— Select —</option>
                {VINYL_SIDING_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.ascend")}</label>
              <select
                className="input"
                value={est.ascend_color || ""}
                onChange={(e) => update({ ascend_color: e.target.value })}
                data-testid="color-ascend"
              >
                <option value="">— Select —</option>
                {ASCEND_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.accessories")}</label>
              <select
                className="input"
                value={est.accessories_color || ""}
                onChange={(e) => update({ accessories_color: e.target.value })}
                data-testid="color-accessories"
              >
                <option value="">— Select —</option>
                {VINYL_SIDING_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.outsideCorner")}</label>
              <select
                className="input"
                value={est.outside_corner_color || ""}
                onChange={(e) => update({ outside_corner_color: e.target.value })}
                data-testid="color-outside-corner"
              >
                <option value="">— Select —</option>
                {VINYL_SIDING_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.soffitFascia")}</label>
              <select
                className="input"
                value={est.soffit_fascia_color || ""}
                onChange={(e) => update({ soffit_fascia_color: e.target.value })}
                data-testid="color-soffit-fascia"
              >
                <option value="">— Select —</option>
                {SOFFIT_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="label">{t("est.color.windowWrap")}</label>
              <input
                className="input"
                value={est.window_wrap_color || ""}
                placeholder={t("est.color.placeholder")}
                onChange={(e) => update({ window_wrap_color: e.target.value })}
                data-testid="color-window-wrap"
              />
            </div>
            <div>
              <label className="label">{t("est.color.gutter")}</label>
              <select
                className="input"
                value={est.gutter_color || ""}
                onChange={(e) => update({ gutter_color: e.target.value })}
                data-testid="color-gutter"
              >
                <option value="">— Select —</option>
                {GUTTER_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Window-product colors — Windows-kind estimates only. Siding
            estimates use the Window Wrap field above for capping color;
            frame / interior / exterior are window-product attributes. */}
        {est.kind === "windows" && (
        <div className="sm:col-span-2 lg:col-span-3 pt-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-2">
            {t("est.colors.windows")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="label">{t("est.color.windowFrame")}</label>
              <input
                className="input"
                value={est.window_frame_color || ""}
                placeholder={t("est.color.placeholder")}
                onChange={(e) => update({ window_frame_color: e.target.value })}
                data-testid="color-window-frame"
              />
            </div>
            <div>
              <label className="label">{t("est.color.windowInterior")}</label>
              <input
                className="input"
                value={est.window_interior_color || ""}
                placeholder={t("est.color.placeholder")}
                onChange={(e) => update({ window_interior_color: e.target.value })}
                data-testid="color-window-interior"
              />
            </div>
            <div>
              <label className="label">{t("est.color.windowExterior")}</label>
              <input
                className="input"
                value={est.window_exterior_color || ""}
                placeholder={t("est.color.placeholder")}
                onChange={(e) => update({ window_exterior_color: e.target.value })}
                data-testid="color-window-exterior"
              />
            </div>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
