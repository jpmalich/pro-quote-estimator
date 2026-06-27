import React from "react";
import DOMPurify from "dompurify";
import { useT, useLang } from "@/lib/i18n";
import { tColor, tColorGroup } from "@/lib/catalogTranslations";
import { vinylSidingColorGroupsForEstimate, accessoryColorGroupsForEstimate, ASCEND_COLORS, SHAKE_COLOR_GROUPS, BOARD_BATTEN_COLOR_GROUPS, SOFFIT_COLOR_GROUPS, GUTTER_COLORS, WINDOW_WRAP_COLORS, LP_SMARTSIDE_COLORS, MEZZO_EXTERIOR_COLOR_GROUPS, MEZZO_INTERIOR_COLOR_GROUPS, VERO_EXTERIOR_COLOR_GROUPS, VERO_INTERIOR_COLOR_GROUPS, VERO_LAMINATE_NAMES } from "@/lib/colorOptions";
import HoverImportButton from "@/components/estimate/HoverImportButton";
import AIMeasureButton from "@/components/estimate/AIMeasureButton";
import BlueprintMeasureButton from "@/components/estimate/BlueprintMeasureButton";
import PairToLpButton from "@/components/estimate/PairToLpButton";
// Iter 78u — Compare Drawings modal trigger
import { useState } from "react";
import { Upload, FileText, Sparkles, Layers, ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import ElevationCompareModal, { countSources } from "@/components/estimate/ElevationCompareModal";

// Iter 78z+++ — Cleaner job-info header. Three equal-width "tool tiles"
// for the measurement importers (HOVER · Blueprints · AI Photo), each
// with a short label so contractors don't have to read button text to
// tell them apart. PairToLp + Compare Drawings tuck into a "More tools"
// row below the tiles since they're contextual / rare. Form fields
// collapse to a 1-line summary once customer + address are filled so
// the page stops scrolling past data the contractor doesn't need to
// re-touch.
function ToolTile({ icon: Icon, label, sub, children, testid, accent = "#7C3AED" }) {
  return (
    <div
      className="border border-[#E4E4E7] bg-white p-3 flex flex-col gap-2 min-w-0"
      data-testid={testid}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        <div className="text-[10px] uppercase tracking-wider font-bold text-[#52525B] truncate">
          {label}
        </div>
        {sub && (
          <span className="text-[9px] text-[#A1A1AA] uppercase tracking-wider truncate ml-auto">
            {sub}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 items-start">{children}</div>
    </div>
  );
}

export default function JobInfoPanel({ est, update, save, setInstallMethod, setHomePre1978 }) {
  const t = useT();
  const { lang } = useLang();
  // Iter 78u — Compare Drawings modal state
  const [showCompare, setShowCompare] = useState(false);
  const numDrawingSources = countSources(est);
  // Iter 78z+++ — collapse the form section once the contractor has
  // filled the basics. They can re-expand any time via the "Edit"
  // affordance in the summary row.
  const basicsFilled = !!(est?.customer_name && est?.address);
  const [collapsed, setCollapsed] = useState(false);
  // Auto-collapse when basics become filled on first render (but only
  // once — if the user expands manually we respect their choice).
  const [autoTouched, setAutoTouched] = useState(false);
  if (!autoTouched && basicsFilled && !collapsed) {
    // schedule once to avoid setState during render
    setTimeout(() => {
      setCollapsed(true);
      setAutoTouched(true);
    }, 0);
  }
  // Brand-filtered vinyl siding color groups. Computed inline on every
  // render — cheap (an array filter over <30 items) and avoids the
  // hooks/preserve-manual-memoization lint complaint about useMemo +
  // optional chaining. Shared across siding / accessories / outside-corner
  // dropdowns so they all narrow to the active brand together.
  const vinylColorGroups = vinylSidingColorGroupsForEstimate(est?.lines || []);
  // Accessories + Outside Corner pickers also include Ascend so an
  // Ascend-quote contractor can match the corner posts without leaving
  // the field.
  const accessoryColorGroups = accessoryColorGroupsForEstimate(est?.lines || []);
  // Iter 77 — LP SmartSide estimates use the factory ExpertFinish 16-color
  // palette across every applicable color picker, with renamed labels
  // ("LP Siding Color", "Trim Color") and no Window Wrap dropdown.
  const isLp = est?.kind === "lp_smart";
  return (
    <section className="card p-5 sm:p-6 mb-6" data-testid="job-info">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="section-tag">{t("est.jobInfo")}</div>
          {collapsed && basicsFilled && (
            <div className="text-xs text-[#52525B] flex items-center gap-2 flex-wrap" data-testid="job-info-summary">
              <span className="font-bold text-[#09090B]">{est.customer_name}</span>
              <span className="text-[#A1A1AA]">·</span>
              <span>{est.address}</span>
              {est.estimate_number && (
                <>
                  <span className="text-[#A1A1AA]">·</span>
                  <span className="font-mono-num text-[#71717A]">{est.estimate_number}</span>
                </>
              )}
            </div>
          )}
        </div>
        {basicsFilled && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-[10px] uppercase tracking-wider font-bold text-[#7C3AED] hover:text-[#5B21B6] flex items-center gap-1"
            data-testid="job-info-toggle"
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-3 h-3" /> Edit
              </>
            ) : (
              <>
                <ChevronUp className="w-3 h-3" /> Collapse
              </>
            )}
          </button>
        )}
      </div>

      {/* Iter 78z+++ — Measurement tools tile row. Three equal-width
          tiles so HOVER / Blueprints / AI Photo Measure look like the
          parallel choices they actually are. Each tile is a launcher
          + its contextual sub-actions (Restore HOVER, Tag Profiles,
          waste-default caption, resume banner). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3" data-testid="measurement-tools-row">
        <ToolTile icon={Upload} label="HOVER PDF" accent="#09090B" testid="tool-tile-hover">
          <HoverImportButton est={est} update={update} save={save} />
        </ToolTile>
        <ToolTile icon={FileText} label="Blueprints" accent="#7C3AED" testid="tool-tile-blueprint">
          <BlueprintMeasureButton est={est} update={update} save={save} />
        </ToolTile>
        <ToolTile icon={Sparkles} label="AI Photo Measure" accent="#7C3AED" testid="tool-tile-ai">
          <AIMeasureButton
            kind={est.kind || "siding"}
            address={est?.address}
            overhangIn={est?.overhang_in ?? 12}
            estimateId={est?.id}
            onApply={async ({ lines: aiLines, measurements }) => {
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
              // Surface masked-out zones (brick, stone, garage, stucco) on
              // the estimate so the PDF / email can show "Materials
              // excluded: ..." under the siding row.
              const patch = { lines: next };
              if (measurements?._photo_zones_summary) {
                patch.photo_zones_summary = measurements._photo_zones_summary;
                patch.photo_zones_deducted_sqft = measurements._photo_zones_deducted_sqft || 0;
              }
              update(patch);
              if (save) await save({ ...est, ...patch });
            }}
          />
        </ToolTile>
      </div>

      {/* Iter 78z+++ — Workspace-level / contextual tools. Pair to LP
          is a workspace switcher, not a job-info action — it lives
          here in a low-emphasis row so it's reachable but doesn't
          compete with the importers. Compare Drawings only renders
          when 2+ measurement sources exist. */}
      {((est?.kind || "siding") === "siding" || numDrawingSources >= 2) && (
        <div className="flex flex-wrap gap-2 mb-4 justify-end" data-testid="job-info-more-tools">
          {numDrawingSources >= 2 && (
            <button
              type="button"
              onClick={() => setShowCompare(true)}
              className="px-2.5 py-1 text-[10px] uppercase tracking-wider font-bold text-[#71717A] hover:text-[#7C3AED] flex items-center gap-1"
              title="Side-by-side compare drawings across your measurement sources"
              data-testid="compare-drawings-btn"
            >
              <Layers className="w-3 h-3" />
              Compare ({numDrawingSources})
            </button>
          )}
          <PairToLpButton est={est} />
        </div>
      )}

      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${collapsed ? "hidden" : ""}`}
        data-testid="job-info-form"
      >
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
              <label className="label">{isLp ? t("est.color.lpSiding") : t("est.color.siding")}</label>
              <select
                className="input"
                value={est.siding_color || ""}
                onChange={(e) => update({ siding_color: e.target.value })}
                data-testid="color-siding"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : vinylColorGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            {/* Iter 77 — LP SmartSiding doesn't use Ascend or Pelican Bay
                shake palettes; Howard asked to hide those two selectors on
                the LP workspace. Siding (vinyl/ascend) and ISS keep them. */}
            {est.kind !== "lp_smart" && (
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
            )}
            {est.kind !== "lp_smart" && (
            <div>
              <label className="label">{t("est.color.shake")}</label>
              <select
                className="input"
                value={est.shake_color || ""}
                onChange={(e) => update({ shake_color: e.target.value })}
                data-testid="color-shake"
              >
                <option value="">— Select —</option>
                {SHAKE_COLOR_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            )}
            <div>
              <label className="label">{t("est.color.boardBatten")}</label>
              <select
                className="input"
                value={est.board_batten_color || ""}
                onChange={(e) => update({ board_batten_color: e.target.value })}
                data-testid="color-board-batten"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : BOARD_BATTEN_COLOR_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            <div>
              <label className="label">{isLp ? t("est.color.trim") : t("est.color.accessories")}</label>
              <select
                className="input"
                value={est.accessories_color || ""}
                onChange={(e) => update({ accessories_color: e.target.value })}
                data-testid="color-accessories"
              >
                <option value="">— Select —</option>
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : accessoryColorGroups.map((g) => (
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
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : accessoryColorGroups.map((g) => (
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
                {isLp
                  ? LP_SMARTSIDE_COLORS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))
                  : SOFFIT_COLOR_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.colors.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </optgroup>
                    ))}
              </select>
            </div>
            {/* Iter 77 — LP SmartSide doesn't quote window wrap (factory
                trim handles window perimeters); hide the picker on LP. */}
            {!isLp && (
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
            )}
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
                <div className="grid grid-cols-2 gap-1.5" data-testid="install-method-toggle">
                  {[
                    { id: "pocket", label: "Pocket" },
                    { id: "full_fin", label: "Full Fin" },
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
      <ElevationCompareModal
        est={est}
        open={showCompare}
        onClose={() => setShowCompare(false)}
      />
    </section>
  );
}
