"""ISS Siding catalog — single-tier price book sourced from Howard's
`2026_Siding_Pricing.xlsx`.

Unlike the multi-tier `catalog_seed.py` used by Vinyl / Ascend / LP Smart
estimates, ISS is single-tier with a single combined Material+Labor
price per line. The estimator UI shows one "Price" column (no separate
mat/lab split).

Each section is `(title, [(name, unit, price)])`. The serialized API
shape exposes price as the line's `mat` value so the existing
qty × price math reuses the same client-side calc helpers.
"""

ISS_SECTIONS = [
    ("Install Vinyl Siding", [
        ("Conquest",                                        "sq",   451.81),
        ("Vertical board and batten",                       "sq",   548.38),
        ("Odyssey (standard colors)",                       "sq",   478.83),
        ("Charter Oak (standard colors)",                   "sq",   504.24),
        ("Ascend Composite",                                "sq",   662.06),
        ("Prodigy (standard colors)",                       "sq",   671.43),
        ("Architectural color upcharge",                    "sq",    49.89),
        ("Tear-off",                                        "sq",    26.75),
        ("Wood shake tear off (requires a dumpster)",       "sq",   100.31),
        ("Clean up / haul away job debris",                 "job",  334.38),
        ("Dumpster",                                        "ea",   588.50),
    ]),
    ("Vinyl Soffit with Siding", [
        ("Soffit & fascia up to 13\" wide",                 "lf",    14.44),
        ("Soffit & fascia 13\"-30\" wide",                  "lf",    17.00),
        ("Fascia/rake or frieze up to 8\" coverage",        "lf",     6.13),
        ("Fascia/rake or frieze only over 8\" coverage",    "lf",     7.75),
    ]),
    ("Vinyl Soffit without Siding", [
        ("Soffit & fascia up to 13\" wide",                 "lf",    17.88),
        ("Soffit & fascia 13\"-30\" wide",                  "lf",    20.06),
        ("Fascia/rake only up to 8\" coverage",             "lf",     7.88),
        ("Fascia/rake only over 8\" coverage",              "lf",     9.56),
    ]),
    ("Porch Ceiling", [
        ("With or without siding",                          "sq ft",  7.45),
        ("Wrap porch beam",                                 "lf",    12.45),
    ]),
    ("Seamless Gutter with Siding", [
        ("Gutter",                                          "lf",    12.80),
        ("Downspout",                                       "lf",     6.18),
        ("Miters",                                          "ea",    25.00),
        ("Gutter guard (USA Shurflo)",                      "lf",     6.52),
    ]),
    ("Seamless Gutter without Siding", [
        ("Gutter",                                          "lf",    15.30),
        ("Downspout",                                       "lf",     7.20),
        ("Miters",                                          "ea",    25.00),
        ("Gutter guard (USA Shurflo)",                      "lf",     6.52),
    ]),
    ("Misc. Labor Only", [
        ("R&R gutter",                                      "lf",     4.28),
        ("R&R downspout",                                   "lf",     2.15),
    ]),
    ("Misc. Labor and Material", [
        ("Shakes and scallops",                             "sq",   889.44),
        ("Cap windows",                                     "ea",    98.44),
        ("Capping general",                                 "lf",     3.98),
        ("Cap window headers only",                         "ea",    25.76),
        ("Cap entry door",                                  "ea",   107.25),
        ("Cap patio door",                                  "ea",    99.24),
        ("Cap single garage door",                          "ea",   138.00),
        ("Build out for windows w/furring (includes capping)", "ea", 127.63),
        ("J-blocks, dryer vents",                           "ea",    48.09),
        ("Amowrap weather barrier",                         "sq",    35.99),
        ("Shutters (louvered, raised panel) standard sizes","pr",   142.78),
        ("Gable vents (square, rectangle)",                 "ea",   102.53),
        ("Gable vents (round, octagon)",                    "ea",   115.36),
        ("Fascia return",                                   "ea",    17.50),
        ("Bird box",                                        "ea",    28.75),
        ("Flashing",                                        "lf",     3.98),
    ]),
    ("Misc.", [
        ("Fullback in place of 1/4\" insulation",           "sq",    93.63),
        ("Replace 1x4 lumber",                              "lf",     7.15),
        ("Replace 1x6 lumber",                              "lf",     8.63),
        ("Replace 1x8 lumber",                              "lf",    10.04),
    ]),
]


# Line items Howard wants visually flagged as "common adders" — these are
# the lines a contractor most often forgets to include on an ISS quote.
# Keyed by (section title, item name) since a few names (e.g. "Gutter",
# "Downspout", "Soffit & fascia up to 13\" wide") repeat across sections
# and only one of them should carry the hint icon.
ISS_TIP_KEYS: set[tuple[str, str]] = {
    ("Install Vinyl Siding",        "Charter Oak (standard colors)"),
    ("Install Vinyl Siding",        "Architectural color upcharge"),
    ("Install Vinyl Siding",        "Tear-off"),
    ("Install Vinyl Siding",        "Clean up / haul away job debris"),
    ("Install Vinyl Siding",        "Dumpster"),
    ("Vinyl Soffit with Siding",    "Soffit & fascia up to 13\" wide"),
    ("Seamless Gutter with Siding", "Gutter"),
    ("Seamless Gutter with Siding", "Downspout"),
    ("Misc. Labor and Material",    "Cap windows"),
    ("Misc. Labor and Material",    "Cap entry door"),
    ("Misc. Labor and Material",    "J-blocks, dryer vents"),
    ("Misc. Labor and Material",    "Gable vents (square, rectangle)"),
    ("Misc. Labor and Material",    "Cap patio door"),
    ("Misc. Labor and Material",    "Cap single garage door"),
}


def build_iss_catalog() -> dict:
    """Return the API-shape catalog payload."""
    sections = []
    for title, rows in ISS_SECTIONS:
        sections.append({
            "title": title,
            "items": [
                {
                    "name": name,
                    "unit": unit,
                    "price": price,
                    "tip": (title, name) in ISS_TIP_KEYS,
                }
                for name, unit, price in rows
            ],
        })
    return {"sections": sections}
