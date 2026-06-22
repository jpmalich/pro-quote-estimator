"""Iter 36 pricing-refactor parity test.

Locks the post-refactor IDENTICAL_PRICES / ZERO_PRICED / PER_TIER_PRICES
structures (in catalog_seed.py) to the historical TIER_PRICES values
captured at the time of the refactor. If anyone later edits a tier
price WITHOUT touching the right source-of-truth dict — or if the
computed TIER_PRICES view ever drifts — this test fails.

Run with: cd /app/backend && pytest tests/test_pricing_parity.py
"""
import pytest

from catalog_seed import (
    TIER_PRICES,
    IDENTICAL_PRICES,
    ZERO_PRICED,
    PER_TIER_PRICES,
)

TIERS = ("whole-sale", "Contractor", "Builder-Dealer", "one-opp")

# Spot-check values that MUST stay constant. Picked to cover one item from
# each shape bucket + one from LP and one from Windows (which are still
# merged in via their own blocks below TIER_PRICES).
EXPECTED = [
    # name, {tier: price}
    (
        'Charter Oak Standard color Clap 4.5" .046',
        {"whole-sale": 151.31, "Contractor": 136.22, "Builder-Dealer": 125.46, "one-opp": 113.57},
    ),
    (
        "Starter",
        {"whole-sale": 7.46, "Contractor": 7.46, "Builder-Dealer": 7.46, "one-opp": 7.46},
    ),
    (
        'Pelican Bay Shakes 9"',
        {"whole-sale": 419.94, "Contractor": 419.94, "Builder-Dealer": 419.94, "one-opp": 419.94},
    ),
    (
        "Tear-Off",
        {"whole-sale": 0, "Contractor": 0, "Builder-Dealer": 0, "one-opp": 0},
    ),
    (
        # Iter 36: all Vero window prices reset to $0 — Howard will fill
        # them in via the pricing admin once he likes the new per-window-
        # type layout. Track Double Hung 0-101 UI as the canonical sample.
        "Vero - Double Hung 0-101 UI",
        {"whole-sale": 0, "Contractor": 0, "Builder-Dealer": 0, "one-opp": 0},
    ),
    (
        # Iter 67: LP renamed to BlueLinx names + per-tier margin pricing.
        # 8" Lap cost $21.69/board × margin divisors → 4-tier price grid.
        # Lap also flipped from SQ → PCS unit (price is per 16' board).
        '38 Series Lap 3/8" x 8" x 16\'',
        {"whole-sale": 33.37, "Contractor": 30.99, "Builder-Dealer": 28.92, "one-opp": 27.11},
    ),
]


@pytest.mark.parametrize("name,prices", EXPECTED)
def test_spot_check_prices_unchanged(name, prices):
    for tier, want in prices.items():
        got = TIER_PRICES[tier].get(name)
        assert got == want, f"{tier}/{name}: got {got}, want {want}"


def test_all_tiers_have_same_item_set():
    """Refactor invariant — every item appears on every tier."""
    keys = {t: set(TIER_PRICES[t].keys()) for t in TIERS}
    base = keys["whole-sale"]
    for t in TIERS:
        assert keys[t] == base, f"Tier {t} key set differs from whole-sale"


def test_identical_prices_truly_identical():
    """Any item in IDENTICAL_PRICES must produce the SAME value on all 4 tiers."""
    for name, want in IDENTICAL_PRICES.items():
        for t in TIERS:
            assert TIER_PRICES[t][name] == want


def test_zero_priced_are_zero():
    """Any item in ZERO_PRICED must produce $0 on every tier."""
    for name in ZERO_PRICED:
        for t in TIERS:
            assert TIER_PRICES[t][name] == 0


def test_per_tier_prices_round_trip():
    """For items in PER_TIER_PRICES, the computed view must equal the block."""
    for name, block in PER_TIER_PRICES.items():
        for t in TIERS:
            assert TIER_PRICES[t][name] == block[t]


def test_no_overlap_between_buckets():
    """An item must live in exactly ONE of the three buckets."""
    ident = set(IDENTICAL_PRICES.keys())
    zero = ZERO_PRICED
    per = set(PER_TIER_PRICES.keys())
    assert not (ident & zero), f"Overlap ident/zero: {ident & zero}"
    assert not (ident & per), f"Overlap ident/per_tier: {ident & per}"
    assert not (zero & per), f"Overlap zero/per_tier: {zero & per}"
