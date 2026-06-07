"""Mezzo (3000 Series) replacement-window catalog.

Distinct from the Vero catalog in `catalog_seed.py` because Mezzo pricing
is a per-tier × per-size-bucket × per-adder matrix (Vero adders are flat
per-product-type). Lives in its own module so it can grow to cover
Fusion / Preservation / Sovereign without crowding the siding catalog.

Phase 1 (Iter 37): Mezzo Double Hung only. Howard will fill in the
per-tier prices via the Pricing Admin once he likes the W×H entry UX.

Size buckets are taken straight from the Mezzo wholesale Excel — each
bucket lists the min/max UI (United Inches = width + height). Tempered
Full is the only sqft-based adder: cost = $9.18 × (W × H / 144). All
other adders are flat per-window at the bucket's listed price.
"""
from typing import Optional

MEZZO_TIER_NAMES = ["whole-sale", "Contractor", "Builder-Dealer", "one-opp"]

# Per-product-type size buckets. Each list is ordered by min_ui ascending
# and exactly matches Howard's Mezzo wholesale Excel.
MEZZO_BUCKETS = {
    "Mezzo Double Hung": [
        {"label": "32-73 UI",   "min_ui": 32,  "max_ui": 73},
        {"label": "74-83 UI",   "min_ui": 74,  "max_ui": 83},
        {"label": "84-93 UI",   "min_ui": 84,  "max_ui": 93},
        {"label": "94-101 UI",  "min_ui": 94,  "max_ui": 101},
        {"label": "102-103 UI", "min_ui": 102, "max_ui": 103},
        {"label": "104-105 UI", "min_ui": 104, "max_ui": 105},
        {"label": "106-107 UI", "min_ui": 106, "max_ui": 107},
        {"label": "108-109 UI", "min_ui": 108, "max_ui": 109},
        {"label": "110-111 UI", "min_ui": 110, "max_ui": 111},
        {"label": "112-120 UI", "min_ui": 112, "max_ui": 120},
        {"label": "121-126 UI", "min_ui": 121, "max_ui": 126},
        {"label": "127-132 UI", "min_ui": 127, "max_ui": 132},
        {"label": "133-148 UI", "min_ui": 133, "max_ui": 148},
    ],
    "Mezzo 2-Lite Slider": [
        {"label": "30-73 UI",   "min_ui": 30,  "max_ui": 73},
        {"label": "74-83 UI",   "min_ui": 74,  "max_ui": 83},
        {"label": "84-93 UI",   "min_ui": 84,  "max_ui": 93},
        {"label": "94-101 UI",  "min_ui": 94,  "max_ui": 101},
        {"label": "102-103 UI", "min_ui": 102, "max_ui": 103},
        {"label": "104-105 UI", "min_ui": 104, "max_ui": 105},
        {"label": "106-107 UI", "min_ui": 106, "max_ui": 107},
        {"label": "108-109 UI", "min_ui": 108, "max_ui": 109},
        {"label": "110-111 UI", "min_ui": 110, "max_ui": 111},
        {"label": "112-120 UI", "min_ui": 112, "max_ui": 120},
        {"label": "121-132 UI", "min_ui": 121, "max_ui": 132},
        {"label": "133-148 UI", "min_ui": 133, "max_ui": 148},
        {"label": "149-156 UI", "min_ui": 149, "max_ui": 156},
    ],
    "Mezzo 3-Lite Slider": [
        {"label": "50-73 UI",   "min_ui": 50,  "max_ui": 73},
        {"label": "74-83 UI",   "min_ui": 74,  "max_ui": 83},
        {"label": "84-93 UI",   "min_ui": 84,  "max_ui": 93},
        {"label": "94-101 UI",  "min_ui": 94,  "max_ui": 101},
        {"label": "102-108 UI", "min_ui": 102, "max_ui": 108},
        {"label": "109-120 UI", "min_ui": 109, "max_ui": 120},
        {"label": "121-132 UI", "min_ui": 121, "max_ui": 132},
        {"label": "133-144 UI", "min_ui": 133, "max_ui": 144},
        {"label": "145-156 UI", "min_ui": 145, "max_ui": 156},
        {"label": "157-174 UI", "min_ui": 157, "max_ui": 174},
        {"label": "175-192 UI", "min_ui": 175, "max_ui": 192},
    ],
    "Mezzo Picture": [
        {"label": "21-63 UI",   "min_ui": 21,  "max_ui": 63},
        {"label": "64-73 UI",   "min_ui": 64,  "max_ui": 73},
        {"label": "74-83 UI",   "min_ui": 74,  "max_ui": 83},
        {"label": "84-93 UI",   "min_ui": 84,  "max_ui": 93},
        {"label": "94-101 UI",  "min_ui": 94,  "max_ui": 101},
        {"label": "102-105 UI", "min_ui": 102, "max_ui": 105},
        {"label": "106-111 UI", "min_ui": 106, "max_ui": 111},
        {"label": "112-120 UI", "min_ui": 112, "max_ui": 120},
        {"label": "121-130 UI", "min_ui": 121, "max_ui": 130},
        {"label": "131-140 UI", "min_ui": 131, "max_ui": 140},
        {"label": "141-154 UI", "min_ui": 141, "max_ui": 154},
    ],
}

# Adder name lists per product type. Double Hung has the full 8-option set;
# Sliders + Picture share a tighter 5-option set (per Howard's Excel).
_DH_ADDER_NAMES = [
    "Extruded Beige or Clay",
    "ClimaTech Plus - 9E",
    "ClimaTech TG2 Plus",
    "Obscure Full",
    "Tempered Full",
    'NAILFIN 1 3/8" W/ J',
    "Black Exterior Paint",
    "Cherry Laminate",
]
_SLIDER_PICTURE_ADDER_NAMES = [
    "Extruded Beige or Clay",
    "ClimaTech Plus - 9E",
    'Grid - 1" Contour Full',
    "Obscure Full",
    "Tempered Full",
]

MEZZO_ADDER_NAMES = {
    "Mezzo Double Hung": _DH_ADDER_NAMES,
    "Mezzo 2-Lite Slider": _SLIDER_PICTURE_ADDER_NAMES,
    "Mezzo 3-Lite Slider": _SLIDER_PICTURE_ADDER_NAMES,
    "Mezzo Picture": _SLIDER_PICTURE_ADDER_NAMES,
}

# `Tempered Full` is the only sqft-rate adder across the entire Mezzo
# line. Same $9.18/sqft rate per Howard's footer ("Tempering per Sq Ft").
TEMPERING_PER_SQFT_RATE = 9.18


def _zero_priced_by_bucket(buckets):
    return {b["label"]: 0.0 for b in buckets}


def _build_product_type(name, buckets, adder_names):
    """Construct the product-type dict with zero-priced tier matrices for
    Phase 1. Pricing Admin fills in real values per tier later."""
    tier_prices = {tier: _zero_priced_by_bucket(buckets) for tier in MEZZO_TIER_NAMES}
    adders = []
    for ad_name in adder_names:
        if ad_name == "Tempered Full":
            adders.append({"name": ad_name, "kind": "sqft", "rate": TEMPERING_PER_SQFT_RATE})
        else:
            adders.append({
                "name": ad_name,
                "kind": "flat",
                "tier_prices": {tier: _zero_priced_by_bucket(buckets) for tier in MEZZO_TIER_NAMES},
            })
    return {"buckets": buckets, "tier_prices": tier_prices, "adders": adders}


# All Mezzo product types Howard's tool currently covers. Mezzo has no
# casement (Howard confirmed); future Fusion/Preservation/Sovereign will
# get their own dicts in sibling files.
MEZZO_PRODUCT_TYPES = {
    name: _build_product_type(name, MEZZO_BUCKETS[name], MEZZO_ADDER_NAMES[name])
    for name in ["Mezzo Double Hung", "Mezzo 2-Lite Slider", "Mezzo 3-Lite Slider", "Mezzo Picture"]
}


def find_bucket(product_type: str, ui: float) -> Optional[dict]:
    """Return the bucket whose min_ui <= ui <= max_ui, or None."""
    pt = MEZZO_PRODUCT_TYPES.get(product_type)
    if not pt:
        return None
    for b in pt["buckets"]:
        if b["min_ui"] <= ui <= b["max_ui"]:
            return b
    return None


def base_price(product_type: str, tier: str, ui: float) -> float:
    """Look up the base mat price for an opening at this UI on the
    given tier. Returns 0 if out of bucket range."""
    bucket = find_bucket(product_type, ui)
    if not bucket:
        return 0.0
    pt = MEZZO_PRODUCT_TYPES[product_type]
    return float(pt["tier_prices"].get(tier, {}).get(bucket["label"], 0.0))


def adder_price(product_type: str, adder_name: str, tier: str, width: float, height: float) -> float:
    """Look up adder price for an opening. For 'sqft' adders, returns
    rate × (W × H / 144). For 'flat' adders, returns the bucket price."""
    pt = MEZZO_PRODUCT_TYPES.get(product_type)
    if not pt:
        return 0.0
    ad = next((a for a in pt["adders"] if a["name"] == adder_name), None)
    if not ad:
        return 0.0
    if ad["kind"] == "sqft":
        sqft = (float(width) * float(height)) / 144.0
        return float(ad.get("rate", 0)) * sqft
    ui = float(width) + float(height)
    bucket = find_bucket(product_type, ui)
    if not bucket:
        return 0.0
    return float(ad["tier_prices"].get(tier, {}).get(bucket["label"], 0.0))


def catalog_for_tier(tier: str) -> dict:
    """Return a frontend-friendly catalog snapshot for a single tier.
    Shape:
      { "product_types": [
          { "name": "Mezzo Double Hung",
            "buckets": [...],
            "base_prices": {bucket_label: mat},
            "adders": [{name, kind, prices_by_bucket | rate}, ...] }
        ]
      }
    """
    out = []
    for name, pt in MEZZO_PRODUCT_TYPES.items():
        adders_out = []
        for a in pt["adders"]:
            if a["kind"] == "sqft":
                adders_out.append({"name": a["name"], "kind": "sqft", "rate": float(a["rate"])})
            else:
                adders_out.append({
                    "name": a["name"],
                    "kind": "flat",
                    "prices_by_bucket": {
                        b["label"]: float(a["tier_prices"].get(tier, {}).get(b["label"], 0))
                        for b in pt["buckets"]
                    },
                })
        out.append({
            "name": name,
            "buckets": pt["buckets"],
            "base_prices": {
                b["label"]: float(pt["tier_prices"].get(tier, {}).get(b["label"], 0))
                for b in pt["buckets"]
            },
            "adders": adders_out,
        })
    return {"product_types": out}
