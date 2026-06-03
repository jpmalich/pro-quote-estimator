"""Seed data for the 4 price tiers from Alside's Vinyl Siding price sheet (Pittsburgh).
Material prices vary per tier; labor defaults are the same across all tiers (contractor-editable).

Tiers (cheapest → most expensive):
  - one-opp        (highest discount, top-tier accounts)
  - Builder-Dealer (builder direct accounts)
  - Contractor     (standard volume contractors)
  - whole-sale     (small / new accounts)
"""

# Section structure shared across all tiers (order + section titles)
# Descriptions match Alside's "Vinyl Siding price page.xls" verbatim.
# Single exception: the Excel has two distinct products both called
# "Inside Corners" (one in Ascend Cladding, one in Siding Accessories).
# Since our lookup tables (AMI #s, overrides) are keyed by name, we
# disambiguate the Siding Accessories one internally as
# "Inside Corners (Siding)" — but display it as "Inside Corners" in the UI.
SECTION_LAYOUT = [
    ("Vinyl Siding", False, [
        # Conquest (.040) — 2 profiles
        'Conquest Clap 4.5" .040',
        'Conquest Dutch lap 4.5" .040',
        # Coventry (.042) — 4 profiles
        'Coventry Clap 4" .042',
        'Coventry Dutch lap 4" .042',
        'Coventry Clap 5" .042',
        'Coventry Dutch lap 5" .042',
        # Odyssey (.044) — 4 profiles
        'Odyssey Clap 4" .044',
        'Odyssey Dutch Lap 4" .044',
        'Odyssey Clap 5" .044',
        'Odyssey Dutch Lap 5" .044',
        # Charter Oak (.046) — 2 profiles
        'Charter Oak Clap 4.5" .046',
        'Charter Oak Dutch Lap 4.5" .046',
        # Vertical / accent profiles
        'vertical board and batten 7"',
        "Architectural color upcharge Vinyl",
        'Pelican Bay Shakes 9"',
    ]),
    ("Ascend Cladding", True, [
        'Ascend Composite Lap Siding 7"',
        'Ascend Composite B&B 12" (add 30% Waste)',
    ]),
    ("Ascend Cladding/Accessories", True, [
        'Ascend 3.5" Outside Corner  - MATTE', 'Ascend 5.5" Outside Corner  - MATTE',
        "Inside Corners", "Ascend - 5.5\" Trim  (16' length)",
        "Ascend - J - Channel  (2 per Sq of siding)",
        "ASCEND Finish Trim", "Ascend - Starter",
    ]),
    # -----------------------------------------------------------------------
    # LP SmartSide product line — single-price (same across all 4 tiers,
    # set by Howard's "LP Smart siding" tab in the Excel price sheet).
    # Items are prefixed with "LP " to avoid collisions with Vinyl/Ascend
    # items of similar names (e.g. "Outside corners" exists in both
    # Siding Accessories and LP Siding Accessories with different sizes).
    # Placed right after Ascend so the LP-only sections appear at the TOP of
    # the LP tab in the editor (above the shared Tear-Off/Gutter/Misc
    # sections that LP also uses).
    # -----------------------------------------------------------------------
    ("LP Smart Siding", False, [
        'LP Strand Lap Siding 3/8" x 8" x 16\'',
        'LP Strand Shake 3/8" x 12" x 4\'',
        'LP Nickel Gap 1/2" x 8" x 16\'',
        'LP Strand Panel 3/8" x 4\' x 8\'',
        'LP Strand Panel 3/8" x 4\' x 10\'',
        'LP Strand Panel 3/8" x 16" x 16\'',
    ]),
    ("LP SmartSide Trim", False, [
        # 190 series — 4/4 thick
        'LP 190 Trim 5/8" x 3" x 16\'',
        # 440 series — 4/4 thick
        'LP 440 Trim 3/4" x 4" x 16\'',
        'LP 440 Trim 3/4" x 6" x 16\'',
        'LP 440 Trim 3/4" x 8" x 16\'',
        'LP 440 Trim 3/4" x 10" x 16\'',
        'LP 440 Trim 3/4" x 12" x 16\'',
        # 540 series — 5/4 thick
        'LP 540 Trim 3/4" x 4" x 16\'',
        'LP 540 Trim 3/4" x 6" x 16\'',
        'LP 540 Trim 3/4" x 8" x 16\'',
        'LP 540 Trim 3/4" x 10" x 16\'',
        'LP 540 Trim 3/4" x 12" x 16\'',
    ]),
    ("LP Siding Accessories", False, [
        "LP Color Match Coil",
        'LP Outside corners 4" x 16\'',
        'LP Outside corners 6" x 16\'',
        "LP Touch-up Kit",
        "LP Caulking Color Match",
        'LP J-blocks 1" W/FLASHING',
        'LP Mini Split 1" W/FLASHING',
    ]),
    ("LP SmartSide Soffit", False, [
        'LP Soffit 3/8" x 16" x 16\' Vented',
        'LP Soffit 3/8" x 24" x 16\' Vented',
        'LP Soffit 3/8" x 24" x 16\' Solid',
    ]),
    ("Siding Accessories", False, [
        ".019 Coil (1 per 5 Sq Siding)",
        "PVC Trim Coil (1 per 5 Sq Siding)",
        "Performance G8 Trim Coil (1 per 5 Sq Siding)",
        "Outside corners", "Inside Corners (Siding)",
        '3/4" J-Channel (2 per Sq of siding)', '1/2" J-Channel (2 per Sq of siding)',
        "Finish Trim", "Starter", "House Wrap", "RainDrop", '3/8" Fan Fold',
        '2" Nails 30 lbs (1 per 15 Sq)', "Caulking (per color)",
        "J-blocks, Dryer vents", "Shutters (louvered, raised panel) standard sizes",
        "Gable vents (round,octagon)", '1 1/4" Trim Nails',
    ]),
    ("Tear-Off / Clean Up", False, [
        "Tear-Off", "Wood shake tear off (requires a dumpster)",
        "clean up/ haul away job debris", "Dumpster",
    ]),
    ("Vinyl Soffit with Siding", False, [
        'Soffit & fascia up to 13" wide Charter Oak',
        'Soffit & fascia up to 13" wide Greenbriar',
        'Soffit & fascia up to 13" T2',
        'Soffit & fascia up to 13"-30" wide Charter Oak',
        'Soffit & fascia up to 13"-30" wide Greenbriar',
        'Soffit & fascia up to 13"-30" T2',
        '3/4" Soffit J-Channel (Charter Oak)', '1/2" Soffit J-Channel (for T2 Soffit)',
        'Fascia/rake or frieze up to 8" coverage', "Cap porch band",
        ".019 Coil (1 per 50' fascia)",
        "PVC Trim Coil (1 per 50' fascia)",
        "Performance G8 Trim Coil (1 per 50' fascia)",
    ]),
    ("Porch Ceiling", False, [
        "With or without siding Charter Oak", "Wrap porch beam",
    ]),
    ("Seamless Gutter", False, [
        'Gutter 6"', 'Downspout 6"', "elbow", "Mitre", "Gutter Guard (USA Shurflo)",
    ]),
    ("Misc. Labor Only", False, ["R&R gutter", "R&R downspout"]),
    ("Misc. Labor & Material", False, [
        "Cap window", "Cap windows with wide crown", "Capping general",
        "Cap window headers only", "Cap entry door", "Cap patio door",
        "Cap single garage door", "Build out for windows w/furring (includes capping)",
        "R&R Gable louvers", "Fascia Return", "Bird box", "Flashing",
    ]),
    ("Misc.", False, [
        "Cap tops of bird boxes", "Dormer upcharge", "R&R Utilities",
        "Cut out 4x4 section of wall and insulate",
    ]),
    # -----------------------------------------------------------------------
    # WINDOWS — Vero product line from Howard's "window price sheet" tab.
    # Scoped to the dedicated "windows" tab. Prices currently same across
    # all 4 tiers (Howard will tier them later). The 3× duplicate "3 lite
    # slider / Casement / Picture" rows at $0 in the source spreadsheet
    # collapse to one each since they're size placeholders; the second
    # UPGRADE OPTIONS block (rows 36-40) is omitted (identical to rows 14-18).
    # -----------------------------------------------------------------------
    ("Vero Windows", False, [
        "Vero - Double Hung 0-101 UI",
        "Vero - Slider 0-101 UI",
        "Vero - 3 lite slider 0-101 UI",
        "Vero - Casement 0-101 UI",
        "Vero - Picture 0-101 UI",
        "Window Package Price",
    ]),
    ("Window Upgrade Options", False, [
        "Climatech TG2 Triple Pane .19 U Factor 2 coats LoE",
        "Sentry System - Tilt Lock upgrade",
        "Integral Nail Fin 0-101",
        "Heavy Duty 1/2 Screen White ONLY",
    ]),
    ("Window Installation", False, [
        "Window - Pocket Install",
        "Window - Full Fin Replacement",
        "Window - Block Frame Replacement",
        "Large Window - adder for windows 30 sq-ft or larger",
        "Field Mull Assembly and/or Field Glaze (adder per each opening)",
        "Lead Safe Installation Practices For Window Installation",
        "Lead Safe - Test Fee (all homes 1978 and older are tested)",
        # Renamed from "New Exterior Coil Trim" in Iter 30 — matches the
        # "Cap window" line on the siding tabs (same $20 labor); "(Windows)"
        # suffix disambiguates from the siding Misc. Labor & Material row.
        "Cap window (Windows)",
    ]),
    ("Vero Sliding Glass Doors", False, [
        'Vero - Sliding glass door 60" x 80"',
        'Vero - Sliding glass door 72" x 80"',
        'Vero - Sliding glass door 96" x 80"',
        "Vero - Sliding glass door Custom Size",
    ]),
    ("Sliding Glass Door Install", False, [
        "Vinyl Sliding Glass Door (5' & 6' width)",
        "Vinyl Sliding Glass Door (8' width or field assembled)",
        "Oversize Vinyl Door (greater than 8' width)",
    ]),
    ("Window Exterior Trim Work", False, [
        "New Exterior Primed Stops or Snap Trim",
        "New Exterior Primed Wood Trim",
        "New Exterior Composite Trim",
    ]),
    ("Window Interior Trim Work", False, [
        "New Interior Stops or Flat Trim",
        "New Interior Casing",
        "New Interior Jamb Extension",
        "New Interior Sill - create or replace (QUOTE ONLY)",
    ]),
    ("Window Misc.", False, [
        "Interior Blinds - Remove For Window Install & Reinstall",
        "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)",
        "Mullion Removal & Cut-Out of Non-Structural Framing Members",
        "Storm Window Removal",
        "Second/Third/Clear Story Fee",
        "Job Measure Standard Fee 4 days+",
        "Job Measure Rush Fee 3 days or less",
        "Add New Channel on ALL, Close up opening to match master Front opening",
        "Minimum Job Charge For Window Installs",
        "Disposal Fee (Windows)",
    ]),
]

# Units & default labor are the same across tiers (labor defaults — contractor can override)
ITEM_META = {
    # name: (unit, lab_default)
    # All siding profiles use SQ unit and $125/SQ default labor.
    'Conquest Clap 4.5" .040': ("SQ", 125),
    'Conquest Dutch lap 4.5" .040': ("SQ", 125),
    'Coventry Clap 4" .042': ("SQ", 125),
    'Coventry Dutch lap 4" .042': ("SQ", 125),
    'Coventry Clap 5" .042': ("SQ", 125),
    'Coventry Dutch lap 5" .042': ("SQ", 125),
    'Odyssey Clap 4" .044': ("SQ", 125),
    'Odyssey Dutch Lap 4" .044': ("SQ", 125),
    'Odyssey Clap 5" .044': ("SQ", 125),
    'Odyssey Dutch Lap 5" .044': ("SQ", 125),
    'Charter Oak Clap 4.5" .046': ("SQ", 125),
    'Charter Oak Dutch Lap 4.5" .046': ("SQ", 125),
    'vertical board and batten 7"': ("SQ", 125),
    "Architectural color upcharge Vinyl": ("SQ", 0), 'Pelican Bay Shakes 9"': ("SQ", 125),
    'Ascend Composite Lap Siding 7"': ("SQ", 150), 'Ascend Composite B&B 12" (add 30% Waste)': ("SQ", 150),
    'Ascend 3.5" Outside Corner  - MATTE': ("PCS", 0), 'Ascend 5.5" Outside Corner  - MATTE': ("PCS", 0),
    "Inside Corners": ("PCS", 0), "Ascend - 5.5\" Trim  (16' length)": ("PCS", 0),
    "Ascend - J - Channel  (2 per Sq of siding)": ("LF", 0),
    "ASCEND Finish Trim": ("LF", 0), "Ascend - Starter": ("LF", 0),
    ".019 Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    "PVC Trim Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    "Performance G8 Trim Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    "Outside corners": ("PCS", 0), "Inside Corners (Siding)": ("PCS", 0),
    '3/4" J-Channel (2 per Sq of siding)': ("PCS", 0), '1/2" J-Channel (2 per Sq of siding)': ("PCS", 0),
    "Finish Trim": ("LF", 0), "Starter": ("LF", 0),
    "House Wrap": ("SQ", 2.5), "RainDrop": ("SQ", 2.5), '3/8" Fan Fold': ("SQ", 5),
    '2" Nails 30 lbs (1 per 15 Sq)': ("JOB", 0), "Caulking (per color)": ("Each", 0),
    "J-blocks, Dryer vents": ("Each", 10),
    "Shutters (louvered, raised panel) standard sizes": ("PR", 20),
    "Gable vents (round,octagon)": ("Each", 10), '1 1/4" Trim Nails': ("Box", 0),
    "Tear-Off": ("SQ", 10), "Wood shake tear off (requires a dumpster)": ("SQ", 80.25),
    "clean up/ haul away job debris": ("JOB", 150), "Dumpster": ("Each", 550),
    'Soffit & fascia up to 13" wide Charter Oak': ("LF", 2.75),
    'Soffit & fascia up to 13" wide Greenbriar': ("LF", 2.75),
    'Soffit & fascia up to 13" T2': ("LF", 2.75),
    'Soffit & fascia up to 13"-30" wide Charter Oak': ("LF", 3.5),
    'Soffit & fascia up to 13"-30" wide Greenbriar': ("LF", 3.5),
    'Soffit & fascia up to 13"-30" T2': ("LF", 3.5),
    '3/4" Soffit J-Channel (Charter Oak)': ("LF", 0), '1/2" Soffit J-Channel (for T2 Soffit)': ("LF", 0),
    'Fascia/rake or frieze up to 8" coverage': ("LF", 1.25), "Cap porch band": ("LF", 1.25),
    ".019 Coil (1 per 50' fascia)": ("ROLL", 1.25),
    "PVC Trim Coil (1 per 50' fascia)": ("ROLL", 3),
    "Performance G8 Trim Coil (1 per 50' fascia)": ("ROLL", 0),
    "With or without siding Charter Oak": ("SQ FT", 1.25), "Wrap porch beam": ("LF", 3),
    'Gutter 6"': ("LF", 1.25), 'Downspout 6"': ("LF", 1),
    "elbow": ("Each", 1), "Mitre": ("Each", 12), "Gutter Guard (USA Shurflo)": ("LF", 0.5),
    "R&R gutter": ("LF", 1), "R&R downspout": ("LF", 0.75),
    "Cap window": ("Each", 20), "Cap windows with wide crown": ("Each", 30),
    "Capping general": ("LF", 1), "Cap window headers only": ("Each", 8),
    "Cap entry door": ("Each", 25), "Cap patio door": ("Each", 30),
    "Cap single garage door": ("Each", 40),
    "Build out for windows w/furring (includes capping)": ("Each", 50),
    "R&R Gable louvers": ("Each", 10), "Fascia Return": ("Each", 8),
    "Bird box": ("Each", 10), "Flashing": ("LF", 1),
    "Cap tops of bird boxes": ("Each", 1), "Dormer upcharge": ("Each", 100),
    "R&R Utilities": ("Each", 1), "Cut out 4x4 section of wall and insulate": ("Each", 50),
    # ----------------- LP SmartSide items -----------------
    # Units pulled verbatim from the LP Smart siding tab in Howard's
    # original Vinyl Siding app price layout.xls. Labor is 0 by default —
    # LP labor varies job-to-job and the contractor sets it per estimate.
    'LP Strand Lap Siding 3/8" x 8" x 16\'': ("SQ", 0),
    'LP Strand Shake 3/8" x 12" x 4\'': ("PCS", 0),
    'LP Nickel Gap 1/2" x 8" x 16\'': ("PCS", 0),
    'LP Strand Panel 3/8" x 4\' x 8\'': ("PCS", 0),
    'LP Strand Panel 3/8" x 4\' x 10\'': ("PCS", 0),
    'LP Strand Panel 3/8" x 16" x 16\'': ("PCS", 0),
    'LP 190 Trim 5/8" x 3" x 16\'': ("LF", 0),
    'LP 440 Trim 3/4" x 4" x 16\'': ("LF", 0),
    'LP 440 Trim 3/4" x 6" x 16\'': ("LF", 0),
    'LP 440 Trim 3/4" x 8" x 16\'': ("LF", 0),
    'LP 440 Trim 3/4" x 10" x 16\'': ("LF", 0),
    'LP 440 Trim 3/4" x 12" x 16\'': ("LF", 0),
    # Note: per Howard, all 540 (5/4) trim sizes are LF — converted from
    # the original per-piece pricing by dividing 16' board length.
    'LP 540 Trim 3/4" x 4" x 16\'': ("LF", 0),
    'LP 540 Trim 3/4" x 6" x 16\'': ("LF", 0),
    'LP 540 Trim 3/4" x 8" x 16\'': ("LF", 0),
    'LP 540 Trim 3/4" x 10" x 16\'': ("LF", 0),
    'LP 540 Trim 3/4" x 12" x 16\'': ("LF", 0),
    "LP Color Match Coil": ("ROLL", 0),
    'LP Outside corners 4" x 16\'': ("PCS", 0),
    'LP Outside corners 6" x 16\'': ("PCS", 0),
    "LP Touch-up Kit": ("PCS", 0),
    "LP Caulking Color Match": ("Tube", 0),
    'LP J-blocks 1" W/FLASHING': ("Each", 0),
    'LP Mini Split 1" W/FLASHING': ("Each", 0),
    'LP Soffit 3/8" x 16" x 16\' Vented': ("PCS", 0),
    'LP Soffit 3/8" x 24" x 16\' Vented': ("PCS", 0),
    'LP Soffit 3/8" x 24" x 16\' Solid': ("PCS", 0),
    # ----------------- Window items (Vero product line) -----------------
    # Units & labor defaults from Howard's "window price sheet". Where a
    # row has a non-zero labor value in the spreadsheet, that becomes the
    # default; contractors can still override per estimate. Materials live
    # in WINDOWS_PRICES → TIER_PRICES below.
    "Vero - Double Hung 0-101 UI": ("Each", 0),
    "Vero - Slider 0-101 UI": ("Each", 0),
    "Vero - 3 lite slider 0-101 UI": ("Each", 0),
    "Vero - Casement 0-101 UI": ("Each", 0),
    "Vero - Picture 0-101 UI": ("Each", 0),
    "Window Package Price": ("Each", 0),
    "Climatech TG2 Triple Pane .19 U Factor 2 coats LoE": ("Each", 0),
    "Sentry System - Tilt Lock upgrade": ("Each", 0),
    "Integral Nail Fin 0-101": ("Each", 0),
    "Heavy Duty 1/2 Screen White ONLY": ("Each", 0),
    "Window - Pocket Install": ("Each", 170),
    "Window - Full Fin Replacement": ("Each", 252.45),
    "Window - Block Frame Replacement": ("Each", 233.38),
    "Large Window - adder for windows 30 sq-ft or larger": ("Each", 76.92),
    "Field Mull Assembly and/or Field Glaze (adder per each opening)": ("Each", 53.85),
    "Lead Safe Installation Practices For Window Installation": ("Each", 53.85),
    "Lead Safe - Test Fee (all homes 1978 and older are tested)": ("Each", 0),
    'Vero - Sliding glass door 60" x 80"': ("Each", 0),
    'Vero - Sliding glass door 72" x 80"': ("Each", 0),
    'Vero - Sliding glass door 96" x 80"': ("Each", 0),
    "Vero - Sliding glass door Custom Size": ("Each", 0),
    "Vinyl Sliding Glass Door (5' & 6' width)": ("Each", 669.63),
    "Vinyl Sliding Glass Door (8' width or field assembled)": ("Each", 832.55),
    "Oversize Vinyl Door (greater than 8' width)": ("Each", 1099.42),
    "New Exterior Primed Stops or Snap Trim": ("Each", 49.65),
    "New Exterior Primed Wood Trim": ("Each", 71.04),
    "New Exterior Composite Trim": ("Each", 99.26),
    "New Exterior Coil Trim": ("Each", 75.0),
    "Cap window (Windows)": ("Each", 20),  # matches siding "Cap window"
    "New Interior Stops or Flat Trim": ("Each", 20.0),
    "New Interior Casing": ("Each", 77.62),
    "New Interior Jamb Extension": ("Each", 89.13),
    "New Interior Sill - create or replace (QUOTE ONLY)": ("Each", 120.0),
    "Interior Blinds - Remove For Window Install & Reinstall": ("Each", 53.85),
    "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)": ("Each", 38.46),
    "Mullion Removal & Cut-Out of Non-Structural Framing Members": ("Each", 23.08),
    "Storm Window Removal": ("Each", 23.08),
    "Second/Third/Clear Story Fee": ("Each", 1846.15),
    "Job Measure Standard Fee 4 days+": ("JOB", 150.0),
    "Job Measure Rush Fee 3 days or less": ("ADD", 80.77),
    "Add New Channel on ALL, Close up opening to match master Front opening": ("Each", 1200.0),
    "Minimum Job Charge For Window Installs": ("JOB", 769.23),
    "Disposal Fee (Windows)": ("JOB", 125.0),
}

# Material prices per tier (name → mat $)
TIER_PRICES = {
    "one-opp": {
        # Siding — each series has identical material price across its profiles
        'Conquest Clap 4.5" .040': 75.71, 'Conquest Dutch lap 4.5" .040': 75.71,
        'Coventry Clap 4" .042': 81.17, 'Coventry Dutch lap 4" .042': 81.17,
        'Coventry Clap 5" .042': 81.17, 'Coventry Dutch lap 5" .042': 81.17,
        'Odyssey Clap 4" .044': 100.11, 'Odyssey Dutch Lap 4" .044': 100.11,
        'Odyssey Clap 5" .044': 100.11, 'Odyssey Dutch Lap 5" .044': 100.11,
        'Charter Oak Clap 4.5" .046': 113.57, 'Charter Oak Dutch Lap 4.5" .046': 113.57,
        'vertical board and batten 7"': 113.57,
        "Architectural color upcharge Vinyl": 15, 'Pelican Bay Shakes 9"': 419.94,
        'Ascend Composite Lap Siding 7"': 309.64, 'Ascend Composite B&B 12" (add 30% Waste)': 366.96,
        'Ascend 3.5" Outside Corner  - MATTE': 40.42, 'Ascend 5.5" Outside Corner  - MATTE': 59.36,
        "Inside Corners": 11.83, "Ascend - 5.5\" Trim  (16' length)": 71.66,
        "Ascend - J - Channel  (2 per Sq of siding)": 10.4,
        "ASCEND Finish Trim": 7.86, "Ascend - Starter": 7.68,
        ".019 Coil (1 per 5 Sq Siding)": 133.23, "PVC Trim Coil (1 per 5 Sq Siding)": 149.74,
        "Performance G8 Trim Coil (1 per 5 Sq Siding)": 145.89,
        "Outside corners": 19.69, "Inside Corners (Siding)": 9.84,
        '3/4" J-Channel (2 per Sq of siding)': 4.55, '1/2" J-Channel (2 per Sq of siding)': 4.55,
        "Finish Trim": 0.45, "Starter": 0.45,
        "House Wrap": 11.55, "RainDrop": 30.73, '3/8" Fan Fold': 11.06,
        '2" Nails 30 lbs (1 per 15 Sq)': 81.63, "Caulking (per color)": 8.23,
        "J-blocks, Dryer vents": 13.49,
        "Shutters (louvered, raised panel) standard sizes": 114.2225,
        "Gable vents (round,octagon)": 92.2875, '1 1/4" Trim Nails': 9,
        "Tear-Off": 0, "Wood shake tear off (requires a dumpster)": 0,
        "Clean up / haul away job debris": 0, "Dumpster": 0,
        'Soffit & fascia up to 13" wide Charter Oak': 1.4,
        'Soffit & fascia up to 13" wide Greenbriar': 1.23,
        'Soffit & fascia up to 13" T2': 0.95,
        'Soffit & fascia up to 13"-30" wide Charter Oak': 2.8,
        'Soffit & fascia up to 13"-30" wide Greenbriar': 2.46,
        'Soffit & fascia up to 13"-30" T2': 1.9,
        '3/4" Soffit J-Channel (Charter Oak)': 0.46, '1/2" Soffit J-Channel (for T2 Soffit)': 0.46,
        'Fascia/rake or frieze up to 8" coverage': 2.66, "Cap porch band": 2.66,
        ".019 Coil (1 per 50' fascia)": 133.23,
        "PVC Trim Coil (1 per 50' fascia)": 149.74,
        "Performance G8 Trim Coil (1 per 50' fascia)": 145.89,
        "With or without siding Charter Oak": 1.4, "Wrap porch beam": 2.66,
        'Gutter 6"': 3.25, 'Downspout 6"': 2.8, "elbow": 2.69, "Mitre": 13.75,
        "Gutter Guard (USA Shurflo)": 2.25,
        "R&R gutter": 0, "R&R downspout": 0,
        "Cap window": 0, "Cap windows with wide crown": 65, "Capping general": 0,
        "Cap window headers only": 0, "Cap entry door": 0, "Cap patio door": 0,
        "Cap single garage door": 0, "Build out for windows w/furring (includes capping)": 0,
        "R&R Gable louvers": 0, "Fascia Return": 0, "Bird box": 0, "Flashing": 0,
        "Cap tops of bird boxes": 60, "Dormer upcharge": 0, "R&R Utilities": 0,
        "Cut out 4x4 section of wall and insulate": 100,
    },
    "Builder-Dealer": {
        'Conquest Clap 4.5" .040': 92.19, 'Conquest Dutch lap 4.5" .040': 92.19,
        'Coventry Clap 4" .042': 95.03, 'Coventry Dutch lap 4" .042': 95.03,
        'Coventry Clap 5" .042': 95.03, 'Coventry Dutch lap 5" .042': 95.03,
        'Odyssey Clap 4" .044': 116.22, 'Odyssey Dutch Lap 4" .044': 116.22,
        'Odyssey Clap 5" .044': 116.22, 'Odyssey Dutch Lap 5" .044': 116.22,
        'Charter Oak Clap 4.5" .046': 125.46, 'Charter Oak Dutch Lap 4.5" .046': 125.46,
        'vertical board and batten 7"': 136.56,
        "Architectural color upcharge Vinyl": 20, 'Pelican Bay Shakes 9"': 419.94,
        'Ascend Composite Lap Siding 7"': 332.6, 'Ascend Composite B&B 12" (add 30% Waste)': 408.66,
        'Ascend 3.5" Outside Corner  - MATTE': 40.42, 'Ascend 5.5" Outside Corner  - MATTE': 59.36,
        "Inside Corners": 11.83, "Ascend - 5.5\" Trim  (16' length)": 61.05,
        "Ascend - J - Channel  (2 per Sq of siding)": 10.4,
        "ASCEND Finish Trim": 7.86, "Ascend - Starter": 7.68,
        ".019 Coil (1 per 5 Sq Siding)": 161.33, "PVC Trim Coil (1 per 5 Sq Siding)": 167.08,
        "Performance G8 Trim Coil (1 per 5 Sq Siding)": 170.53,
        "Outside corners": 31.54, "Inside Corners (Siding)": 15.77,
        '3/4" J-Channel (2 per Sq of siding)': 11.52, '1/2" J-Channel (2 per Sq of siding)': 7.28,
        "Finish Trim": 7.28, "Starter": 0.45,
        "House Wrap": 11.55, "RainDrop": 30.73, '3/8" Fan Fold': 11.06,
        '2" Nails 30 lbs (1 per 15 Sq)': 81.63, "Caulking (per color)": 8.23,
        "J-blocks, Dryer vents": 13.49,
        "Shutters (louvered, raised panel) standard sizes": 114.2225,
        "Gable vents (round,octagon)": 92.2875, '1 1/4" Trim Nails': 9,
        "Tear-Off": 0, "Wood shake tear off (requires a dumpster)": 0,
        "Clean up / haul away job debris": 0, "Dumpster": 0,
        'Soffit & fascia up to 13" wide Charter Oak': 1.82,
        'Soffit & fascia up to 13" wide Greenbriar': 1.63,
        'Soffit & fascia up to 13" T2': 1.38,
        'Soffit & fascia up to 13"-30" wide Charter Oak': 3.64,
        'Soffit & fascia up to 13"-30" wide Greenbriar': 3.26,
        'Soffit & fascia up to 13"-30" T2': 2.76,
        '3/4" Soffit J-Channel (Charter Oak)': 0.53, '1/2" Soffit J-Channel (for T2 Soffit)': 0.53,
        'Fascia/rake or frieze up to 8" coverage': 0, "Cap porch band": 0,
        ".019 Coil (1 per 50' fascia)": 161.33,
        "PVC Trim Coil (1 per 50' fascia)": 167.08,
        "Performance G8 Trim Coil (1 per 50' fascia)": 170.53,
        "With or without siding Charter Oak": 1.82, "Wrap porch beam": 3.22,
        'Gutter 6"': 3.25, 'Downspout 6"': 2.8, "elbow": 2.69, "Mitre": 13.75,
        "Gutter Guard (USA Shurflo)": 2.25,
        "R&R gutter": 0, "R&R downspout": 0,
        "Cap window": 0, "Cap windows with wide crown": 65, "Capping general": 0,
        "Cap window headers only": 0, "Cap entry door": 0, "Cap patio door": 0,
        "Cap single garage door": 0, "Build out for windows w/furring (includes capping)": 0,
        "R&R Gable louvers": 0, "Fascia Return": 0, "Bird box": 0, "Flashing": 0,
        "Cap tops of bird boxes": 60, "Dormer upcharge": 0, "R&R Utilities": 0,
        "Cut out 4x4 section of wall and insulate": 100,
    },
    "Contractor": {
        'Conquest Clap 4.5" .040': 97.04, 'Conquest Dutch lap 4.5" .040': 97.04,
        'Coventry Clap 4" .042': 100.03, 'Coventry Dutch lap 4" .042': 100.03,
        'Coventry Clap 5" .042': 100.03, 'Coventry Dutch lap 5" .042': 100.03,
        'Odyssey Clap 4" .044': 116.22, 'Odyssey Dutch Lap 4" .044': 116.22,
        'Odyssey Clap 5" .044': 116.22, 'Odyssey Dutch Lap 5" .044': 116.22,
        'Charter Oak Clap 4.5" .046': 136.22, 'Charter Oak Dutch Lap 4.5" .046': 136.22,
        'vertical board and batten 7"': 143.74,
        "Architectural color upcharge Vinyl": 23, 'Pelican Bay Shakes 9"': 419.94,
        'Ascend Composite Lap Siding 7"': 332.6, 'Ascend Composite B&B 12" (add 30% Waste)': 408.66,
        'Ascend 3.5" Outside Corner  - MATTE': 40.42, 'Ascend 5.5" Outside Corner  - MATTE': 59.36,
        "Inside Corners": 11.83, "Ascend - 5.5\" Trim  (16' length)": 71.66,
        "Ascend - J - Channel  (2 per Sq of siding)": 10.4,
        "ASCEND Finish Trim": 7.86, "Ascend - Starter": 7.68,
        ".019 Coil (1 per 5 Sq Siding)": 161.33, "PVC Trim Coil (1 per 5 Sq Siding)": 167.08,
        "Performance G8 Trim Coil (1 per 5 Sq Siding)": 170.53,
        "Outside corners": 31.54, "Inside Corners (Siding)": 15.77,
        '3/4" J-Channel (2 per Sq of siding)': 11.52, '1/2" J-Channel (2 per Sq of siding)': 7.28,
        "Finish Trim": 7.28, "Starter": 0.45,
        "House Wrap": 11.55, "RainDrop": 30.73, '3/8" Fan Fold': 11.06,
        '2" Nails 30 lbs (1 per 15 Sq)': 81.63, "Caulking (per color)": 8.23,
        "J-blocks, Dryer vents": 13.49,
        "Shutters (louvered, raised panel) standard sizes": 114.2225,
        "Gable vents (round,octagon)": 92.2875, '1 1/4" Trim Nails': 9,
        "Tear-Off": 0, "Wood shake tear off (requires a dumpster)": 0,
        "Clean up / haul away job debris": 0, "Dumpster": 0,
        'Soffit & fascia up to 13" wide Charter Oak': 2.02,
        'Soffit & fascia up to 13" wide Greenbriar': 1.8,
        'Soffit & fascia up to 13" T2': 1.38,
        'Soffit & fascia up to 13"-30" wide Charter Oak': 3.64,
        'Soffit & fascia up to 13"-30" wide Greenbriar': 3.24,
        'Soffit & fascia up to 13"-30" T2': 2.76,
        '3/4" Soffit J-Channel (Charter Oak)': 1.15, '1/2" Soffit J-Channel (for T2 Soffit)': 0.72,
        'Fascia/rake or frieze up to 8" coverage': 2.94, "Cap porch band": 2.94,
        ".019 Coil (1 per 50' fascia)": 161.33,
        "PVC Trim Coil (1 per 50' fascia)": 167.08,
        "Performance G8 Trim Coil (1 per 50' fascia)": 170.53,
        "With or without siding Charter Oak": 2.02, "Wrap porch beam": 3.22,
        'Gutter 6"': 3.25, 'Downspout 6"': 2.8, "elbow": 2.69, "Mitre": 13.75,
        "Gutter Guard (USA Shurflo)": 2.25,
        "R&R gutter": 0, "R&R downspout": 0,
        "Cap window": 0, "Cap windows with wide crown": 65, "Capping general": 0,
        "Cap window headers only": 0, "Cap entry door": 0, "Cap patio door": 0,
        "Cap single garage door": 0, "Build out for windows w/furring (includes capping)": 0,
        "R&R Gable louvers": 0, "Fascia Return": 0, "Bird box": 0, "Flashing": 0,
        "Cap tops of bird boxes": 60, "Dormer upcharge": 0, "R&R Utilities": 0,
        "Cut out 4x4 section of wall and insulate": 100,
    },
    "whole-sale": {
        'Conquest Clap 4.5" .040': 102.15, 'Conquest Dutch lap 4.5" .040': 102.15,
        'Coventry Clap 4" .042': 105.30, 'Coventry Dutch lap 4" .042': 105.30,
        'Coventry Clap 5" .042': 105.30, 'Coventry Dutch lap 5" .042': 105.30,
        'Odyssey Clap 4" .044': 122.34, 'Odyssey Dutch Lap 4" .044': 122.34,
        'Odyssey Clap 5" .044': 122.34, 'Odyssey Dutch Lap 5" .044': 122.34,
        'Charter Oak Clap 4.5" .046': 151.31, 'Charter Oak Dutch Lap 4.5" .046': 151.31,
        'vertical board and batten 7"': 151.31,
        "Architectural color upcharge Vinyl": 23, 'Pelican Bay Shakes 9"': 419.94,
        'Ascend Composite Lap Siding 7"': 332.6, 'Ascend Composite B&B 12" (add 30% Waste)': 408.66,
        'Ascend 3.5" Outside Corner  - MATTE': 40.42, 'Ascend 5.5" Outside Corner  - MATTE': 59.36,
        "Inside Corners": 11.83, "Ascend - 5.5\" Trim  (16' length)": 71.66,
        "Ascend - J - Channel  (2 per Sq of siding)": 10.4,
        "ASCEND Finish Trim": 7.86, "Ascend - Starter": 7.68,
        ".019 Coil (1 per 5 Sq Siding)": 161.33, "PVC Trim Coil (1 per 5 Sq Siding)": 167.08,
        "Performance G8 Trim Coil (1 per 5 Sq Siding)": 170.53,
        "Outside corners": 25.81, "Inside Corners (Siding)": 12.9,
        '3/4" J-Channel (2 per Sq of siding)': 5.23, '1/2" J-Channel (2 per Sq of siding)': 5.23,
        "Finish Trim": 5.95, "Starter": 0.45,
        "House Wrap": 11.55, "RainDrop": 30.73, '3/8" Fan Fold': 11.06,
        '2" Nails 30 lbs (1 per 15 Sq)': 81.63, "Caulking (per color)": 8.23,
        "J-blocks, Dryer vents": 13.49,
        "Shutters (louvered, raised panel) standard sizes": 114.2225,
        "Gable vents (round,octagon)": 92.2875, '1 1/4" Trim Nails': 9,
        "Tear-Off": 0, "Wood shake tear off (requires a dumpster)": 0,
        "Clean up / haul away job debris": 0, "Dumpster": 0,
        'Soffit & fascia up to 13" wide Charter Oak': 2.02,
        'Soffit & fascia up to 13" wide Greenbriar': 1.8,
        'Soffit & fascia up to 13" T2': 1.38,
        'Soffit & fascia up to 13"-30" wide Charter Oak': 3.64,
        'Soffit & fascia up to 13"-30" wide Greenbriar': 3.24,
        'Soffit & fascia up to 13"-30" T2': 2.76,
        '3/4" Soffit J-Channel (Charter Oak)': 1.15, '1/2" Soffit J-Channel (for T2 Soffit)': 0.72,
        'Fascia/rake or frieze up to 8" coverage': 2.94, "Cap porch band": 2.94,
        ".019 Coil (1 per 50' fascia)": 161.33,
        "PVC Trim Coil (1 per 50' fascia)": 167.08,
        "Performance G8 Trim Coil (1 per 50' fascia)": 170.53,
        "With or without siding Charter Oak": 2.02, "Wrap porch beam": 3.22,
        'Gutter 6"': 3.25, 'Downspout 6"': 2.8, "elbow": 2.69, "Mitre": 13.75,
        "Gutter Guard (USA Shurflo)": 2.25,
        "R&R gutter": 0, "R&R downspout": 0,
        "Cap window": 0, "Cap windows with wide crown": 65, "Capping general": 0,
        "Cap window headers only": 0, "Cap entry door": 0, "Cap patio door": 0,
        "Cap single garage door": 0, "Build out for windows w/furring (includes capping)": 0,
        "R&R Gable louvers": 0, "Fascia Return": 0, "Bird box": 0, "Flashing": 0,
        "Cap tops of bird boxes": 60, "Dormer upcharge": 0, "R&R Utilities": 0,
        "Cut out 4x4 section of wall and insulate": 100,
    },
}


# ---------------------------------------------------------------------------
# LP SmartSide pricing — SAME PRICE ACROSS ALL 4 TIERS (per Howard, LP is
# single-pricing). Values from the "LP Smart siding" tab in his Excel sheet.
# Merged into every tier at module load so the existing TIER_PRICES /
# pricing-admin / catalog-merge flow continues to work without special-casing.
# ---------------------------------------------------------------------------
LP_PRICES = {
    # LP Smart Siding (main panels & laps)
    'LP Strand Lap Siding 3/8" x 8" x 16\'': 298.24,
    'LP Strand Shake 3/8" x 12" x 4\'': 20.78,
    'LP Nickel Gap 1/2" x 8" x 16\'': 63.30,
    'LP Strand Panel 3/8" x 4\' x 8\'': 90.16,
    'LP Strand Panel 3/8" x 4\' x 10\'': 119.45,
    'LP Strand Panel 3/8" x 16" x 16\'': 80.34,
    # 190 series trim (4/4) — priced per LF (16' board ÷ 16)
    'LP 190 Trim 5/8" x 3" x 16\'': 1.08,
    # 440 series trim (4/4) — priced per LF
    'LP 440 Trim 3/4" x 4" x 16\'': 1.54,
    'LP 440 Trim 3/4" x 6" x 16\'': 2.31,
    'LP 440 Trim 3/4" x 8" x 16\'': 3.09,
    'LP 440 Trim 3/4" x 10" x 16\'': 4.02,
    'LP 440 Trim 3/4" x 12" x 16\'': 4.82,
    # 540 series trim (5/4) — priced per LF
    'LP 540 Trim 3/4" x 4" x 16\'': 1.88,
    'LP 540 Trim 3/4" x 6" x 16\'': 2.81,
    'LP 540 Trim 3/4" x 8" x 16\'': 3.75,
    'LP 540 Trim 3/4" x 10" x 16\'': 4.91,
    'LP 540 Trim 3/4" x 12" x 16\'': 5.89,
    # LP siding accessories
    "LP Color Match Coil": 133.23,
    'LP Outside corners 4" x 16\'': 160.89,
    'LP Outside corners 6" x 16\'': 241.35,
    "LP Touch-up Kit": 53.34,
    "LP Caulking Color Match": 12.28,
    'LP J-blocks 1" W/FLASHING': 50.00,
    'LP Mini Split 1" W/FLASHING': 70.00,
    # LP soffit
    'LP Soffit 3/8" x 16" x 16\' Vented': 76.00,
    'LP Soffit 3/8" x 24" x 16\' Vented': 109.33,
    'LP Soffit 3/8" x 24" x 16\' Solid': 117.44,
}

for _tier_dict in TIER_PRICES.values():
    _tier_dict.update(LP_PRICES)


# ---------------------------------------------------------------------------
# Windows pricing — SAME ACROSS ALL 4 TIERS for now (Howard's note: "1 tier
# for now, will eventually have 3 tiers but want to get this set correctly
# first"). When he sends tier-specific window prices, replace this with the
# same per-tier structure used for siding/Ascend above. Material defaults
# from the "window price sheet" tab; rows tagged as labor-only (Pocket
# Install, etc.) carry $0 material — their labor lives in ITEM_META.
# ---------------------------------------------------------------------------
WINDOWS_PRICES = {
    # Vero Windows — known prices
    "Vero - Double Hung 0-101 UI": 294.55,
    "Vero - Slider 0-101 UI": 294.55,
    # Other window/door product rows currently $0 placeholders — Howard
    # will fill in via the pricing admin once he has them.
    "Vero - 3 lite slider 0-101 UI": 0,
    "Vero - Casement 0-101 UI": 0,
    "Vero - Picture 0-101 UI": 0,
    "Window Package Price": 0,
    # Upgrade options — material adders
    "Climatech TG2 Triple Pane .19 U Factor 2 coats LoE": 95.37,
    "Sentry System - Tilt Lock upgrade": 38.15,
    "Integral Nail Fin 0-101": 19.52,
    "Heavy Duty 1/2 Screen White ONLY": 25.73,
    # Door products — $0 placeholders for now
    'Vero - Sliding glass door 60" x 80"': 0,
    'Vero - Sliding glass door 72" x 80"': 0,
    'Vero - Sliding glass door 96" x 80"': 0,
    "Vero - Sliding glass door Custom Size": 0,
}

for _tier_dict in TIER_PRICES.values():
    _tier_dict.update(WINDOWS_PRICES)


# AMI part numbers from Alside's price sheet — used on the printed material list
# so contractors can order/pull materials by SKU. Items without an AMI # (most
# labor-only lines, some accessories) just show blank on the list.
ITEM_AMI = {
    # Siding profiles — each gets its own SKU per Alside's price sheet
    'Conquest Clap 4.5" .040': "015456",
    'Conquest Dutch lap 4.5" .040': "015457",
    'Coventry Clap 4" .042': "016061",
    'Coventry Dutch lap 4" .042': "016062",
    'Coventry Clap 5" .042': "016066",
    'Coventry Dutch lap 5" .042': "016067",
    'Odyssey Clap 4" .044': "015406",
    'Odyssey Dutch Lap 4" .044': "015408",
    'Odyssey Clap 5" .044': "015506",
    'Odyssey Dutch Lap 5" .044': "015508",
    'Charter Oak Clap 4.5" .046': "015451",
    'Charter Oak Dutch Lap 4.5" .046': "015452",
    'vertical board and batten 7"': "016021",
    'Pelican Bay Shakes 9"': "655052",
    "ASCEND Finish Trim": "105210",
    "Ascend - Starter": "107371",
    "Ascend - 5.5\" Trim  (16' length)": "108042",
    'Ascend Composite Lap Siding 7"': "018001",
    'Ascend Composite B&B 12" (add 30% Waste)': "018021",
    'Ascend 3.5" Outside Corner  - MATTE': "108032",
    'Ascend 5.5" Outside Corner  - MATTE': "108052",
    "Inside Corners": "105053",
    "Ascend - J - Channel  (2 per Sq of siding)": "108062",
    ".019 Coil (1 per 5 Sq Siding)": "103954",
    "PVC Trim Coil (1 per 5 Sq Siding)": "103956",
    "Performance G8 Trim Coil (1 per 5 Sq Siding)": "103960",
    "Outside corners": "105644",
    "Inside Corners (Siding)": "105053",
    '3/4" J-Channel (2 per Sq of siding)': "105118",
    '1/2" J-Channel (2 per Sq of siding)': "105114",
    "Finish Trim": "105200",
    "Starter": "107361",
    "House Wrap": "646662A0",
    "RainDrop": "646686",
    '3/8" Fan Fold': "668363",
    '1 1/4" Trim Nails': "780052",
    "Caulking (per color)": "701170",
    'Soffit & fascia up to 13" wide Charter Oak': "105020",
    'Soffit & fascia up to 13" wide Greenbriar': "106022",
    'Soffit & fascia up to 13" T2': "105007",
    'Soffit & fascia up to 13"-30" wide Charter Oak': "105020",
    'Soffit & fascia up to 13"-30" wide Greenbriar': "106022",
    'Soffit & fascia up to 13"-30" T2': "105007",
    ".019 Coil (1 per 50' fascia)": "103954",
    "PVC Trim Coil (1 per 50' fascia)": "103956",
    "Performance G8 Trim Coil (1 per 50' fascia)": "103960",
    '3/4" Soffit J-Channel (Charter Oak)': "105118",
    '1/2" Soffit J-Channel (for T2 Soffit)': "105114",
}


# Which "tab" each catalog section appears under in the multi-product
# estimator. A section can appear in more than one tab (shared accessories
# like J-Channel, Soffit, Tear-Off, etc. show up on both Vinyl and Ascend
# tabs because both job types use them).
#
# Section titles not in this map default to ["vinyl", "ascend"] — i.e. they
# are treated as shared between the two existing siding lines. LP Smart
# Siding gets its own dedicated sections once the catalog is populated, so
# nothing shared bleeds into the LP tab by accident.
SECTION_PRODUCT_LINES = {
    # Product-line-exclusive sections
    "Vinyl Siding": ["vinyl"],
    "Ascend Cladding": ["ascend"],
    "Ascend Cladding/Accessories": ["ascend"],
    "LP Smart Siding": ["lp_smart"],
    "LP SmartSide Trim": ["lp_smart"],
    "LP Siding Accessories": ["lp_smart"],
    "LP SmartSide Soffit": ["lp_smart"],
    # Windows tab — Vero product line lives entirely on its own.
    "Vero Windows": ["windows"],
    "Window Upgrade Options": ["windows"],
    "Window Installation": ["windows"],
    "Vero Sliding Glass Doors": ["windows"],
    "Sliding Glass Door Install": ["windows"],
    "Window Exterior Trim Work": ["windows"],
    "Window Interior Trim Work": ["windows"],
    "Window Misc.": ["windows"],
    # Shared sections used by all 3 product lines (LP also uses the same
    # generic tear-off, gutter, and misc-labor catalog rows per Howard's
    # LP Smart siding sheet — pricing is identical to vinyl/ascend).
    "Tear-Off / Clean Up": ["vinyl", "ascend", "lp_smart"],
    "Seamless Gutter": ["vinyl", "ascend", "lp_smart"],
    "Misc. Labor Only": ["vinyl", "ascend", "lp_smart"],
    "Misc. Labor & Material": ["vinyl", "ascend", "lp_smart"],
    "Misc.": ["vinyl", "ascend", "lp_smart"],
}


def product_lines_for(section_title: str) -> list:
    """Return the list of tab IDs (vinyl / ascend / lp_smart) that this
    catalog section should appear under. Single source of truth used by the
    catalog endpoint and the estimate save/merge logic."""
    return SECTION_PRODUCT_LINES.get(section_title, ["vinyl", "ascend"])


def build_tier_sections(tier_name: str) -> list:
    """Build the full sections list for a given tier name using SECTION_LAYOUT + TIER_PRICES."""
    prices = TIER_PRICES[tier_name]
    out = []
    for title, ascend, item_names in SECTION_LAYOUT:
        items = []
        for n in item_names:
            unit, lab = ITEM_META.get(n, ("Each", 0))
            items.append({
                "name": n, "unit": unit,
                "mat": float(prices.get(n, 0)),
                "lab": float(lab),  # labor default — contractor can override
                "ami_part": ITEM_AMI.get(n),
            })
        out.append({
            "title": title,
            "ascend": ascend,
            "product_lines": product_lines_for(title),
            "items": items,
        })
    return out


# Default tier for new companies — newest/unknown contractors get our most expensive
# rate; you bump them down to better tiers (Contractor / Builder-Dealer / one-opp)
# as they earn it.
DEFAULT_TIER_NAME = "whole-sale"

# Legacy export — keeps backward compat with any code that still reads DEFAULT_SECTIONS
DEFAULT_SECTIONS = build_tier_sections(DEFAULT_TIER_NAME)

# All tier names, in display order
TIER_NAMES = ["one-opp", "Builder-Dealer", "Contractor", "whole-sale"]
