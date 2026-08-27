from fastapi import FastAPI

from kall.api import router
from kall.api_application_review import router as application_review_router
from kall.api_applications import router as applications_router
from kall.api_autofill import router as autofill_router
from kall.api_billing import router as billing_router
from kall.api_brief import router as brief_router
from kall.api_career_page import router as career_page_router
from kall.api_career_profiles import router as career_profiles_router
from kall.api_documents import router as documents_router
from kall.api_growth import router as growth_router
from kall.api_intelligence import router as intelligence_router
from kall.api_match_intelligence import router as match_intelligence_router
from kall.api_opportunities import router as opportunities_router
from kall.api_ops import router as operations_router
from kall.api_resume_intelligence import router as resume_intelligence_router
from kall.api_resumes import router as resumes_router
from kall.api_search_apply import router as search_apply_router
from kall.api_submissions import router as submissions_router
from kall.api_tailoring import router as tailoring_router
from kall.api_testimonials import router as testimonials_router
from kall.profile_api import router as profile_router

API_ROUTERS = (
    router,
    brief_router,
    applications_router,
    career_profiles_router,
    resumes_router,
    application_review_router,
    testimonials_router,
    profile_router,
    intelligence_router,
    match_intelligence_router,
    resume_intelligence_router,
    growth_router,
    tailoring_router,
    documents_router,
    opportunities_router,
    search_apply_router,
    submissions_router,
    billing_router,
    autofill_router,
    career_page_router,
)


def register_api_routers(app: FastAPI) -> None:
    app.include_router(operations_router)
    for api_router in API_ROUTERS:
        app.include_router(api_router, prefix="/api")
