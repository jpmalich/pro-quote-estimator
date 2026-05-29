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


class EstimateLine(BaseModel):
    section: str
    name: str
    unit: str
    qty: float = 0
    mat: float = 0
    lab: float = 0
    ami_part: Optional[str] = None  # Snapshotted at quote time so re-runs are reproducible


class MiscLine(BaseModel):
    desc: str = ""
    mat: float = 0
    lab: float = 0


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
    accessories_color: str = ""
    outside_corner_color: str = ""
    soffit_fascia_color: str = ""
    window_wrap_color: str = ""
    waste_pct: float = 0
    tax_enabled: bool = True
    tax_rate: float = 7.0
    margin_pct: float = 30.0
    pricing_mode: Optional[str] = None  # "margin" | "markup"; falls back to supplier default
    lines: List[EstimateLine] = []
    misc_labor: List[MiscLine] = []
    misc_material: List[MiscLine] = []
    photos: List[str] = []
    status_label: str = "draft"


class EmailQuoteIn(BaseModel):
    recipient_email: EmailStr
    subject: Optional[str] = None
    message: Optional[str] = None
    html_quote: str
    accept_token: Optional[str] = None  # client-generated UUID4 for the public accept link


class CustomerAcceptIn(BaseModel):
    note: Optional[str] = None
