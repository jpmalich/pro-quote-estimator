"""Compose all sub-routers under the /api prefix."""
from fastapi import APIRouter

from . import ai_measure, auth, branding, catalog, company, email, estimates, hover, iss, iss_pricing_admin, mezzo, pricing_admin, public, resend_webhook, uploads, vero

api_router = APIRouter(prefix="/api")
api_router.include_router(branding.router)
api_router.include_router(auth.router)
api_router.include_router(company.router)
api_router.include_router(catalog.router)
api_router.include_router(estimates.router)
api_router.include_router(uploads.router)
api_router.include_router(email.router)
api_router.include_router(public.router)
api_router.include_router(pricing_admin.router)
api_router.include_router(hover.router)
api_router.include_router(mezzo.router)
api_router.include_router(vero.router)
api_router.include_router(iss.router)
api_router.include_router(iss_pricing_admin.router)
api_router.include_router(ai_measure.router)
api_router.include_router(resend_webhook.router)


@api_router.get("/")
async def root():
    return {"ok": True, "app": "Vinyl Siding Estimator"}
