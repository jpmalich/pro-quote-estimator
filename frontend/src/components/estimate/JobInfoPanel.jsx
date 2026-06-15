import React from "react";
import DOMPurify from "dompurify";
import { useT, useLang } from "@/lib/i18n";
import { tColor, tColorGroup } from "@/lib/catalogTranslations";
import { vinylSidingColorGroupsForEstimate, ASCEND_COLORS, SOFFIT_COLOR_GROUPS, GUTTER_COLORS, WINDOW_WRAP_COLORS, MEZZO_EXTERIOR_COLOR_GROUPS, MEZZO_INTERIOR_COLOR_GROUPS, VERO_EXTERIOR_COLOR_GROUPS, VERO_INTERIOR_COLOR_GROUPS, VERO_LAMINATE_NAMES } from "@/lib/colorOptions";
import HoverImportButton from "@/components/estimate/HoverImportButton";
import AIMeasureButton from "@/components/estimate/AIMeasureButton";

export default function JobInfoPanel({ est, update, save, setInstallMethod, setHomePre1978 }) {
  const t = useT();
  const { lang } = useLang();
  // Brand-filtered vinyl siding color groups. Computed inline on every
  // render — cheap (an array filter over <30 items) and avoids the
  // hooks/preserve-manual-memoization lint complaint about useMemo +
  // optional chaining. Shared across siding / accessories / outside-corner
  // dropdowns so they all narrow to the active brand together.
  const vinylColorGroups = vinylSidingColorGroupsForEstimate(est?.lines || []);
  return (
    <section className="card p-5 sm:p-6 mb-6" data-testid="job-info">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="section-tag">{t("est.jobInfo")}</div>
        <div className="flex flex-wrap gap-2">
          <HoverImportButton est={est} update={update} save={save} />
          <AIMeasureButton
            kind={est.kind || "siding"}
            address={est?.customer_address}
            onApply={async ({ lines: aiLines }) => {
              const existing = est.lines || [];
              const keyOf = (l) => `${l.tab || "vinyl"}::${l.section}::${l.name}`;
              const byKey = new Map(existing.map((l, i) => [keyOf(l), i]));
              const next = [...existing];
              const SIDING_TABS = new Set(["vinyl", "ascend", "lp_smart"]);
              const WINDOWS_TABS = new Set(["windows"]);
              const srcKind = est.kind || "siding";
              for (const ln of aiLines || []) {
                const isSiding = SIDING_TABS.has(ln.tab || "vinyl");
                const isWindows = WINDOWS_TABS.has(ln.tab || "vinyl");
                if (srcKind === "windows" ? !isWindows : !isSiding) continue;
                const key = keyOf(ln);
                const idx = byKey.get(key);
                if (idx == null) {
                  next.push({ tab: ln.tab || "vinyl", section: ln.section, name: ln.name, unit: ln.unit, qty: ln.qty, mat: 0, lab: 0 });
                } else {
                  next[idx] = { ...next[idx], qty: ln.qty };
                }
              }
              update({ lines: next });
              if (save) await save({ ...est, lines: next });
            }}
          />
        </div>
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
            pulls the right color stock for the whole job. Siding-kind only;
            window-only estimates show the Window Colors block below. */}
        {est.kind !== "windows" && (
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
                {vinylColorGroups.map((g) => (
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
                {vinylColorGroups.map((g) => (
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
                {vinylColorGroups.map((g) => (
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
              <select
                className="input"
                value={est.window_wrap_color || ""}
                onChange={(e) => update({ window_wrap_color: e.target.value })}
                data-testid="color-window-wrap"
              >
                <option value="">— Select —</option>
                {WINDOW_WRAP_COLORS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
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
        )}

        {/* Window-product colors — Windows-kind estimates only. Siding
            estimates use the Window Wrap field above for capping color;
            frame / interior / exterior are window-product attributes. */}
        {est.kind === "windows" && (
        <div className="sm:col-span-2 lg:col-span-3 pt-2 space-y-5">
          {/* Iter 36: Install method + Lead-Safe — windows-job-level
              switches that auto-fill the matching install / lead-safe
              rows so contractors don't have to remember to add them. */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-2">
              Window Job Setup
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="label">Default install method</label>
                <div className="grid grid-cols-3 gap-1.5" data-testid="install-method-toggle">
                  {[
                    { id: "pocket", label: "Pocket" },
                    { id: "full_fin", label: "Full Fin" },
                    { id: "block_frame", label: "Block Frame" },
                  ].map((opt) => {
                    const active = (est.install_method || "") === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`px-3 py-2 text-xs font-bold uppercase tracking-wider border ${
                          active
                            ? "bg-[#09090B] text-white border-[#09090B]"
                            : "bg-white text-[#52525B] border-[#E4E4E7] hover:border-[#09090B]"
                        }`}
                        onClick={() =>
                          setInstallMethod && setInstallMethod(active ? "" : opt.id)
                        }
                        data-testid={`install-method-${opt.id}`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#A1A1AA] mt-1.5 leading-snug">
                  Picks which install row the total window count flows into.
                  Override per-row anytime.
                </p>
              </div>
              <div>
                <label className="label">Lead-Safe RRP</label>
                <label
                  className={`flex items-start gap-2.5 px-3 py-2.5 border cursor-pointer ${
                    est.home_pre_1978
                      ? "bg-[#FEF3C7] border-[#F59E0B]"
                      : "bg-white border-[#E4E4E7] hover:border-[#09090B]"
                  }`}
                  data-testid="pre-1978-toggle"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 mt-0.5 accent-[#F97316] flex-shrink-0"
                    checked={!!est.home_pre_1978}
                    onChange={(ev) =>
                      setHomePre1978 && setHomePre1978(ev.target.checked)
                    }
                    data-testid="pre-1978-checkbox"
                  />
                  <div className="text-xs leading-snug">
                    <div className="font-bold text-[#09090B]">
                      Home built before 1978
                    </div>
                    <div className="text-[#71717A]">
                      Auto-adds Lead Safe Test Fee + Installation Practices for every window.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#A1A1AA] font-bold mb-3">
            {t("est.colors.windows")}
          </div>

          {/* VERO color block — hidden per user request (pricing TBD). White
              forced as the only color choice; the picker is suppressed until
              pricing for the other extruded / laminate / painted finishes is
              re-clarified. */}
          {false && (
          <div className="border border-[#E4E4E7] bg-white p-4 mb-3">
            <div className="text-[11px] uppercase tracking-wider text-[#09090B] font-bold mb-3">
              Vero
              <span className="ml-2 text-[#A1A1AA] font-normal normal-case tracking-normal">
                {t("win.colors.veroDesc")}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t("win.color.exterior")}</label>
                <select
                  className="input"
                  value={est.window_exterior_color || ""}
                  onChange={(e) => update({ window_exterior_color: e.target.value })}
                  data-testid="color-vero-exterior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {VERO_EXTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t("win.color.interior")}</label>
                <select
                  className="input"
                  value={est.window_interior_color || ""}
                  onChange={(e) => update({ window_interior_color: e.target.value })}
                  data-testid="color-vero-interior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {VERO_INTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            {/* Laminate ⇒ white base only. Warn if a tan extruded base is
                paired with a laminate exterior/interior. */}
            {(() => {
              const ext = est.window_exterior_color || "";
              const intr = est.window_interior_color || "";
              const hasLaminate = VERO_LAMINATE_NAMES.has(ext) || VERO_LAMINATE_NAMES.has(intr);
              const conflictsWithTan =
                (VERO_LAMINATE_NAMES.has(ext) && intr === "Tan") ||
                (VERO_LAMINATE_NAMES.has(intr) && ext === "Tan");
              if (conflictsWithTan) {
                return (
                  <div
                    className="mt-2 px-3 py-2 bg-[#FEF2F2] border-l-2 border-[#DC2626] text-[11px] text-[#991B1B]"
                    data-testid="vero-laminate-warning"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("win.color.laminateWarn")) }}
                  />
                );
              }
              if (hasLaminate) {
                return (
                  <div
                    className="mt-2 px-3 py-2 bg-[#F0F9FF] border-l-2 border-[#0284C7] text-[11px] text-[#075985]"
                    data-testid="vero-laminate-notice"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t("win.color.laminateNotice")) }}
                  />
                );
              }
              return null;
            })()}
          </div>
          )}

          {/* MEZZO color block — solid extruded + FrameWorks / Woodgrain */}
          <div className="border border-[#E4E4E7] bg-white p-4">
            <div className="text-[11px] uppercase tracking-wider text-[#09090B] font-bold mb-3">
              Mezzo
              <span className="ml-2 text-[#A1A1AA] font-normal normal-case tracking-normal">
                {t("win.colors.mezzoDesc")}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t("win.color.exterior")}</label>
                <select
                  className="input"
                  value={est.mezzo_exterior_color || ""}
                  onChange={(e) => update({ mezzo_exterior_color: e.target.value })}
                  data-testid="color-mezzo-exterior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {MEZZO_EXTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t("win.color.interior")}</label>
                <select
                  className="input"
                  value={est.mezzo_interior_color || ""}
                  onChange={(e) => update({ mezzo_interior_color: e.target.value })}
                  data-testid="color-mezzo-interior"
                >
                  <option value="">{t("win.color.select")}</option>
                  {MEZZO_INTERIOR_COLOR_GROUPS.map((g) => (
                    <optgroup key={g.label} label={tColorGroup(g.label, lang)}>
                      {g.colors.map((c) => (
                        <option key={c} value={c}>{tColor(c, lang)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
          </div>
          </div>
        </div>
        )}
      </div>
    </section>
  );
}
