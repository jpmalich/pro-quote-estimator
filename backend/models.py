"""All Pydantic request/response models live here."""
from typing import List, Optional
from pydantic import BaseModel, EmailStr


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None
    company_name: Optional[str] = None
    invite_code: Optional[str] = None
    signup_code: Optional[str] = None  # required to create a new company


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class CatalogItem(BaseModel):
    name: str
    unit: str
    mat: float
    lab: float
    ami_part: Optional[str] = None  # Supplier SKU for the material list / ordering


class CatalogSection(BaseModel):
    title: str
    ascend: bool = False
    # Which tab(s) this section belongs to in the multi-product estimator.
    # Values: "vinyl" | "ascend" | "lp_smart". Sections shared between
    # product lines (e.g. Siding Accessories, Soffit, Gutter, Tear-Off,
    # Misc Labor) appear in multiple tabs.
    product_lines: List[str] = ["vinyl", "ascend"]
    items: List[CatalogItem]


class CatalogOverridesIn(BaseModel):
    overrides: dict  # { "<section>::<name>": {"lab"?: float} }


class TierUpdate(BaseModel):
    name: Optional[str] = None
    sections: Optional[List[CatalogSection]] = None


class CompanyTierAssign(BaseModel):
    price_tier_id: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None  # set "" or None to clear
    quote_footer_enabled: Optional[bool] = None


class BrandingUpdate(BaseModel):
    supplier_name: Optional[str] = None
    supplier_tagline: Optional[str] = None
    supplier_logo_url: Optional[str] = None
    default_pricing_mode: Optional[str] = None


class InviteContractorIn(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    app_url: Optional[str] = None  # Frontend origin (e.g. https://app.pro-quotes.com)
    personal_note: Optional[str] = None  # Optional message from supplier admin


class EstimateLineAdder(BaseModel):
    """Per-line upgrade adder (windows only currently). When set on a
    line, its mat/lab is multiplied by the adder's own qty (NOT line.qty)
    and added to the line's subtotal — lets a 10-window line have only
    3 windows with Tempered glass + 4 windows with Grid Pattern, etc.
    See services.calc_totals for the math."""
    name: str
    mat: float = 0
    lab: float = 0
    qty: float = 0


class EstimateLine(BaseModel):
    section: str
    name: str
    unit: str
    qty: float = 0
    mat: float = 0
    lab: float = 0
    ami_part: Optional[str] = None  # Snapshotted at quote time so re-runs are reproducible
    # Which "tab" (product-line option) in the estimator this line belongs to.
    # "vinyl" (default — backward compat), "ascend", "lp_smart", or "windows".
    # Lets one estimate carry parallel option sets — e.g. Vinyl vs.
    # Ascend vs. LP Smart Siding — so the homeowner can compare them on
    # one quote.
    tab: str = "vinyl"
    # Iter 36: selected per-line adders (windows-tab only currently).
    # Stored as a list rather than a flag-per-adder dict so new adders
    # added to the catalog don't require an estimate-schema migration.
    adders: List[EstimateLineAdder] = []


class MiscLine(BaseModel):
    desc: str = ""
    mat: float = 0
    lab: float = 0
    tab: str = "vinyl"  # same tab semantics as EstimateLine
    # Optional section anchor — empty string means the row appears under
    # the default Misc. Labor & Material / Misc. Labor Only sections
    # (back-compat). When set (e.g. "Window Installation"), the row
    # appears inline under that catalog section as an "Add custom line"
    # entry. Lets contractors bill freeform mat+lab inside any whitelisted
    # section without polluting the Misc. catch-all.
    section: str = ""


class EstimateIn(BaseModel):
    customer_name: str = ""
    address: str = ""
    estimate_number: str = ""
    estimate_date: str = ""
    estimator: str = ""
    notes: str = ""
    # Estimate-level color choices (one per material family). Print on the
    # material list so the supplier knows exactly which colors to pull.
    siding_color: str = ""
    ascend_color: str = ""
    accessories_color: str = ""
    outside_corner_color: str = ""
    soffit_fascia_color: str = ""
    window_wrap_color: str = ""
    # Aluminum gutter/downspout color — separate field since gutter coil
    # ships in its own palette (aluminum coil colors, not vinyl).
    gutter_color: str = ""
    # Window product colors (Windows tab) — appear on the material list so
    # the installer pulls the right Vero color stock for frames + interior
    # + exterior trim. The original `window_*_color` fields are the Vero
    # palette; `mezzo_*_color` are added in Iter 38 for the Mezzo line.
    window_frame_color: str = ""
    window_interior_color: str = ""
    window_exterior_color: str = ""
    mezzo_interior_color: str = ""
    mezzo_exterior_color: str = ""
    waste_pct: float = 0
    tax_enabled: bool = True
    tax_rate: float = 7.0
    margin_pct: float = 30.0
    pricing_mode: Optional[str] = None  # "margin" | "markup"; falls back to supplier default
    # Estimate kind — controls which workspace the estimate belongs to.
    # "siding" (default, back-compat for existing estimates) shows in the
    # siding dashboard with all siding tabs visible; "windows" shows in the
    # dedicated windows dashboard with only the Windows tab visible.
    kind: str = "siding"
    # Iter 36 (windows-kind only): install method drives which install
    # line ("Window DH/Slider - Pocket Install" vs Full Fin vs Block
    # Frame) gets the auto-synced qty. Empty string = contractor manually
    # picks the install row.
    install_method: str = ""
    # Iter 36 (windows-kind only): true when the home was built before
    # 1978 and Lead-Safe RRP is required. Auto-fills Lead Safe Test Fee
    # (qty=1) + Lead Safe Installation Practices (qty=total window count).
    home_pre_1978: bool = False
    lines: List[EstimateLine] = []
    misc_labor: List[MiscLine] = []
    misc_material: List[MiscLine] = []
    # Iter 37: Mezzo W×H-driven openings. Each entry is one quoted
    # opening (a single window on the customer's home). Lives in its
    # own list rather than under `lines` because the data shape is
    # different (W/H drive the price via bucket lookup; adder prices
    # depend on size). See routes/mezzo.py for catalog lookup.
    mezzo_openings: List["MezzoOpening"] = []
    # Iter 39: Vero W×H-driven openings (Phase 4). Same shape as Mezzo
    # but adds a `sister_color` selector + `glass_package` + optional
    # `tempered_upcharge` + `premium_options[]`. Patio Door variant uses
    # `model` instead of width/height.
    vero_openings: List["VeroOpening"] = []
    photos: List[str] = []
    status_label: str = "draft"


class MezzoOpening(BaseModel):
    """One quoted Mezzo window opening. Width + height drive the
    United Inches (UI) which snaps to a bucket on Mezzo's per-size
    price matrix. Per-opening adders carry their own qty + computed
    cost at save time so material-list / PDF rendering stays cheap."""
    id: str  # UUID; frontend-generated so optimistic UI works
    product_type: str  # e.g. "Mezzo Double Hung"
    label: str = ""    # optional "Kitchen — west" annotation
    width: float = 0   # inches
    height: float = 0  # inches
    qty: float = 1
    # Snapshotted base price (per-window mat from the bucket lookup at
    # save time). Lets the backend compute totals without re-resolving
    # the catalog matrix.
    base_mat: float = 0
    # Resolved bucket label (e.g. "32-73 UI") snapshotted at save time
    # for material-list / PDF rendering.
    bucket_label: str = ""
    # Selected adders. We reuse EstimateLineAdder so calc_totals can
    # treat openings the same way it treats line.adders, but `mat`
    # here is the PER-OPENING cost (sqft adders are pre-computed by
    # frontend at toggle time; flat adders are looked up by bucket).
    adders: List[EstimateLineAdder] = []


class VeroOpening(BaseModel):
    """One quoted Vero window opening. UI-bucket products use width +
    height to derive United Inches → bucket → base price; the Patio Door
    uses a fixed `model` instead. Sister color (e.g. White/White vs
    Tan/Tan) selects the price column inside the bucket; glass package +
    tempered + premium options are independently-priced adders snapshotted
    at save time so PDF rendering stays cheap."""
    id: str  # UUID; frontend-generated so optimistic UI works
    product_type: str  # e.g. "Vero Double Hung"
    sizing: str = "ui_bucket"  # or "fixed_model" (Patio Door)
    label: str = ""
    # ui_bucket fields
    width: float = 0
    height: float = 0
    # fixed_model fields
    model: str = ""
    qty: float = 1
    # Color + glass selection
    sister_color: str = ""
    glass_package: str = ""
    tempered_upcharge: str = ""
    premium_options: List[str] = []
    # Snapshots (computed at save time so PDF / list rendering is cheap)
    bucket_label: str = ""
    base_mat: float = 0          # per-window base
    glass_mat: float = 0         # per-window glass package adder
    tempered_mat: float = 0      # per-window tempered upcharge
    premium_mat: float = 0       # SUM of all selected premium options (per window)


EstimateIn.model_rebuild()


class EmailQuoteIn(BaseModel):
    recipient_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    html_quote: str
    accept_token: Optional[str] = None  # client-generated UUID4 for the public accept link


class CustomerAcceptIn(BaseModel):
    note: Optional[str] = None
