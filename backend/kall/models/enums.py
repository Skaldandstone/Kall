from enum import StrEnum


class PrivacyScope(StrEnum):
    PRIVATE = "private"
    TAILORING = "tailoring"
    AUTOFILL = "autofill"
    PUBLIC_PROFILE = "public_profile"


class AutofillTier(StrEnum):
    """How much consent a field needs before Kall will pre-fill it.

    FieldPrivacy.field_path is a free-form string and field_allowed() fails
    closed, so without a canonical vocabulary an autofill payload would
    silently omit every field forever. These are the paths autofill knows
    how to source, split by the consent each one actually warrants.
    """

    # Already on any resume the user sends out; no separate consent needed.
    ALWAYS = "always"
    # Genuinely personal. Consulted via field_allowed(..., AUTOFILL) and
    # omitted (with a reason) unless the user has granted that scope.
    OPT_IN = "opt_in"
    # EEO and work authorization. These are voluntary self-identification and
    # legal attestations respectively, so Kall never fills them silently --
    # they are always surfaced for explicit per-application confirmation,
    # regardless of any FieldPrivacy rule. Mirrors the models, which force
    # confirmation_required=True on write (see profile_api.upsert_eeo /
    # upsert_work_authorization).
    ALWAYS_CONFIRM = "always_confirm"


AUTOFILL_FIELD_TIERS: dict[str, AutofillTier] = {
    "identity.legal_name": AutofillTier.ALWAYS,
    "identity.email": AutofillTier.ALWAYS,
    "identity.linkedin_url": AutofillTier.ALWAYS,
    "identity.github_url": AutofillTier.ALWAYS,
    "identity.portfolio_urls": AutofillTier.ALWAYS,
    "identity.website_urls": AutofillTier.ALWAYS,
    "identity.city": AutofillTier.ALWAYS,
    "identity.state_region": AutofillTier.ALWAYS,
    "identity.country": AutofillTier.ALWAYS,
    "employment.current_employer": AutofillTier.ALWAYS,
    "employment.current_title": AutofillTier.ALWAYS,
    "education.most_recent": AutofillTier.ALWAYS,
    "identity.phone": AutofillTier.OPT_IN,
    "identity.address": AutofillTier.OPT_IN,
    "identity.postal_code": AutofillTier.OPT_IN,
    "work_authorization.authorization_type": AutofillTier.ALWAYS_CONFIRM,
    "work_authorization.citizenship": AutofillTier.ALWAYS_CONFIRM,
    "work_authorization.requires_current_sponsorship": AutofillTier.ALWAYS_CONFIRM,
    "work_authorization.requires_future_sponsorship": AutofillTier.ALWAYS_CONFIRM,
    "eeo.veteran_status": AutofillTier.ALWAYS_CONFIRM,
    "eeo.disability_status": AutofillTier.ALWAYS_CONFIRM,
    "eeo.race_ethnicity": AutofillTier.ALWAYS_CONFIRM,
    "eeo.gender_identity": AutofillTier.ALWAYS_CONFIRM,
}


class WorkType(StrEnum):
    REMOTE = "remote"
    HYBRID = "hybrid"
    ONSITE = "on_site"


class ApplicationStatus(StrEnum):
    DISCOVERED = "discovered"
    PREPARING = "preparing"
    REVIEW_REQUIRED = "review_required"
    APPROVED = "approved"
    SUBMITTED = "submitted"
    FAILED = "failed"
    WITHDRAWN = "withdrawn"


class SubscriptionPlan(StrEnum):
    FREE = "free"
    PLUS = "plus"
    PREMIUM = "premium"


class Proficiency(StrEnum):
    BASIC = "basic"
    CONVERSATIONAL = "conversational"
    PROFESSIONAL = "professional"
    NATIVE = "native"
