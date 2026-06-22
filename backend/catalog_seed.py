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
    # Iter 34 (Feb 2026): Siding catalog re-shape per Howard's updated Excel —
    # every profile is now split into Standard-color and Architectural-color
    # variants (each with both Clap and Dutch Lap). Old single-variant names
    # are intentionally removed from the catalog; existing estimate lines
    # still reference them and continue to render correctly because lines
    # snapshot their own mat/lab at save time.
    ("Vinyl Siding", False, [
        # Conquest (.040)
        'Conquest Standard color Clap 4.5" .040',
        'Conquest Standard color Dutch lap 4.5" .040',
        'Conquest Architectural color Clap 4.5" .040',
        'Conquest Architectural color Dutch lap 4.5" .040',
        # Coventry 4" (.042)
        'Coventry Standard color Clap 4" .042',
        'Coventry Standard color Dutch lap 4" .042',
        'Coventry Architectural color Clap 4" .042',
        'Coventry Architectural color Dutch lap 4" .042',
        # Coventry 5" (.042)
        'Coventry Standard color Clap 5" .042',
        'Coventry Standard color Dutch lap 5" .042',
        'Coventry Architectural color Clap 5" .042',
        'Coventry Architectural color Dutch lap 5" .042',
        # Odyssey 4" (.044)
        'Odyssey Standard color Clap 4" .044',
        'Odyssey Standard color Dutch Lap 4" .044',
        'Odyssey Architectural color Clap 4" .044',
        'Odyssey Architectural color Dutch Lap 4" .044',
        # Odyssey 5" (.044)
        'Odyssey Standard color Clap 5" .044',
        'Odyssey Standard color Dutch Lap 5" .044',
        'Odyssey Architectural color Clap 5" .044',
        'Odyssey Architectural color Dutch Lap 5" .044',
        # Charter Oak (.046)
        'Charter Oak Standard color Clap 4.5" .046',
        'Charter Oak Standard color Dutch Lap 4.5" .046',
        'Charter Oak Architectural color Clap 4.5" .046',
        'Charter Oak Architectural color Dutch Lap 4.5" .046',
        # Vertical / accent profiles
        'vertical board and batten Standard color 7"',
        'vertical board and batten Architectural color 7"',
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
        # Iter 34: Outside / Inside / 3/4" J-Channel / Finish Trim now split
        # into Standard-color and Architectural-color variants per Howard's
        # updated Alside price sheet.
        "Outside corners Standard color",
        "Outside corners Architectural color",
        "Inside Corners (Siding) Standard color",
        "Inside Corners (Siding) Architectural color",
        '3/4" J-Channel Standard color (2 per Sq of siding)',
        '3/4" J-Channel Architectural color (2 per Sq of siding)',
        '1/2" J-Channel (2 per Sq of siding)',
        "Finish Trim Standard color",
        "Finish Trim Architectural color",
        "Starter", "House Wrap", "RainDrop House Wrap", '3/8" Fan Fold',
        '2" Nails 30 lbs (1 per 15 Sq)', "Caulking (per color)",
        "J-blocks - Split Blocks (82A009)",
        "J-blocks - Light Blocks (82A010)",
        "J-blocks - UL Blocks (82A017)",
        "J-blocks - Jumbo Blocks (82A011)",
        'Dryer Vents 4" (82A014)',
        "Shutters (louvered, raised panel) standard sizes",
        "Gable vents (round,octagon)", '1 1/4" Trim Nails',
    ]),
    ("Tear-Off / Clean Up", False, [
        "Tear-Off", "Wood shake tear off (requires a dumpster)",
        "clean up/ haul away job debris", "Dumpster",
    ]),
    ("Vinyl Soffit with Siding", False, [
        # Iter 45: soffit SKUs converted from LF→PCS using Howard's formula
        # Pieces = (Overhang × Length) ÷ ((Exposure/12) × Panel length) × (1+waste%)
        # Per-piece prices = per-LF price × 10 (Howard's pricing convention).
        # The legacy "13"-30" wide" wide-soffit variants were dropped — wider
        # soffits are handled by the same SKUs at a higher overhang value.
        'Charter Oak Soffit Standard color',
        'Charter Oak Soffit Architectural color',
        'Greenbriar Soffit',
        'T2 Soffit',
        '3/4" Soffit J-Channel (Charter Oak) Standard color',
        '3/4" Soffit J-Channel (Charter Oak) Architectural color',
        '1/2" Soffit J-Channel (for T2 Soffit)',
        'Fascia/rake or frieze up to 8" coverage', "Cap porch band",
        ".019 Coil (1 per 50' fascia)",
        "PVC Trim Coil (1 per 50' fascia)",
        "Performance G8 Trim Coil (1 per 50' fascia)",
    ]),
    ("Porch Ceiling", False, [
        "With or without siding Charter Oak", "Wrap porch beam",
    ]),
    ("Seamless Gutter", False, [
        'Gutter 6"', 'Downspout 6"', "elbow", "Mitre", "End Cap", "Gutter Guard (USA Shurflo)",
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
    # WINDOWS — Vero product line. Iter 36 (Feb 2026): per-window-type
    # sections matching Howard's updated Excel layout. Each window product
    # gets its own section with size buckets; the per-window-type adders
    # (Tan Interior, Tempered glass, Obscure, etc.) are exposed as
    # toggleable checkboxes via `WINDOW_ADDERS` below, NOT as their own
    # line items. Prices start at $0 across the board — Howard will fill
    # them in via the pricing admin once he likes the layout.
    # -----------------------------------------------------------------------
    # Iter 36 follow-up: free-form "custom quote" line for one-off
    # window jobs that don't fit the size grid. Lives at the very top of
    # the Windows tab as its own section so contractors can drop in a
    # bespoke quoted figure without touching the standard buckets below.
    ("Vero Windows Custom Quote", False, [
        "Vero Window Quote",
    ]),
    ("Vero Double Hung Windows", False, [
        "Vero - Double Hung 0-101 UI",
        "Vero - Double Hung 102-110 UI",
        "Vero - Double Hung 111-120 UI",
        "Vero - Double Hung 121-130 UI",
        "Vero - Double Hung 131-140 UI",
        "Vero - Double Hung 141-150 UI",
        "Vero - Double Hung 151-160 UI",
        "Vero - Double Hung 161-170 UI",
    ]),
    ("Vero 2 Lite Slider Windows", False, [
        "Vero - Slider 0-101 UI",
        "Vero - Slider 102-110 UI",
        "Vero - Slider 111-120 UI",
        "Vero - Slider 121-130 UI",
        "Vero - Slider 131-140 UI",
        "Vero - Slider 141-150 UI",
        "Vero - Slider 151-160 UI",
        "Vero - Slider 161-170 UI",
    ]),
    ("Vero 3 Lite Slider Windows", False, [
        "Vero - 3 Lite Slider Min-73 UI",
        "Vero - 3 Lite Slider 74-83 UI",
        "Vero - 3 Lite Slider 84-93 UI",
        "Vero - 3 Lite Slider 94-101 UI",
        "Vero - 3 Lite Slider 102-110 UI",
        "Vero - 3 Lite Slider 111-120 UI",
        "Vero - 3 Lite Slider 121-130 UI",
        "Vero - 3 Lite Slider 131-140 UI",
        "Vero - 3 Lite Slider 141-150 UI",
        "Vero - 3 Lite Slider 151-160 UI",
        "Vero - 3 Lite Slider 161-170 UI",
        "Vero - 3 Lite Slider 171-180 UI",
        "Vero - 3 Lite Slider 181-190 UI",
    ]),
    ("Vero Casement Windows", False, [
        "Vero - Casement Min-43 UI",
        "Vero - Casement 44-53 UI",
        "Vero - Casement 54-63 UI",
        "Vero - Casement 64-73 UI",
        "Vero - Casement 74-83 UI",
        "Vero - Casement 84-93 UI",
        "Vero - Casement 93-101 UI",
        "Vero - Casement 102-108 UI",
    ]),
    ("Vero Picture Windows", False, [
        "Vero - Picture Min-73 UI",
        "Vero - Picture 74-83 UI",
        "Vero - Picture 84-93 UI",
        "Vero - Picture 94-101 UI",
        "Vero - Picture 102-110 UI",
        "Vero - Picture 111-120 UI",
        "Vero - Picture 121-130 UI",
        "Vero - Picture 131-140 UI",
        "Vero - Picture 141-150 UI",
        "Vero - Picture 151-160 UI",
        "Vero - Picture 161-170 UI",
        "Vero - Picture 171-180 UI",
        "Vero - Picture 181-190 UI",
    ]),
    ("Window Installation", False, [
        "Window DH/Slider - Pocket Install",
        "Window - Full Fin Replacement",
        "Large Window - adder for windows 30 sq-ft or larger",
        "Field Mull Assembly and/or Field Glaze (adder per each opening)",
        "Lead Safe Installation Practices For Window Installation",
        "Lead Safe - Test Fee (all homes 1978 and older are tested)",
        "Cap window (Windows)",
        "Job Measure Standard Fee 4 days+",
        "Disposal Fee (Windows)",
        "Mullion Removal & Cut-Out of Non-Structural Framing Members",
    ]),
    ("Vero Sliding Glass Doors", False, [
        'Vero - Sliding glass door 60" x 80"',
        'Vero - Sliding glass door 72" x 80"',
        'Vero - Sliding glass door 96" x 80"',
        "Vero - Sliding glass door Custom Size",
    ]),
    ("Sliding Glass Door Install", False, [
        "Vinyl Sliding Glass Door (5' & 6' width)",
        "Vinyl Sliding Glass Door (8' width -or- a sliding door that needs to be field assembled)",
        "Oversize Vinyl Door - (greater than 8' width)",
    ]),
    ("Window Material List", False, [
        "Windows - .019 Coil",
        "Windows - PVC Trim Coil",
        "Windows - Performance G8 Trim Coil",
        "Windows - Caulking (per color)",
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
        "New Interior Sill - create or replace interior window sill - QUOTE ONLY",
    ]),
    ("Window Misc.", False, [
        "Interior Blinds - Remove For Window Install & Reinstall",
        "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)",
        "Storm Window Removal",
        "Second/Third/Clear Story Fee",
        "Job Measure Rush Fee 3 days or less",
        "Add New Channel on ALL, Close up opening to match master Front opening",
        "Minimum Job Charge For Window Installs",
    ]),
]

# Units & default labor are the same across tiers (labor defaults — contractor can override)
ITEM_META = {
    # name: (unit, lab_default)
    # All siding profiles use SQ unit and $125/SQ default labor.
    # Iter 34: Standard color + Architectural color variants for each profile.
    'Conquest Standard color Clap 4.5" .040': ("SQ", 0),
    'Conquest Standard color Dutch lap 4.5" .040': ("SQ", 0),
    'Conquest Architectural color Clap 4.5" .040': ("SQ", 0),
    'Conquest Architectural color Dutch lap 4.5" .040': ("SQ", 0),
    'Coventry Standard color Clap 4" .042': ("SQ", 0),
    'Coventry Standard color Dutch lap 4" .042': ("SQ", 0),
    'Coventry Architectural color Clap 4" .042': ("SQ", 0),
    'Coventry Architectural color Dutch lap 4" .042': ("SQ", 0),
    'Coventry Standard color Clap 5" .042': ("SQ", 0),
    'Coventry Standard color Dutch lap 5" .042': ("SQ", 0),
    'Coventry Architectural color Clap 5" .042': ("SQ", 0),
    'Coventry Architectural color Dutch lap 5" .042': ("SQ", 0),
    'Odyssey Standard color Clap 4" .044': ("SQ", 0),
    'Odyssey Standard color Dutch Lap 4" .044': ("SQ", 0),
    'Odyssey Architectural color Clap 4" .044': ("SQ", 0),
    'Odyssey Architectural color Dutch Lap 4" .044': ("SQ", 0),
    'Odyssey Standard color Clap 5" .044': ("SQ", 0),
    'Odyssey Standard color Dutch Lap 5" .044': ("SQ", 0),
    'Odyssey Architectural color Clap 5" .044': ("SQ", 0),
    'Odyssey Architectural color Dutch Lap 5" .044': ("SQ", 0),
    'Charter Oak Standard color Clap 4.5" .046': ("SQ", 0),
    'Charter Oak Standard color Dutch Lap 4.5" .046': ("SQ", 0),
    'Charter Oak Architectural color Clap 4.5" .046': ("SQ", 0),
    'Charter Oak Architectural color Dutch Lap 4.5" .046': ("SQ", 0),
    'vertical board and batten Standard color 7"': ("SQ", 0),
    'vertical board and batten Architectural color 7"': ("SQ", 0),
    'Pelican Bay Shakes 9"': ("SQ", 0),
    'Ascend Composite Lap Siding 7"': ("SQ", 0), 'Ascend Composite B&B 12" (add 30% Waste)': ("SQ", 0),
    'Ascend 3.5" Outside Corner  - MATTE': ("PCS", 0), 'Ascend 5.5" Outside Corner  - MATTE': ("PCS", 0),
    "Inside Corners": ("PCS", 0), "Ascend - 5.5\" Trim  (16' length)": ("PCS", 0),
    "Ascend - J - Channel  (2 per Sq of siding)": ("PCS", 0),
    "ASCEND Finish Trim": ("PCS", 0), "Ascend - Starter": ("PCS", 0),
    ".019 Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    "PVC Trim Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    "Performance G8 Trim Coil (1 per 5 Sq Siding)": ("ROLL", 0),
    # Iter 34: split Standard/Architectural variants
    "Outside corners Standard color": ("PCS", 0),
    "Outside corners Architectural color": ("PCS", 0),
    "Inside Corners (Siding) Standard color": ("PCS", 0),
    "Inside Corners (Siding) Architectural color": ("PCS", 0),
    '3/4" J-Channel Standard color (2 per Sq of siding)': ("PCS", 0),
    '3/4" J-Channel Architectural color (2 per Sq of siding)': ("PCS", 0),
    '1/2" J-Channel (2 per Sq of siding)': ("PCS", 0),
    "Finish Trim Standard color": ("PCS", 0),
    "Finish Trim Architectural color": ("PCS", 0),
    "Starter": ("PCS", 0),
    "House Wrap": ("SQ", 0), "RainDrop House Wrap": ("SQ", 0), '3/8" Fan Fold': ("SQ", 0),
    '2" Nails 30 lbs (1 per 15 Sq)': ("JOB", 0), "Caulking (per color)": ("Each", 0),
    "J-blocks - Split Blocks (82A009)": ("Each", 0),
    "J-blocks - Light Blocks (82A010)": ("Each", 0),
    "J-blocks - UL Blocks (82A017)": ("Each", 0),
    "J-blocks - Jumbo Blocks (82A011)": ("Each", 0),
    'Dryer Vents 4" (82A014)': ("Each", 0),
    "Shutters (louvered, raised panel) standard sizes": ("PR", 0),
    "Gable vents (round,octagon)": ("Each", 0), '1 1/4" Trim Nails': ("Box", 0),
    "Tear-Off": ("SQ", 0), "Wood shake tear off (requires a dumpster)": ("SQ", 0),
    "clean up/ haul away job debris": ("JOB", 0), "Dumpster": ("Each", 0),
    'Charter Oak Soffit Standard color': ("PCS", 0),
    'Charter Oak Soffit Architectural color': ("PCS", 0),
    'Greenbriar Soffit': ("PCS", 0),
    'T2 Soffit': ("PCS", 0),
    '3/4" Soffit J-Channel (Charter Oak) Standard color': ("PCS", 0),
    '3/4" Soffit J-Channel (Charter Oak) Architectural color': ("PCS", 0),
    '1/2" Soffit J-Channel (for T2 Soffit)': ("PCS", 0),
    'Fascia/rake or frieze up to 8" coverage': ("LF", 0), "Cap porch band": ("LF", 0),
    ".019 Coil (1 per 50' fascia)": ("ROLL", 0),
    "PVC Trim Coil (1 per 50' fascia)": ("ROLL", 0),
    "Performance G8 Trim Coil (1 per 50' fascia)": ("ROLL", 0),
    "With or without siding Charter Oak": ("SQ FT", 0), "Wrap porch beam": ("LF", 0),
    'Gutter 6"': ("LF", 0), 'Downspout 6"': ("LF", 0),
    "elbow": ("Each", 0), "Mitre": ("Each", 0), "End Cap": ("Each", 0), "Gutter Guard (USA Shurflo)": ("LF", 0),
    "R&R gutter": ("LF", 0), "R&R downspout": ("LF", 0),
    "Cap window": ("Each", 0), "Cap windows with wide crown": ("Each", 0),
    "Capping general": ("LF", 0), "Cap window headers only": ("Each", 0),
    "Cap entry door": ("Each", 0), "Cap patio door": ("Each", 0),
    "Cap single garage door": ("Each", 0),
    "Build out for windows w/furring (includes capping)": ("Each", 0),
    "R&R Gable louvers": ("Each", 0), "Fascia Return": ("Each", 0),
    "Bird box": ("Each", 0), "Flashing": ("LF", 0),
    "Cap tops of bird boxes": ("Each", 0), "Dormer upcharge": ("Each", 0),
    "R&R Utilities": ("Each", 0), "Cut out 4x4 section of wall and insulate": ("Each", 0),
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
    # Iter 36: each Vero product type now has its own section + its own
    # size buckets (per Howard's updated Excel "window Whole Sale" sheet).
    # All material prices start at $0 — Howard will set them via the
    # pricing admin once the layout is approved. Labor defaults from the
    # Excel; contractors override per estimate.
    # Custom one-off quote line — top of the Windows tab.
    "Vero Window Quote": ("each", 0),
    # Vero Double Hung — 8 size buckets
    "Vero - Double Hung 0-101 UI": ("each", 0),
    "Vero - Double Hung 102-110 UI": ("each", 0),
    "Vero - Double Hung 111-120 UI": ("each", 0),
    "Vero - Double Hung 121-130 UI": ("each", 0),
    "Vero - Double Hung 131-140 UI": ("each", 0),
    "Vero - Double Hung 141-150 UI": ("each", 0),
    "Vero - Double Hung 151-160 UI": ("each", 0),
    "Vero - Double Hung 161-170 UI": ("each", 0),
    # Vero 2 Lite Slider — 8 size buckets
    "Vero - Slider 0-101 UI": ("each", 0),
    "Vero - Slider 102-110 UI": ("each", 0),
    "Vero - Slider 111-120 UI": ("each", 0),
    "Vero - Slider 121-130 UI": ("each", 0),
    "Vero - Slider 131-140 UI": ("each", 0),
    "Vero - Slider 141-150 UI": ("each", 0),
    "Vero - Slider 151-160 UI": ("each", 0),
    "Vero - Slider 161-170 UI": ("each", 0),
    # Vero 3 Lite Slider — 13 size buckets
    "Vero - 3 Lite Slider Min-73 UI": ("each", 0),
    "Vero - 3 Lite Slider 74-83 UI": ("each", 0),
    "Vero - 3 Lite Slider 84-93 UI": ("each", 0),
    "Vero - 3 Lite Slider 94-101 UI": ("each", 0),
    "Vero - 3 Lite Slider 102-110 UI": ("each", 0),
    "Vero - 3 Lite Slider 111-120 UI": ("each", 0),
    "Vero - 3 Lite Slider 121-130 UI": ("each", 0),
    "Vero - 3 Lite Slider 131-140 UI": ("each", 0),
    "Vero - 3 Lite Slider 141-150 UI": ("each", 0),
    "Vero - 3 Lite Slider 151-160 UI": ("each", 0),
    "Vero - 3 Lite Slider 161-170 UI": ("each", 0),
    "Vero - 3 Lite Slider 171-180 UI": ("each", 0),
    "Vero - 3 Lite Slider 181-190 UI": ("each", 0),
    # Vero Casement — 8 size buckets
    "Vero - Casement Min-43 UI": ("each", 0),
    "Vero - Casement 44-53 UI": ("each", 0),
    "Vero - Casement 54-63 UI": ("each", 0),
    "Vero - Casement 64-73 UI": ("each", 0),
    "Vero - Casement 74-83 UI": ("each", 0),
    "Vero - Casement 84-93 UI": ("each", 0),
    "Vero - Casement 93-101 UI": ("each", 0),
    "Vero - Casement 102-108 UI": ("each", 0),
    # Vero Picture — 13 size buckets
    "Vero - Picture Min-73 UI": ("each", 0),
    "Vero - Picture 74-83 UI": ("each", 0),
    "Vero - Picture 84-93 UI": ("each", 0),
    "Vero - Picture 94-101 UI": ("each", 0),
    "Vero - Picture 102-110 UI": ("each", 0),
    "Vero - Picture 111-120 UI": ("each", 0),
    "Vero - Picture 121-130 UI": ("each", 0),
    "Vero - Picture 131-140 UI": ("each", 0),
    "Vero - Picture 141-150 UI": ("each", 0),
    "Vero - Picture 151-160 UI": ("each", 0),
    "Vero - Picture 161-170 UI": ("each", 0),
    "Vero - Picture 171-180 UI": ("each", 0),
    "Vero - Picture 181-190 UI": ("each", 0),
    # Window install (labor defaults from the Excel)
    "Window DH/Slider - Pocket Install": ("each", 170),
    "Window - Full Fin Replacement": ("each", 252.45),
    "Large Window - adder for windows 30 sq-ft or larger": ("each", 76.92),
    "Field Mull Assembly and/or Field Glaze (adder per each opening)": ("each", 53.85),
    "Lead Safe Installation Practices For Window Installation": ("each", 53.85),
    "Lead Safe - Test Fee (all homes 1978 and older are tested)": ("each", 0),
    # Sliding Glass Doors
    'Vero - Sliding glass door 60" x 80"': ("each", 0),
    'Vero - Sliding glass door 72" x 80"': ("each", 0),
    'Vero - Sliding glass door 96" x 80"': ("each", 0),
    "Vero - Sliding glass door Custom Size": ("each", 0),
    "Vinyl Sliding Glass Door (5' & 6' width)": ("each", 669.63),
    "Vinyl Sliding Glass Door (8' width -or- a sliding door that needs to be field assembled)": ("each", 832.55),
    "Oversize Vinyl Door - (greater than 8' width)": ("each", 1099.42),
    # Exterior / Interior trim
    "New Exterior Primed Stops or Snap Trim": ("each", 49.65),
    "New Exterior Primed Wood Trim": ("each", 71.04),
    "New Exterior Composite Trim": ("each", 99.26),
    "Cap window (Windows)": ("each", 20),  # matches siding "Cap window"
    "New Interior Stops or Flat Trim": ("each", 20.0),
    "New Interior Casing": ("each", 77.62),
    "New Interior Jamb Extension": ("each", 89.13),
    "New Interior Sill - create or replace interior window sill - QUOTE ONLY": ("each", 120.0),
    # Window Material List (windows-tab copies of siding-tab coils)
    "Windows - .019 Coil": ("ROLL", 0),
    "Windows - PVC Trim Coil": ("ROLL", 0),
    "Windows - Performance G8 Trim Coil": ("ROLL", 0),
    "Windows - Caulking (per color)": ("Each", 0),
    # Window Misc.
    "Interior Blinds - Remove For Window Install & Reinstall": ("each", 53.85),
    "Shutters - Take Down & Put Up (REUSE EXISTING ONLY)": ("each", 38.46),
    "Mullion Removal & Cut-Out of Non-Structural Framing Members": ("each", 23.08),
    "Storm Window Removal": ("each", 23.08),
    "Second/Third/Clear Story Fee": ("each", 1846.15),
    "Job Measure Standard Fee 4 days+": ("JOB", 150.0),
    "Job Measure Rush Fee 3 days or less": ("ADD", 80.77),
    "Add New Channel on ALL, Close up opening to match master Front opening": ("each", 1200.0),
    "Minimum Job Charge For Window Installs": ("JOB", 769.23),
    "Disposal Fee (Windows)": ("JOB", 125.0),
}

# ---------------------------------------------------------------------------
# Pricing data (Iter 36 refactor): the legacy TIER_PRICES = { tier: { item: $ } }
# was 4 tier dicts × ~150 items each ≈ 600 lines. Every Excel update touched the
# same item in 4 places. We now split the SAME data by SHAPE:
#
#   IDENTICAL_PRICES — item → $    (61 items, same price on every tier)
#   ZERO_PRICED      — set         (30 service/labor lines, $0 on every tier)
#   PER_TIER_PRICES  — item → {tier: $}  (59 items that truly vary by tier)
#
# The legacy TIER_PRICES view is then computed once at module load so all
# downstream callers (build_tier_sections, ensure_tiers_seeded, pricing_admin,
# CSV diff) keep working unchanged. A pytest in tests/test_pricing_parity.py
# locks the round-trip to the historical values so we catch any silent drift.
# ---------------------------------------------------------------------------

# 25 items priced identically on every tier (mostly accessories,
# Ascend MATTE corners, fan-fold, nails, caulking, shutters, etc.).
IDENTICAL_PRICES = {
    '1 1/4" Trim Nails': 9,
    '2" Nails 30 lbs (1 per 15 Sq)': 81.63,
    '3/8" Fan Fold': 11.06,
    'ASCEND Finish Trim': 7.86,
    'Ascend - J - Channel  (2 per Sq of siding)': 10.4,
    'Ascend - Starter': 7.68,
    'Ascend 3.5" Outside Corner  - MATTE': 40.42,
    'Ascend 5.5" Outside Corner  - MATTE': 59.36,
    'Cap tops of bird boxes': 60,
    'Cap windows with wide crown': 65,
    'Caulking (per color)': 8.23,
    'Cut out 4x4 section of wall and insulate': 100,
    'Downspout 6"': 2.8,
    'End Cap': 2.08,
    'Gable vents (round,octagon)': 92.2875,
    'Gutter 6"': 3.25,
    'Gutter Guard (USA Shurflo)': 2.25,
    'House Wrap': 11.55,
    'Inside Corners': 11.83,
    'J-blocks - Split Blocks (82A009)': 13.49,
    'J-blocks - Light Blocks (82A010)': 11.72,
    'J-blocks - UL Blocks (82A017)': 21.51,
    'J-blocks - Jumbo Blocks (82A011)': 11.72,
    'Dryer Vents 4" (82A014)': 23.81,
    'Mitre': 13.75,
    'Pelican Bay Shakes 9"': 419.94,
    'RainDrop House Wrap': 30.73,
    'Shutters (louvered, raised panel) standard sizes': 114.2225,
    'Starter': 7.46,
    'elbow': 2.69,
}

# 19 service / labor-only line items — $0 material on every tier.
# (Tear-off, capping, dumpster, R&R gutter, cap windows, etc. — labor lives in
# the per-line lab field on each estimate.)
ZERO_PRICED = {
    'Bird box',
    'Build out for windows w/furring (includes capping)',
    'Cap entry door',
    'Cap patio door',
    'Cap single garage door',
    'Cap window',
    'Cap window headers only',
    'Capping general',
    'Clean up / haul away job debris',
    'Dormer upcharge',
    'Dumpster',
    'Fascia Return',
    'Fascia/rake or frieze up to 8" coverage',
    'Flashing',
    'R&R Gable louvers',
    'R&R Utilities',
    'R&R downspout',
    'R&R gutter',
    'Tear-Off',
    'Wood shake tear off (requires a dumpster)',
}

# 59 items that truly vary by tier. One block per item so a future
# Excel update touches ONE place per row (was 4 places before this refactor).
PER_TIER_PRICES = {
    '.019 Coil (1 per 5 Sq Siding)': {"whole-sale": 161.33, "Contractor": 161.33, "Builder-Dealer": 161.33, "one-opp": 133.23},
    ".019 Coil (1 per 50' fascia)": {"whole-sale": 161.33, "Contractor": 161.33, "Builder-Dealer": 161.33, "one-opp": 133.23},
    '1/2" J-Channel (2 per Sq of siding)': {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
    '1/2" Soffit J-Channel (for T2 Soffit)': {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
    '3/4" J-Channel Architectural color (2 per Sq of siding)': {"whole-sale": 8.49, "Contractor": 6.03, "Builder-Dealer": 6.03, "one-opp": 4.55},
    '3/4" J-Channel Standard color (2 per Sq of siding)': {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
    '3/4" Soffit J-Channel (Charter Oak) Architectural color': {"whole-sale": 8.49, "Contractor": 6.03, "Builder-Dealer": 6.03, "one-opp": 4.55},
    '3/4" Soffit J-Channel (Charter Oak) Standard color': {"whole-sale": 7.28, "Contractor": 5.23, "Builder-Dealer": 5.23, "one-opp": 4.55},
    'Ascend - 5.5" Trim  (16\' length)': {"whole-sale": 71.66, "Contractor": 71.66, "Builder-Dealer": 61.05, "one-opp": 71.66},
    'Ascend Composite B&B 12" (add 30% Waste)': {"whole-sale": 408.66, "Contractor": 408.66, "Builder-Dealer": 408.66, "one-opp": 366.96},
    'Ascend Composite Lap Siding 7"': {"whole-sale": 332.6, "Contractor": 332.6, "Builder-Dealer": 332.6, "one-opp": 309.64},
    'Cap porch band': {"whole-sale": 0, "Contractor": 2.94, "Builder-Dealer": 0, "one-opp": 2.66},
    'Charter Oak Architectural color Clap 4.5" .046': {"whole-sale": 174.9, "Contractor": 151.97, "Builder-Dealer": 141.21, "one-opp": 123.4},
    'Charter Oak Architectural color Dutch Lap 4.5" .046': {"whole-sale": 174.9, "Contractor": 151.97, "Builder-Dealer": 141.21, "one-opp": 123.4},
    'Charter Oak Standard color Clap 4.5" .046': {"whole-sale": 151.31, "Contractor": 136.22, "Builder-Dealer": 125.46, "one-opp": 113.57},
    'Charter Oak Standard color Dutch Lap 4.5" .046': {"whole-sale": 151.31, "Contractor": 136.22, "Builder-Dealer": 125.46, "one-opp": 113.57},
    'Conquest Architectural color Clap 4.5" .040': {"whole-sale": 113.94, "Contractor": 108.24, "Builder-Dealer": 102.84, "one-opp": 75.71},
    'Conquest Architectural color Dutch lap 4.5" .040': {"whole-sale": 113.94, "Contractor": 108.24, "Builder-Dealer": 102.84, "one-opp": 75.71},
    'Conquest Standard color Clap 4.5" .040': {"whole-sale": 102.15, "Contractor": 97.04, "Builder-Dealer": 92.19, "one-opp": 75.71},
    'Conquest Standard color Dutch lap 4.5" .040': {"whole-sale": 102.15, "Contractor": 97.04, "Builder-Dealer": 92.19, "one-opp": 75.71},
    'Coventry Architectural color Clap 4" .042': {"whole-sale": 117.09, "Contractor": 111.24, "Builder-Dealer": 105.68, "one-opp": 88.1},
    'Coventry Architectural color Clap 5" .042': {"whole-sale": 117.09, "Contractor": 111.24, "Builder-Dealer": 105.68, "one-opp": 88.1},
    'Coventry Architectural color Dutch lap 4" .042': {"whole-sale": 117.09, "Contractor": 111.24, "Builder-Dealer": 105.68, "one-opp": 88.1},
    'Coventry Architectural color Dutch lap 5" .042': {"whole-sale": 117.09, "Contractor": 111.24, "Builder-Dealer": 105.68, "one-opp": 88.1},
    'Coventry Standard color Clap 4" .042': {"whole-sale": 105.3, "Contractor": 100.03, "Builder-Dealer": 95.04, "one-opp": 81.17},
    'Coventry Standard color Clap 5" .042': {"whole-sale": 105.3, "Contractor": 100.03, "Builder-Dealer": 95.04, "one-opp": 81.17},
    'Coventry Standard color Dutch lap 4" .042': {"whole-sale": 105.3, "Contractor": 100.03, "Builder-Dealer": 95.04, "one-opp": 81.17},
    'Coventry Standard color Dutch lap 5" .042': {"whole-sale": 105.3, "Contractor": 100.03, "Builder-Dealer": 95.04, "one-opp": 81.17},
    'Finish Trim Architectural color': {"whole-sale": 7.88, "Contractor": 6.45, "Builder-Dealer": 6.45, "one-opp": 0.49},
    'Finish Trim Standard color': {"whole-sale": 7.28, "Contractor": 5.95, "Builder-Dealer": 5.95, "one-opp": 0.45},
    'Inside Corners (Siding) Architectural color': {"whole-sale": 17.59, "Contractor": 14.39, "Builder-Dealer": 13.2, "one-opp": 10.97},
    'Inside Corners (Siding) Standard color': {"whole-sale": 15.77, "Contractor": 12.9, "Builder-Dealer": 11.83, "one-opp": 9.84},
    'Odyssey Architectural color Clap 4" .044': {"whole-sale": 134.14, "Contractor": 127.44, "Builder-Dealer": 127.44, "one-opp": 108.47},
    'Odyssey Architectural color Clap 5" .044': {"whole-sale": 134.14, "Contractor": 127.44, "Builder-Dealer": 127.44, "one-opp": 108.47},
    'Odyssey Architectural color Dutch Lap 4" .044': {"whole-sale": 134.14, "Contractor": 127.44, "Builder-Dealer": 127.44, "one-opp": 108.47},
    'Odyssey Architectural color Dutch Lap 5" .044': {"whole-sale": 134.14, "Contractor": 127.44, "Builder-Dealer": 127.44, "one-opp": 108.47},
    'Odyssey Standard color Clap 4" .044': {"whole-sale": 122.34, "Contractor": 116.22, "Builder-Dealer": 116.22, "one-opp": 100.11},
    'Odyssey Standard color Clap 5" .044': {"whole-sale": 122.34, "Contractor": 116.22, "Builder-Dealer": 116.22, "one-opp": 100.11},
    'Odyssey Standard color Dutch Lap 4" .044': {"whole-sale": 122.34, "Contractor": 116.22, "Builder-Dealer": 116.22, "one-opp": 100.11},
    'Odyssey Standard color Dutch Lap 5" .044': {"whole-sale": 122.34, "Contractor": 116.22, "Builder-Dealer": 116.22, "one-opp": 100.11},
    'Outside corners Architectural color': {"whole-sale": 34.58, "Contractor": 28.29, "Builder-Dealer": 25.94, "one-opp": 21.58},
    'Outside corners Standard color': {"whole-sale": 31.54, "Contractor": 25.81, "Builder-Dealer": 23.66, "one-opp": 19.69},
    'PVC Trim Coil (1 per 5 Sq Siding)': {"whole-sale": 167.08, "Contractor": 167.08, "Builder-Dealer": 167.08, "one-opp": 149.74},
    "PVC Trim Coil (1 per 50' fascia)": {"whole-sale": 167.08, "Contractor": 167.08, "Builder-Dealer": 167.08, "one-opp": 149.74},
    'Performance G8 Trim Coil (1 per 5 Sq Siding)': {"whole-sale": 170.53, "Contractor": 170.53, "Builder-Dealer": 170.53, "one-opp": 145.89},
    "Performance G8 Trim Coil (1 per 50' fascia)": {"whole-sale": 170.53, "Contractor": 170.53, "Builder-Dealer": 170.53, "one-opp": 145.89},
    'T2 Soffit': {"whole-sale": 13.6, "Contractor": 13.6, "Builder-Dealer": 13.8, "one-opp": 9.5},
    'Charter Oak Soffit Architectural color': {"whole-sale": 22.4, "Contractor": 21.2, "Builder-Dealer": 20.2, "one-opp": 15.5},
    'Charter Oak Soffit Standard color': {"whole-sale": 20.2, "Contractor": 19.1, "Builder-Dealer": 18.2, "one-opp": 14.0},
    'Greenbriar Soffit': {"whole-sale": 18.0, "Contractor": 17.1, "Builder-Dealer": 16.3, "one-opp": 12.3},
    'With or without siding Charter Oak': {"whole-sale": 2.02, "Contractor": 1.91, "Builder-Dealer": 1.82, "one-opp": 1.4},
    'Wrap porch beam': {"whole-sale": 0, "Contractor": 3.22, "Builder-Dealer": 3.22, "one-opp": 2.66},
    'vertical board and batten Architectural color 7"': {"whole-sale": 174.9, "Contractor": 166.16, "Builder-Dealer": 157.86, "one-opp": 123.4},
    'vertical board and batten Standard color 7"': {"whole-sale": 151.31, "Contractor": 143.74, "Builder-Dealer": 136.56, "one-opp": 113.57},
}

# Legacy view — same shape downstream code already consumes. Built once at
# import time from the three structures above. LP and Windows price blocks
# below still .update() into each tier dict, exactly as before.
TIER_PRICES = {
    tier: {
        **{n: IDENTICAL_PRICES[n] for n in IDENTICAL_PRICES},
        **{n: 0 for n in ZERO_PRICED},
        **{n: PER_TIER_PRICES[n][tier] for n in PER_TIER_PRICES},
    }
    for tier in ("one-opp", "Builder-Dealer", "Contractor", "whole-sale")
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
    # All Vero window prices start at $0 — Howard will fill them in via the
    # pricing admin once he likes the new per-window-type layout (Iter 36).
    # Double Hung
    "Vero - Double Hung 0-101 UI": 0,
    "Vero - Double Hung 102-110 UI": 0,
    "Vero - Double Hung 111-120 UI": 0,
    "Vero - Double Hung 121-130 UI": 0,
    "Vero - Double Hung 131-140 UI": 0,
    "Vero - Double Hung 141-150 UI": 0,
    "Vero - Double Hung 151-160 UI": 0,
    "Vero - Double Hung 161-170 UI": 0,
    # 2 Lite Slider
    "Vero - Slider 0-101 UI": 0,
    "Vero - Slider 102-110 UI": 0,
    "Vero - Slider 111-120 UI": 0,
    "Vero - Slider 121-130 UI": 0,
    "Vero - Slider 131-140 UI": 0,
    "Vero - Slider 141-150 UI": 0,
    "Vero - Slider 151-160 UI": 0,
    "Vero - Slider 161-170 UI": 0,
    # 3 Lite Slider — 13 buckets
    "Vero - 3 Lite Slider Min-73 UI": 0,
    "Vero - 3 Lite Slider 74-83 UI": 0,
    "Vero - 3 Lite Slider 84-93 UI": 0,
    "Vero - 3 Lite Slider 94-101 UI": 0,
    "Vero - 3 Lite Slider 102-110 UI": 0,
    "Vero - 3 Lite Slider 111-120 UI": 0,
    "Vero - 3 Lite Slider 121-130 UI": 0,
    "Vero - 3 Lite Slider 131-140 UI": 0,
    "Vero - 3 Lite Slider 141-150 UI": 0,
    "Vero - 3 Lite Slider 151-160 UI": 0,
    "Vero - 3 Lite Slider 161-170 UI": 0,
    "Vero - 3 Lite Slider 171-180 UI": 0,
    "Vero - 3 Lite Slider 181-190 UI": 0,
    # Casement — 8 buckets
    "Vero - Casement Min-43 UI": 0,
    "Vero - Casement 44-53 UI": 0,
    "Vero - Casement 54-63 UI": 0,
    "Vero - Casement 64-73 UI": 0,
    "Vero - Casement 74-83 UI": 0,
    "Vero - Casement 84-93 UI": 0,
    "Vero - Casement 93-101 UI": 0,
    "Vero - Casement 102-108 UI": 0,
    # Picture — 13 buckets
    "Vero - Picture Min-73 UI": 0,
    "Vero - Picture 74-83 UI": 0,
    "Vero - Picture 84-93 UI": 0,
    "Vero - Picture 94-101 UI": 0,
    "Vero - Picture 102-110 UI": 0,
    "Vero - Picture 111-120 UI": 0,
    "Vero - Picture 121-130 UI": 0,
    "Vero - Picture 131-140 UI": 0,
    "Vero - Picture 141-150 UI": 0,
    "Vero - Picture 151-160 UI": 0,
    "Vero - Picture 161-170 UI": 0,
    "Vero - Picture 171-180 UI": 0,
    "Vero - Picture 181-190 UI": 0,
    # Sliding Glass Doors — material prices kept from previous catalog
    # (Custom Size stays $0; editable inline via EDITABLE_MAT_ITEMS).
    'Vero - Sliding glass door 60" x 80"': 1025.99,
    'Vero - Sliding glass door 72" x 80"': 1114.70,
    'Vero - Sliding glass door 96" x 80"': 1253.09,
    "Vero - Sliding glass door Custom Size": 0,
    # Window Material List — Iter 45: prices pulled from Howard's
    # canonical "Window app price layout page 6-8-26.xls". Same prices
    # as the siding-tab coils (same physical roll product), just exposed
    # again on the windows / mezzo tabs.
    # Iter 45b: dropped "(1 per 5 Sq Siding)" suffix per Howard — the
    # windows quote doesn't measure siding, so the qualifier is noise.
    "Windows - .019 Coil": 161.33,
    "Windows - PVC Trim Coil": 167.08,
    "Windows - Performance G8 Trim Coil": 170.53,
    "Windows - Caulking (per color)": 8.23,
}

for _tier_dict in TIER_PRICES.values():
    _tier_dict.update(WINDOWS_PRICES)


# ---------------------------------------------------------------------------
# WINDOW ADDERS (Iter 36) — per-window-type upgrade options. These are
# rendered as toggleable checkboxes on each window line in the UI; when
# checked, the adder's mat/lab is multiplied by line.qty and folded into
# the line's effective price (services.calc_totals + lib/calc.js).
#
# Format: { section_title: [ {name, unit, mat, lab}, ... ] }
# All adder prices start at $0 — Howard fills them in once he likes the
# layout. Adders are stored on the catalog section so the frontend can
# discover the full list without hard-coding it.
# ---------------------------------------------------------------------------
_DH_SLIDER_ADDERS = [
    {"name": "Tan Interior/Tan Exterior", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Tempered glass", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Obscure Glass", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Grid Pattern", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Integral Nailing Fin", "unit": "each", "mat": 0, "lab": 0},
    {"name": "White Interior/Laminate Exterior", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Woodgrain Interior/White Exterior", "unit": "each", "mat": 0, "lab": 0},
    {"name": "Climatech TG2 Triple Pane .19 U Factor 2 coats LoE", "unit": "each", "mat": 0, "lab": 0},
]

WINDOW_ADDERS = {
    "Vero Double Hung Windows": list(_DH_SLIDER_ADDERS),
    "Vero 2 Lite Slider Windows": list(_DH_SLIDER_ADDERS),
    "Vero 3 Lite Slider Windows": [
        {"name": "Tan Interior/Tan Exterior", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Tempered glass", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Obscure Glass Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Obscure Glass per u.i. over 101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Grid Pattern", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Integral Nailing Fin", "unit": "each", "mat": 0, "lab": 0},
        {"name": "White Interior/Laminate Exterior", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Woodgrain Interior/White Exterior", "unit": "each", "mat": 0, "lab": 0},
    ],
    "Vero Casement Windows": [
        {"name": "Tan Interior/Tan Exterior", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Obscure Glass Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Obscure Glass 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Grid Pattern Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Grid Pattern 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Integral Nailing Fin Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Integral Nailing Fin 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Painted Exterior Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Painted Exterior 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Interior Finish Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Interior Finish 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
    ],
    "Vero Picture Windows": [
        {"name": "Obscure Glass Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Obscure Glass 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Grid Pattern Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Grid Pattern 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Integral Nailing Fin Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Integral Nailing Fin 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Painted Exterior Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Painted Exterior 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Interior Finish Min-101 UI", "unit": "each", "mat": 0, "lab": 0},
        {"name": "Interior Finish 102-108 UI", "unit": "each", "mat": 0, "lab": 0},
    ],
}


# AMI part numbers from Alside's price sheet — used on the printed material list
# so contractors can order/pull materials by SKU. Items without an AMI # (most
# labor-only lines, some accessories) just show blank on the list.
ITEM_AMI = {
    # J-blocks family (Iter 44) — 4 SKUs replacing the legacy "J-blocks,
    # Dryer vents" rollup. Part numbers come from the supplier's price sheet.
    "J-blocks - Split Blocks (82A009)": "82A009",
    "J-blocks - Light Blocks (82A010)": "82A010",
    "J-blocks - UL Blocks (82A017)": "82A017",
    "J-blocks - Jumbo Blocks (82A011)": "82A011",
    'Dryer Vents 4" (82A014)': "82A014",
    # Siding profiles — each gets its own SKU per Alside's price sheet.
    # Iter 34: Standard/Architectural variants share the AMI of their
    # underlying SKU (color is a stocking variant, not a separate part).
    'Conquest Standard color Clap 4.5" .040': "015456",
    'Conquest Standard color Dutch lap 4.5" .040': "015457",
    'Conquest Architectural color Clap 4.5" .040': "015456",
    'Conquest Architectural color Dutch lap 4.5" .040': "015457",
    'Coventry Standard color Clap 4" .042': "016061",
    'Coventry Standard color Dutch lap 4" .042': "016062",
    'Coventry Architectural color Clap 4" .042': "016061",
    'Coventry Architectural color Dutch lap 4" .042': "016062",
    'Coventry Standard color Clap 5" .042': "016066",
    'Coventry Standard color Dutch lap 5" .042': "016067",
    'Coventry Architectural color Clap 5" .042': "016066",
    'Coventry Architectural color Dutch lap 5" .042': "016067",
    'Odyssey Standard color Clap 4" .044': "015406",
    'Odyssey Standard color Dutch Lap 4" .044': "015408",
    'Odyssey Architectural color Clap 4" .044': "015406",
    'Odyssey Architectural color Dutch Lap 4" .044': "015408",
    'Odyssey Standard color Clap 5" .044': "015506",
    'Odyssey Standard color Dutch Lap 5" .044': "015508",
    'Odyssey Architectural color Clap 5" .044': "015506",
    'Odyssey Architectural color Dutch Lap 5" .044': "015508",
    'Charter Oak Standard color Clap 4.5" .046': "015451",
    'Charter Oak Standard color Dutch Lap 4.5" .046': "015452",
    'Charter Oak Architectural color Clap 4.5" .046': "015451",
    'Charter Oak Architectural color Dutch Lap 4.5" .046': "015452",
    'vertical board and batten Standard color 7"': "016021",
    'vertical board and batten Architectural color 7"': "016021",
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
    # Iter 34: accessory color variants share the AMI of their base SKU.
    "Outside corners Standard color": "105644",
    "Outside corners Architectural color": "105644",
    "Inside Corners (Siding) Standard color": "105053",
    "Inside Corners (Siding) Architectural color": "105053",
    '3/4" J-Channel Standard color (2 per Sq of siding)': "105118",
    '3/4" J-Channel Architectural color (2 per Sq of siding)': "105118",
    '1/2" J-Channel (2 per Sq of siding)': "105114",
    "Finish Trim Standard color": "105200",
    "Finish Trim Architectural color": "105200",
    "Starter": "107361",
    "House Wrap": "646662A0",
    "RainDrop House Wrap": "646686",
    '3/8" Fan Fold': "668363",
    '1 1/4" Trim Nails': "780052",
    "Caulking (per color)": "701170",
    'Charter Oak Soffit Standard color': "105020",
    'Charter Oak Soffit Architectural color': "105020",
    'Greenbriar Soffit': "106022",
    'T2 Soffit': "105007",
    ".019 Coil (1 per 50' fascia)": "103954",
    "PVC Trim Coil (1 per 50' fascia)": "103956",
    "Performance G8 Trim Coil (1 per 50' fascia)": "103960",
    '3/4" Soffit J-Channel (Charter Oak) Standard color': "105118",
    '3/4" Soffit J-Channel (Charter Oak) Architectural color': "105118",
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
    # Windows tab — Vero product line lives entirely on its own. Iter 36:
    # each Vero window type is now its own section with per-type adders.
    "Vero Windows Custom Quote": ["windows"],
    "Vero Double Hung Windows": ["windows"],
    "Vero 2 Lite Slider Windows": ["windows"],
    "Vero 3 Lite Slider Windows": ["windows"],
    "Vero Casement Windows": ["windows"],
    "Vero Picture Windows": ["windows"],
    "Window Installation": ["windows", "mezzo"],
    "Vero Sliding Glass Doors": ["windows"],
    "Sliding Glass Door Install": ["windows", "mezzo"],
    "Window Material List": ["windows", "mezzo"],
    "Window Exterior Trim Work": ["windows", "mezzo"],
    "Window Interior Trim Work": ["windows", "mezzo"],
    "Window Misc.": ["windows", "mezzo"],
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
        section = {
            "title": title,
            "ascend": ascend,
            "product_lines": product_lines_for(title),
            "items": items,
        }
        # Iter 36: window-product sections carry per-type adders. Frontend
        # discovers available adders via this field and renders checkboxes
        # under each window line. Adders are NOT line items themselves.
        if title in WINDOW_ADDERS:
            section["adders"] = [
                {"name": a["name"], "unit": a["unit"],
                 "mat": float(a["mat"]), "lab": float(a["lab"])}
                for a in WINDOW_ADDERS[title]
            ]
        out.append(section)
    return out


# Default tier for new companies — newest/unknown contractors get our most expensive
# rate; you bump them down to better tiers (Contractor / Builder-Dealer / one-opp)
# as they earn it.
DEFAULT_TIER_NAME = "whole-sale"

# Legacy export — keeps backward compat with any code that still reads DEFAULT_SECTIONS
DEFAULT_SECTIONS = build_tier_sections(DEFAULT_TIER_NAME)

# All tier names, in display order
TIER_NAMES = ["one-opp", "Builder-Dealer", "Contractor", "whole-sale"]
