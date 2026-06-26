"""Iter 78x — LP catalog regression tests.

Locks in the LP supplier-sheet alignment Howard locked in on 2026-02-13:
  • 4 LP SKUs were dropped (LP discontinued them).
  • 1 new SKU (Trim Coil Aluminum 24" x 50') was added at $156.25 cost.
  • All LP rows use the gross-margin formula `sell = cost / (1 - margin)`
    with tier margins 35% / 30% / 25% / 20%.

These tests guard against accidental re-introduction of the 4 dropped SKUs
or a margin formula regression on the LP_PRICES_BY_TIER projection.
"""
import pytest

from catalog_seed import (
    LP_COSTS,
    LP_MARGIN_PCT,
    LP_PRICES_BY_TIER,
    SECTION_LAYOUT,
    TIER_PRICES,
)


DROPPED_LP_SKUS = {
    '38 Series Lap 3/8" x 6" x 16\'',
    '38 Series Soffit 12 x 16 Vented',
    '38 Series Soffit 12 x 16 Closed',
    '38 Series Soffit 16 x 16 Closed',
}

NEW_TRIM_COIL = 'Trim Coil Aluminum 24" x 50\''


def _all_layout_names():
    names = set()
    for _section_title, _flat, items in SECTION_LAYOUT:
        names.update(items)
    return names


def test_lp_dropped_skus_not_in_layout():
    layout_names = _all_layout_names()
    for sku in DROPPED_LP_SKUS:
        assert sku not in layout_names, (
            f"LP SKU '{sku}' was dropped from supplier sheet in Iter 78x — "
            f"it must NOT be in SECTION_LAYOUT."
        )


def test_lp_dropped_skus_not_in_lp_costs():
    for sku in DROPPED_LP_SKUS:
        assert sku not in LP_COSTS, (
            f"LP SKU '{sku}' was dropped — remove from LP_COSTS."
        )


def test_lp_dropped_skus_not_in_tier_prices():
    for sku in DROPPED_LP_SKUS:
        for tier_name, prices in TIER_PRICES.items():
            assert sku not in prices, (
                f"LP SKU '{sku}' was dropped — must not appear in "
                f"TIER_PRICES['{tier_name}']."
            )


def test_new_trim_coil_aluminum_present():
    layout_names = _all_layout_names()
    assert NEW_TRIM_COIL in layout_names, (
        f"'{NEW_TRIM_COIL}' must be in SECTION_LAYOUT (LP Siding Accessories)."
    )
    assert NEW_TRIM_COIL in LP_COSTS, (
        f"'{NEW_TRIM_COIL}' must be in LP_COSTS at the supplier-sheet cost."
    )
    assert LP_COSTS[NEW_TRIM_COIL] == 156.25, (
        f"Trim Coil Aluminum cost basis should be $156.25 per supplier sheet."
    )


def test_lp_margin_formula_per_tier():
    """sell = cost / (1 - margin%) — locked in for every LP cost row."""
    expected_divisor = {
        "whole-sale": 0.65,        # 35% margin
        "Contractor": 0.70,        # 30%
        "Builder-Dealer": 0.75,    # 25%
        "one-opp": 0.80,           # 20%
    }
    for tier, divisor in expected_divisor.items():
        for item, cost in LP_COSTS.items():
            expected = round(cost / divisor, 2)
            actual = LP_PRICES_BY_TIER[tier][item]
            assert actual == expected, (
                f"LP {tier} / {item}: expected ${expected:.2f}, got ${actual:.2f}"
            )


def test_lp_margin_pct_lookup_matches_divisors():
    """LP_MARGIN_PCT (exposed for UI) must agree with the divisor table."""
    expected = {"whole-sale": 35, "Contractor": 30, "Builder-Dealer": 25, "one-opp": 20}
    assert LP_MARGIN_PCT == expected


def test_trim_coil_aluminum_tier_prices():
    """Spot-check the new SKU's computed tier prices."""
    expected = {
        "whole-sale": 240.38,
        "Contractor": 223.21,
        "Builder-Dealer": 208.33,
        "one-opp": 195.31,
    }
    for tier, want in expected.items():
        got = LP_PRICES_BY_TIER[tier][NEW_TRIM_COIL]
        assert abs(got - want) < 0.05, (
            f"Trim Coil {tier}: expected ${want:.2f}, got ${got:.2f}"
        )
