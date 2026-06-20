"""HOVER-style Measurement Report PDF.

Generates a 1–2 page branded measurement report from a finished AI Measure
session. The PDF is intended for two audiences:

1. **The contractor** — a portable, double-checkable record of what Claude
   measured (per-wall table with confidence chips, openings schedule,
   thumbnail of each photo with its elevation tag and confidence). Far
   more useful than a screen-grab when comparing AI numbers to field
   reality.
2. **The homeowner** — when bundled into the Customer Quote PDF, signals
   that the contractor took real measurements (with confidence scores,
   not just a guess), which lifts close rates on premium siding/window
   jobs by adding professionalism.

Layout (inline HTML → WeasyPrint, same pipeline as customer quotes):
  • Header: address + supplier branding + Claude Opus 4.5 attribution
  • Summary grid: siding ft², openings, eaves/rakes LF, story count
  • Per-wall breakdown table with colored confidence chips
  • Openings schedule (grouped by elevation × size)
  • Photo thumbnails grid (4-up, each tagged with elevation + confidence)
  • Notes section (double-count check + Claude's verification notes)

Endpoint: POST /api/measure/report-pdf  (cookie auth)
Body JSON: {
    "estimate_id": "<uuid>",  // pulls session + estimate for address/branding
}
Returns: application/pdf attachment
"""
from __future__ import annotations

import base64
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from config import UPLOAD_DIR
from db import db
from deps import get_current_user
from pdf import render_pdf, safe_filename
from services import get_branding

router = APIRouter(prefix="/measure", tags=["measure"])


class ReportRequest(BaseModel):
    estimate_id: str


def _conf_chip_color(score: float) -> tuple[str, str]:
    """Return (bg-hex, label) for a 0-100 confidence score."""
    if score >= 80:
        return ("#16A34A", "HIGH")
    if score >= 60:
        return ("#CA8A04", "MED")
    if score >= 30:
        return ("#EA580C", "LOW")
    return ("#DC2626", "GUESS")


def _img_to_data_uri(filename: str) -> str | None:
    """Return a data: URI for an upload filename so WeasyPrint can embed
    it inline (avoids fetching back through the network)."""
    path: Path = UPLOAD_DIR / filename
    if not path.exists():
        return None
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    ext = filename.rsplit(".", 1)[-1].lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


# =====================================================================
# Iter 57m — HOVER-style per-elevation wall diagrams + measurement cards
# =====================================================================
# Howard asked: "how do we get the measurements on the house in the pdf
# like hover give me some ideas". Picked options #1 (2D wall diagrams)
# + #2 (per-wall measurement cards). Both are pure SVG/HTML — no extra
# AI calls — and stack as two extra pages between the per-wall table
# and the photo strip in the existing report.
def _ft_in_label(ft_value: float) -> str:
    """Format a decimal-feet value as feet+inches, e.g. 32.5 -> 32' 6\""""
    if ft_value is None or ft_value <= 0:
        return "—"
    ft = int(ft_value)
    inches = round((ft_value - ft) * 12)
    if inches == 12:
        ft += 1
        inches = 0
    if inches == 0:
        return f"{ft}\u2032"
    return f"{ft}\u2032 {inches}\u2033"


def _wall_label_color(label: str) -> tuple[str, str]:
    """Return (accent, soft) hex pair matching the openings-schedule colors."""
    ELEV_COLORS = {
        "front": ("#3B82F6", "#EFF6FF"),
        "back":  ("#16A34A", "#F0FDF4"),
        "left":  ("#EA580C", "#FFF7ED"),
        "right": ("#7C3AED", "#FAF5FF"),
        "other": ("#52525B", "#FAFAFA"),
    }
    return ELEV_COLORS.get((label or "other").lower(), ELEV_COLORS["other"])


def _net_siding_sqft(wall: dict) -> float:
    width = float(wall.get("width_ft") or 0)
    eave = float(wall.get("height_ft") or 0)
    gable = float(wall.get("gable_triangle_height_ft") or 0)
    dormer = float(wall.get("dormer_face_sqft") or 0)
    pct = float(wall.get("siding_pct_this_wall") or 100)
    if 0 < pct < 1:
        pct = pct * 100
    pct = max(0, min(100, pct))
    return (width * eave) * (pct / 100.0) + 0.5 * width * gable + dormer


def _wall_diagram_svg(wall: dict, openings_on_wall: list[dict]) -> str:
    """Render an SVG 2D elevation diagram for one wall with measurements
    labeled around it. Windows/doors are laid out proportionally inside
    the wall rectangle, evenly spaced (Claude doesn't return X-coords
    per opening so we distribute them — good enough for an at-a-glance
    diagram and far closer to HOVER's look than a bare table)."""
    width_ft = max(0.1, float(wall.get("width_ft") or 0))
    eave_ft = max(0.1, float(wall.get("height_ft") or 0))
    gable_ft = float(wall.get("gable_triangle_height_ft") or 0)
    if gable_ft < 0:
        gable_ft = 0
    total_h_ft = eave_ft + gable_ft

    # ViewBox padding for labels around the wall
    pad = max(width_ft * 0.20, total_h_ft * 0.18, 4)
    vb_w = width_ft + pad * 2
    vb_h = total_h_ft + pad * 1.8

    x0 = pad
    y_top_gable = pad * 0.6           # top of gable triangle
    y_eave = y_top_gable + gable_ft   # eave line — top of wall rect
    y_floor = y_eave + eave_ft

    stroke_main = max(vb_w * 0.004, 0.06)
    stroke_thin = max(vb_w * 0.002, 0.03)
    label_fs = vb_w * 0.045

    parts = [
        f'<svg viewBox="0 0 {vb_w:.2f} {vb_h:.2f}" xmlns="http://www.w3.org/2000/svg" '
        f'style="width:100%;height:auto;display:block;background:#FAFAFA;font-family:-apple-system,Arial,sans-serif;">'
    ]

    # Gable triangle (if any)
    if gable_ft > 0:
        parts.append(
            f'<polygon points="{x0:.2f},{y_eave:.2f} {x0+width_ft/2:.2f},{y_top_gable:.2f} {x0+width_ft:.2f},{y_eave:.2f}" '
            f'fill="#F4F4F5" stroke="#27272A" stroke-width="{stroke_main:.3f}" />'
        )
        # Gable height label inside the triangle
        parts.append(
            f'<text x="{x0+width_ft/2:.2f}" y="{(y_top_gable+y_eave)/2 + label_fs*0.3:.2f}" '
            f'text-anchor="middle" font-size="{label_fs*0.6:.2f}" font-weight="600" fill="#7C3AED">'
            f'gable {_ft_in_label(gable_ft)}</text>'
        )

    # Wall rectangle
    parts.append(
        f'<rect x="{x0:.2f}" y="{y_eave:.2f}" width="{width_ft:.2f}" height="{eave_ft:.2f}" '
        f'fill="#FFFFFF" stroke="#09090B" stroke-width="{stroke_main:.3f}" />'
    )

    # Openings (windows + doors): explode counts, lay out evenly along the wall
    placed = []
    for o in openings_on_wall:
        try:
            wi_in = float(o.get("width_in") or 0)
            hi_in = float(o.get("height_in") or 0)
        except (TypeError, ValueError):
            continue
        if wi_in <= 0 or hi_in <= 0:
            continue
        cnt = max(1, int(o.get("count") or 1))
        for _ in range(min(cnt, 12)):  # cap visualization
            placed.append({
                "type": (o.get("type") or "window").lower(),
                "w_ft": wi_in / 12.0,
                "h_ft": hi_in / 12.0,
            })

    n = len(placed)
    if n > 0:
        slot_w = width_ft / (n + 1)
        for idx, op in enumerate(placed):
            ox = x0 + slot_w * (idx + 1) - op["w_ft"] / 2
            if op["type"] in ("entry_door", "patio_door", "garage_door"):
                oy = y_floor - op["h_ft"]      # sit on the floor
                fill = "#B45309"
                stroke = "#78350F"
            else:
                # Window sill at ~38% of wall height from floor (typical)
                oy = y_eave + eave_ft * 0.55 - op["h_ft"] / 2
                fill = "#3B82F6"
                stroke = "#1E40AF"
            # Clamp inside wall
            ox = max(x0 + 0.1, min(x0 + width_ft - op["w_ft"] - 0.1, ox))
            oy = max(y_eave + 0.1, min(y_floor - op["h_ft"] - 0.05, oy))
            parts.append(
                f'<rect x="{ox:.2f}" y="{oy:.2f}" width="{op["w_ft"]:.2f}" height="{op["h_ft"]:.2f}" '
                f'fill="{fill}" fill-opacity="0.55" stroke="{stroke}" stroke-width="{stroke_thin:.3f}" />'
            )

    # Width label (top) with leader-line arrows
    parts.append(
        f'<line x1="{x0:.2f}" y1="{pad*0.30:.2f}" x2="{x0+width_ft:.2f}" y2="{pad*0.30:.2f}" '
        f'stroke="#52525B" stroke-width="{stroke_thin:.3f}" />'
        f'<line x1="{x0:.2f}" y1="{pad*0.20:.2f}" x2="{x0:.2f}" y2="{pad*0.40:.2f}" stroke="#52525B" stroke-width="{stroke_thin:.3f}" />'
        f'<line x1="{x0+width_ft:.2f}" y1="{pad*0.20:.2f}" x2="{x0+width_ft:.2f}" y2="{pad*0.40:.2f}" stroke="#52525B" stroke-width="{stroke_thin:.3f}" />'
        f'<rect x="{x0+width_ft/2 - vb_w*0.08:.2f}" y="{pad*0.05:.2f}" width="{vb_w*0.16:.2f}" height="{label_fs*1.3:.2f}" fill="#FAFAFA" />'
        f'<text x="{x0+width_ft/2:.2f}" y="{pad*0.05 + label_fs:.2f}" '
        f'text-anchor="middle" font-size="{label_fs:.2f}" font-weight="800" fill="#09090B">'
        f'{_ft_in_label(width_ft)}</text>'
    )

    # Eave height label (right side, rotated)
    h_label_x = x0 + width_ft + pad * 0.5
    h_label_y = (y_eave + y_floor) / 2
    parts.append(
        f'<line x1="{x0+width_ft+pad*0.15:.2f}" y1="{y_eave:.2f}" x2="{x0+width_ft+pad*0.15:.2f}" y2="{y_floor:.2f}" '
        f'stroke="#52525B" stroke-width="{stroke_thin:.3f}" />'
        f'<text x="{h_label_x:.2f}" y="{h_label_y:.2f}" '
        f'text-anchor="middle" font-size="{label_fs:.2f}" font-weight="800" fill="#09090B" '
        f'transform="rotate(90 {h_label_x:.2f} {h_label_y:.2f})">'
        f'{_ft_in_label(eave_ft)}</text>'
    )

    parts.append('</svg>')
    return "".join(parts)


def _build_wall_diagrams_section(walls: list[dict], openings_schedule: list[dict]) -> str:
    """Render the per-elevation 2D wall-diagram page. Each wall gets a
    panel with the SVG diagram + a tight summary footer."""
    if not walls:
        return ""
    # Group openings by wall label for fast lookup
    ops_by_wall: dict[str, list[dict]] = {}
    for o in openings_schedule or []:
        elev = (o.get("elevation") or "other").lower()
        ops_by_wall.setdefault(elev, []).append(o)

    panels = []
    for w in walls:
        label = (w.get("label") or "other").lower()
        accent, soft = _wall_label_color(label)
        width_ft = float(w.get("width_ft") or 0)
        eave_ft = float(w.get("height_ft") or 0)
        net = _net_siding_sqft(w)
        conf = float(w.get("confidence") or 0)
        chip_bg, chip_label = _conf_chip_color(conf)
        if width_ft <= 0 and eave_ft <= 0:
            continue
        diagram = _wall_diagram_svg(w, ops_by_wall.get(label, []))
        ops_count = sum(int(o.get("count") or 1) for o in ops_by_wall.get(label, []))
        dormer_sf = float(w.get("dormer_face_sqft") or 0)
        gable_ft = float(w.get("gable_triangle_height_ft") or 0)
        meta_bits = [f'{_ft_in_label(width_ft)} wide', f'{_ft_in_label(eave_ft)} eave']
        if gable_ft > 0:
            meta_bits.append(f'gable {_ft_in_label(gable_ft)}')
        if dormer_sf > 0:
            meta_bits.append(f'dormer {dormer_sf:.0f} ft\u00b2')
        meta_bits.append(f'{ops_count} opening{"s" if ops_count != 1 else ""}')
        meta_joined = " \u00b7 ".join(meta_bits)
        panels.append(
            f'<div style="width:48%;display:inline-block;vertical-align:top;margin:0 1% 14px 1%;border:1px solid #E4E4E7;background:#FFFFFF;">'
            f'<div style="background:{soft};border-left:4px solid {accent};padding:6px 10px;display:flex;justify-content:space-between;align-items:center;">'
            f'<span style="background:{accent};color:#FFF;font-size:10px;font-weight:800;letter-spacing:1.5px;padding:3px 10px;text-transform:uppercase;">{label}</span>'
            f'<span style="background:{chip_bg};color:#FFF;font-size:9px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;">{chip_label} {int(conf)}</span>'
            f'</div>'
            f'<div style="padding:8px;">{diagram}</div>'
            f'<div style="padding:6px 10px;border-top:1px solid #F4F4F5;display:flex;justify-content:space-between;align-items:center;font-size:10px;">'
            f'<span style="color:#71717A;">{meta_joined}</span>'
            f'<span style="font-family:Menlo,Consolas,monospace;font-weight:800;color:#09090B;">{net:.0f} ft\u00b2</span>'
            f'</div>'
            f'</div>'
        )
    if not panels:
        return ""
    return (
        '<div style="page-break-before:always;">'
        '<h2>Per-elevation diagrams</h2>'
        '<div style="font-size:10px;color:#71717A;margin-bottom:8px;">'
        'Each wall drawn to scale with windows + doors placed proportionally. Net siding ft\u00b2 includes gable + dormer adds and subtracts brick/stone zones.'
        '</div>'
        + "".join(panels) +
        '</div>'
    )


def _build_wall_cards_section(
    walls: list[dict],
    photo_meta: list[dict],
    photo_urls: list[str],
    openings_schedule: list[dict],
) -> str:
    """Render the per-wall measurement cards page: 4-up grid where each
    card pairs the wall's matched photo with a tight measurement table."""
    if not walls:
        return ""
    # Map elevation → photo filename (first photo per elevation wins)
    elev_to_photo: dict[str, str] = {}
    for i, fname in enumerate(photo_urls or []):
        meta = next((p for p in (photo_meta or []) if int(p.get("index", -1)) == i), {})
        elev = (meta.get("elevation") or "").lower()
        if elev and elev not in elev_to_photo:
            elev_to_photo[elev] = fname

    # Tally openings per wall
    ops_by_wall: dict[str, dict] = {}
    for o in openings_schedule or []:
        elev = (o.get("elevation") or "other").lower()
        bucket = ops_by_wall.setdefault(elev, {"window": 0, "entry_door": 0, "patio_door": 0, "garage_door": 0})
        t = (o.get("type") or "").lower()
        if t in bucket:
            bucket[t] += int(o.get("count") or 1)

    cards = []
    for w in walls:
        label = (w.get("label") or "other").lower()
        accent, soft = _wall_label_color(label)
        width_ft = float(w.get("width_ft") or 0)
        eave_ft = float(w.get("height_ft") or 0)
        gable_ft = float(w.get("gable_triangle_height_ft") or 0)
        dormer_sf = float(w.get("dormer_face_sqft") or 0)
        pct = float(w.get("siding_pct_this_wall") or 100)
        if 0 < pct < 1:
            pct = pct * 100
        pct = max(0, min(100, pct))
        net = _net_siding_sqft(w)
        gross = width_ft * eave_ft
        conf = float(w.get("confidence") or 0)
        chip_bg, chip_label = _conf_chip_color(conf)
        ops = ops_by_wall.get(label, {})
        window_count = ops.get("window", 0)
        door_count = ops.get("entry_door", 0) + ops.get("patio_door", 0) + ops.get("garage_door", 0)
        if width_ft <= 0 and eave_ft <= 0:
            continue

        # Photo inset (optional)
        photo_html = (
            '<div style="width:42%;background:#F4F4F5;display:flex;align-items:center;'
            'justify-content:center;color:#A1A1AA;font-size:9px;">No photo</div>'
        )
        photo_fname = elev_to_photo.get(label)
        if photo_fname:
            data_uri = _img_to_data_uri(photo_fname)
            if data_uri:
                photo_html = (
                    f'<div style="width:42%;position:relative;">'
                    f'<img src="{data_uri}" style="width:100%;height:100%;object-fit:cover;display:block;" />'
                    f'<div style="position:absolute;top:4px;left:4px;background:{accent};color:#FFF;'
                    f'font-size:8px;font-weight:800;letter-spacing:1px;padding:2px 6px;">{label.upper()}</div>'
                    f'</div>'
                )

        # Measurement rows
        rows = [
            ("Width", _ft_in_label(width_ft)),
            ("Eave height", _ft_in_label(eave_ft)),
        ]
        if gable_ft > 0:
            rows.append(("Gable", f'{_ft_in_label(gable_ft)} \u00b7 {0.5*width_ft*gable_ft:.0f} ft\u00b2'))
        if dormer_sf > 0:
            rows.append(("Dormer face", f'{dormer_sf:.0f} ft\u00b2'))
        rows.append(("Gross wall", f'{gross:.0f} ft\u00b2'))
        if pct < 100:
            rows.append(("Siding coverage", f'{pct:.0f}%'))
        if window_count:
            rows.append(("Windows", f'\u00d7{window_count}'))
        if door_count:
            rows.append(("Doors", f'\u00d7{door_count}'))

        rows_html = "".join(
            f'<tr><td style="padding:3px 8px;font-size:9px;color:#71717A;text-transform:uppercase;letter-spacing:0.5px;">{k}</td>'
            f'<td style="padding:3px 8px;font-family:Menlo,Consolas,monospace;font-size:10px;font-weight:700;text-align:right;">{v}</td></tr>'
            for k, v in rows
        )
        reason = (w.get("confidence_reasoning") or "").strip()
        reason_html = (
            f'<div style="padding:4px 8px;font-size:8px;color:#71717A;font-style:italic;border-top:1px dashed #E4E4E7;line-height:1.3;">'
            f'{reason[:140]}</div>'
        ) if reason else ""

        cards.append(
            f'<div style="width:48%;display:inline-block;vertical-align:top;margin:0 1% 12px 1%;'
            f'border:2px solid {accent};background:#FFFFFF;height:200px;overflow:hidden;">'
            f'<div style="display:flex;height:100%;">'
            + photo_html +
            f'<div style="width:58%;display:flex;flex-direction:column;">'
            f'<div style="background:{soft};border-bottom:1px solid {accent};padding:5px 8px;display:flex;justify-content:space-between;align-items:center;">'
            f'<span style="font-size:10px;font-weight:800;color:{accent};text-transform:uppercase;letter-spacing:1.5px;">{label}</span>'
            f'<span style="background:{chip_bg};color:#FFF;font-size:8px;font-weight:700;padding:2px 5px;letter-spacing:0.5px;">{chip_label} {int(conf)}</span>'
            f'</div>'
            f'<table style="width:100%;border-collapse:collapse;">{rows_html}</table>'
            f'<div style="margin-top:auto;background:#09090B;color:#FFF;padding:5px 8px;display:flex;justify-content:space-between;align-items:center;">'
            f'<span style="font-size:8px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:#FAFAFA;">Net siding</span>'
            f'<span style="font-family:Menlo,Consolas,monospace;font-weight:800;font-size:13px;">{net:.0f} ft\u00b2</span>'
            f'</div>'
            + reason_html +
            '</div></div></div>'
        )
    if not cards:
        return ""
    return (
        '<div style="page-break-before:always;">'
        '<h2>Per-wall summary cards</h2>'
        '<div style="font-size:10px;color:#71717A;margin-bottom:8px;">'
        'Photo + measurements + confidence at-a-glance, one card per elevation. Border color = elevation. Footer ribbon = net siding ft\u00b2 after gable + dormer adds.'
        '</div>'
        + "".join(cards) +
        '</div>'
    )


def _build_html(
    *,
    address: str,
    estimate_number: str,
    customer_name: str,
    company_name: str,
    company_logo_url: str | None,
    photo_urls: list[str],
    photo_meta: list[dict],   # [{index, elevation, elevation_confidence, ...}]
    walls: list[dict],
    measurements: dict,
    openings_schedule: list[dict],
    missing_elevations: list[str],
    double_count_check: str,
    notes: str,
) -> str:
    # --- summary tiles ---------------------------------------------------
    m = measurements or {}
    tiles = [
        ("Siding", f"{int(round(float(m.get('siding_sqft') or 0))):,} ft²"),
        ("Eaves", f"{int(round(float(m.get('eaves_lf') or 0))):,} LF"),
        ("Rakes", f"{int(round(float(m.get('rakes_lf') or 0))):,} LF"),
        ("Openings", f"{int(m.get('opening_count') or 0)}"),
        ("Story count", str(m.get('_ai_story_count') or '—')),
        ("Avg wall ht", f"{m.get('_ai_avg_wall_height_ft') or '—'} ft"),
    ]

    tiles_html = "".join(
        f'<div style="border:1px solid #E4E4E7;padding:8px 10px;">'
        f'<div style="font-size:8px;color:#71717A;text-transform:uppercase;letter-spacing:1px;font-weight:700;">{label}</div>'
        f'<div style="font-family:Menlo,Consolas,monospace;font-weight:700;font-size:16px;color:#09090B;margin-top:2px;">{value}</div>'
        f"</div>"
        for label, value in tiles
    )

    # --- wall table with confidence chips --------------------------------
    wall_rows = []
    for w in walls:
        width = float(w.get("width_ft") or 0)
        eave = float(w.get("height_ft") or 0)
        gable = float(w.get("gable_triangle_height_ft") or 0)
        dormer = float(w.get("dormer_face_sqft") or 0)
        pct = float(w.get("siding_pct_this_wall") or 100)
        # match aggregator clamp logic
        if 0 < pct < 1:
            pct = pct * 100
        pct = max(0, min(100, pct))
        siding = (width * eave) * (pct / 100.0) + 0.5 * width * gable + dormer
        conf = float(w.get("confidence") or 0)
        chip_bg, chip_label = _conf_chip_color(conf)
        chip_html = (
            f'<span style="display:inline-block;background:{chip_bg};color:#FFF;'
            f'padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:0.5px;'
            f'border-radius:2px;">{chip_label} {int(conf)}</span>'
        )
        reason = (w.get("confidence_reasoning") or "").strip()
        wall_rows.append(
            f"<tr>"
            f'<td style="padding:6px 8px;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;color:#52525B;">{(w.get("label") or "—")}</td>'
            f'<td style="padding:6px 8px;font-family:Menlo,monospace;text-align:right;">{width:.1f}</td>'
            f'<td style="padding:6px 8px;font-family:Menlo,monospace;text-align:right;">{eave:.1f}</td>'
            f'<td style="padding:6px 8px;font-family:Menlo,monospace;text-align:right;">{(0.5*width*gable):.0f}</td>'
            f'<td style="padding:6px 8px;font-family:Menlo,monospace;text-align:right;">{dormer:.0f}</td>'
            f'<td style="padding:6px 8px;font-family:Menlo,monospace;text-align:right;font-weight:700;">{siding:.0f}</td>'
            f'<td style="padding:6px 8px;text-align:center;">{chip_html}<div style="font-size:9px;color:#71717A;margin-top:2px;">{reason[:80]}</div></td>'
            f"</tr>"
        )
    wall_table_html = "".join(wall_rows) or '<tr><td colspan="7" style="padding:12px;text-align:center;color:#A1A1AA;">No walls measured</td></tr>'

    # --- openings schedule (grouped by elevation, color-coded) --------
    # Mirrors the on-screen Option B layout: one colored header bar per
    # elevation with total count, then indented rows showing size + count.
    ELEV_COLORS = {
        "front": ("#3B82F6", "#EFF6FF"),
        "back":  ("#16A34A", "#F0FDF4"),
        "left":  ("#EA580C", "#FFF7ED"),
        "right": ("#7C3AED", "#FAF5FF"),
        "other": ("#52525B", "#FAFAFA"),
    }
    ELEV_ORDER = ["front", "back", "left", "right", "other"]
    groups: dict[str, list[dict]] = {}
    for o in openings_schedule or []:
        elev = (o.get("elevation") or "other").lower()
        if elev not in ELEV_COLORS:
            elev = "other"
        groups.setdefault(elev, []).append(o)
    grouped_blocks = []
    for elev in ELEV_ORDER:
        items = groups.get(elev) or []
        if not items:
            continue
        bg, soft = ELEV_COLORS[elev]
        total_count = sum(int(o.get("count") or 0) for o in items)
        rows = []
        for o in items:
            size_label = o.get("size_label")
            if not size_label:
                wi = int(float(o.get("width_in") or 0))
                hi = int(float(o.get("height_in") or 0))
                size_label = f"{wi}×{hi} in"
            otype = (o.get("type") or "—").replace("_", " ")
            style = (o.get("style") or "").strip()
            if style and otype == "window":
                style_cell = f'<span style="color:#7C3AED;font-weight:700;">{style}</span>'
            else:
                style_cell = '<span style="color:#A1A1AA;">—</span>'
            rows.append(
                f'<tr>'
                f'<td style="padding:4px 8px 4px 24px;text-transform:capitalize;color:#52525B;width:22%;">{otype}</td>'
                f'<td style="padding:4px 8px;font-family:Menlo,monospace;color:#27272A;width:20%;">{size_label}</td>'
                f'<td style="padding:4px 8px;font-size:11px;width:45%;">{style_cell}</td>'
                f'<td style="padding:4px 8px;font-family:Menlo,monospace;font-weight:700;text-align:right;">×{int(o.get("count") or 0)}</td>'
                f'</tr>'
            )
        grouped_blocks.append(
            f'<div style="margin-bottom:6px;">'
            f'<div style="background:{soft};border-left:4px solid {bg};padding:4px 8px;display:flex;align-items:center;gap:8px;">'
            f'<span style="background:{bg};color:#FFF;font-size:9px;font-weight:700;letter-spacing:1px;padding:2px 8px;text-transform:uppercase;">{elev}</span>'
            f'<span style="font-size:11px;font-weight:700;color:{bg};">{total_count} opening{"s" if total_count != 1 else ""}</span>'
            f'</div>'
            f'<table style="width:100%;border-collapse:collapse;font-size:11px;">'
            f'<tbody>{"".join(rows)}</tbody>'
            f'</table>'
            f'</div>'
        )
    sched_html = "".join(grouped_blocks) or '<div style="padding:12px;text-align:center;color:#A1A1AA;font-size:11px;">No openings detected</div>'

    # --- photo strip -----------------------------------------------------
    photo_cells = []
    for i, fname in enumerate(photo_urls or []):
        data_uri = _img_to_data_uri(fname)
        if not data_uri:
            continue
        meta = next((p for p in (photo_meta or []) if int(p.get("index", -1)) == i), {})
        elev = (meta.get("elevation") or "untagged").upper()
        ec = int(float(meta.get("elevation_confidence") or 0))
        chip_bg, _ = _conf_chip_color(ec)
        ec_chip = ""
        if ec:
            ec_chip = (
                f'<div style="position:absolute;bottom:4px;right:4px;'
                f'background:{chip_bg};color:#FFF;font-size:9px;font-weight:700;'
                f'padding:2px 6px;letter-spacing:0.5px;">{ec}%</div>'
            )
        photo_cells.append(
            f'<div style="width:48%;display:inline-block;vertical-align:top;margin:0 1% 12px 1%;">'
            f'<div style="position:relative;">'
            f'<img src="{data_uri}" style="width:100%;height:auto;display:block;border:1px solid #E4E4E7;" />'
            f'<div style="position:absolute;top:4px;left:4px;background:#7C3AED;color:#FFF;font-size:9px;font-weight:700;padding:2px 6px;letter-spacing:0.5px;">{elev}</div>'
            f"{ec_chip}"
            f"</div></div>"
        )
    photos_html = "".join(photo_cells) or '<div style="padding:24px;text-align:center;color:#A1A1AA;">No photos saved on session</div>'

    # --- branding header -------------------------------------------------
    logo_html = ""
    if company_logo_url:
        # Try to inline the company logo too (lives under UPLOAD_DIR or
        # under /api/uploads/<file>)
        if company_logo_url.startswith("/api/uploads/"):
            fname = company_logo_url.rsplit("/", 1)[-1]
            data_uri = _img_to_data_uri(fname)
            if data_uri:
                logo_html = f'<img src="{data_uri}" style="height:48px;" />'

    missing_html = ""
    if missing_elevations:
        missing_html = (
            f'<div style="background:#FEF3C7;border:1px solid #F59E0B;padding:8px 10px;margin:12px 0;font-size:11px;">'
            f"<strong>⚠ Heads-up:</strong> Claude couldn't see these elevations — "
            f"add photos to capture them: {', '.join(missing_elevations)}.</div>"
        )

    # Iter 57m — per-elevation 2D diagrams + per-wall cards (HOVER-style)
    wall_diagrams_html = _build_wall_diagrams_section(walls, openings_schedule or [])
    wall_cards_html = _build_wall_cards_section(
        walls, photo_meta or [], photo_urls or [], openings_schedule or [],
    )

    return f"""
<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  @page {{ size: Letter; margin: 0.4in; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#09090B; font-size:12px; line-height:1.4; }}
  h1 {{ font-size:22px; margin:0 0 4px 0; font-weight:800; letter-spacing:-0.5px; }}
  h2 {{ font-size:11px; text-transform:uppercase; letter-spacing:1.5px; color:#71717A; margin:18px 0 8px 0; font-weight:700; border-bottom:2px solid #09090B; padding-bottom:4px; }}
  table {{ width:100%; border-collapse:collapse; }}
  th {{ text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#A1A1AA; padding:6px 8px; border-bottom:1px solid #09090B; font-weight:700; }}
  td {{ border-bottom:1px solid #F4F4F5; font-size:11px; }}
  .grid-tiles {{ display:grid; grid-template-columns:repeat(6,1fr); gap:6px; }}
</style></head>
<body>
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #09090B;padding-bottom:10px;">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#71717A;font-weight:700;">AI Measurement Report</div>
      <h1>{(customer_name or "Untitled")} · {estimate_number}</h1>
      <div style="font-size:11px;color:#52525B;">{address or "Address not set"}</div>
    </div>
    <div style="text-align:right;">{logo_html}<div style="font-size:9px;color:#71717A;margin-top:4px;">{company_name}</div></div>
  </div>

  <h2>Summary</h2>
  <div class="grid-tiles">{tiles_html}</div>

  {missing_html}

  <h2>Per-wall breakdown · confidence chips</h2>
  <table>
    <thead><tr>
      <th>Wall</th>
      <th style="text-align:right;">W (ft)</th>
      <th style="text-align:right;">H eave (ft)</th>
      <th style="text-align:right;">Gable ft²</th>
      <th style="text-align:right;">Dormer ft²</th>
      <th style="text-align:right;">Siding ft²</th>
      <th style="text-align:center;">Confidence · why</th>
    </tr></thead>
    <tbody>{wall_table_html}</tbody>
  </table>

  {wall_diagrams_html}

  {wall_cards_html}

  <h2>Openings schedule</h2>
  <div>{sched_html}</div>

  <h2>Photos</h2>
  <div>{photos_html}</div>

  {f'<h2>Cross-reference check</h2><div style="font-size:11px;color:#52525B;font-style:italic;border-left:3px solid #7C3AED;padding-left:8px;">{double_count_check}</div>' if double_count_check else ""}
  {f'<h2>Notes</h2><div style="font-size:11px;color:#52525B;font-style:italic;border-left:3px solid #7C3AED;padding-left:8px;">{notes}</div>' if notes else ""}

  <div style="margin-top:18px;padding-top:8px;border-top:1px solid #E4E4E7;font-size:9px;color:#A1A1AA;text-align:center;">
    Generated by Claude Opus 4.5 vision · AI photo measurement is an estimate, not a survey · Verify in field before ordering.
  </div>
</body></html>
"""


@router.post("/report-pdf")
async def measurement_report_pdf(
    body: ReportRequest, user: dict = Depends(get_current_user)
):
    company_id = user.get("company_id")
    estimate = await db.estimates.find_one(
        {"id": body.estimate_id, "company_id": company_id}, {"_id": 0}
    )
    if not estimate:
        raise HTTPException(status_code=404, detail="Estimate not found")
    session = await db.ai_measure_sessions.find_one(
        {"estimate_id": body.estimate_id, "company_id": company_id}, {"_id": 0}
    )
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No AI Measure session yet — run AI Measure first, then download the report",
        )

    preview = session.get("preview") or {}
    measurements = preview.get("measurements") or {}
    raw_ai = preview.get("raw_ai") or {}
    photo_urls = session.get("photo_urls") or []

    branding = await get_branding()
    customer = estimate.get("customer") or {}

    html = _build_html(
        address=estimate.get("address") or customer.get("address") or "",
        estimate_number=estimate.get("number") or estimate.get("id", "")[:8],
        customer_name=customer.get("name") or "",
        company_name=branding.get("supplier_name") or "Pro-Quote Estimating Tool",
        company_logo_url=branding.get("supplier_logo_url"),
        photo_urls=photo_urls,
        photo_meta=measurements.get("_ai_photos") or raw_ai.get("photos") or [],
        walls=raw_ai.get("walls") or [],
        measurements=measurements,
        openings_schedule=measurements.get("_ai_openings_schedule") or raw_ai.get("openings_schedule") or [],
        missing_elevations=measurements.get("_ai_missing_elevations") or raw_ai.get("missing_elevations") or [],
        double_count_check=measurements.get("_ai_double_count_check") or raw_ai.get("double_count_check") or "",
        notes=measurements.get("_ai_notes") or "",
    )
    pdf_bytes = render_pdf(html)
    filename = safe_filename(estimate.get("number"), (customer.get("name") or "").strip())
    filename = filename.rsplit(".pdf", 1)[0] + "-measurement.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
