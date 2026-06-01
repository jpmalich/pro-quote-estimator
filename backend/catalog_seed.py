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
    ("Ascend Cladding/Accessories", True, [
        'Ascend Composite Lap Siding 7"', 'Ascend Composite B&B 12" (add 30% Waste)',
        'Ascend 3.5" Outside Corner  - MATTE', 'Ascend 5.5" Outside Corner  - MATTE',
        "Inside Corners", "Ascend - 5.5\" Trim  (16' length)",
        "Ascend - J - Channel  (2 per Sq of siding)",
        "ASCEND Finish Trim", "Ascend - Starter",
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
    "Vinyl Siding": ["vinyl"],
    "Ascend Cladding/Accessories": ["ascend"],
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
