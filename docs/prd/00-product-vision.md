# Kall Product Vision

**Version:** 1.0 Alpha  
**Status:** Authoritative

## Purpose

Kall is a Career Operating System. It helps people build meaningful careers over years, not merely find their next job.

## North Star

> What is the most valuable thing Kall can help this person do for their career today?

## Product Philosophy

Kall is built around a subtle but consequential shift:

- Conventional job platforms optimize for application volume and speed.
- Kall optimizes for career clarity, informed decisions, preparation, and long-term growth.

The product should reduce anxiety, increase clarity, respect the user's time, and preserve professional dignity.

## Core Principles

1. **Career-first, not job-first.** Every feature should support the user's broader professional direction.
2. **Calm by default.** Avoid artificial urgency, badge overload, gamification, and notification pressure.
3. **One meaningful decision at a time.** Screens should make the next action understandable.
4. **AI prepares; the user decides.** Consequential actions remain reviewable and user-controlled.
5. **Explainable intelligence.** Recommendations distinguish stored facts, deterministic heuristics, and AI-generated suggestions.
6. **User-owned data.** Career information remains exportable, correctable, revocable, and protected by field-level controls.
7. **Cross-platform continuity.** Web, desktop, and mobile share one product language while adapting to device context.

## Positioning

Kall is not primarily a job board, applicant tracker, resume generator, or generic chatbot. It is a user-owned system for career identity, strategies, opportunities, documents, applications, learning, relationships, and professional history.

## Primary Users

- Active job seekers pursuing relevant opportunities.
- Mid-career professionals planning advancement or transition.
- Executives managing leadership, board, speaking, publication, and recruiter activity.
- Recent graduates building an initial professional identity.

## Business Model Baseline

Three tiers, gated by metered usage rather than a one-time trial count:

- **Free** ($0) — 5 applications a week, 3 AI actions a week, 25 MB of resume storage. Job search, tracking, and tailoring are all available at this tier; the caps bound cost, not capability.
- **Plus** ($9/month) — 25 applications a week, 15 AI actions a week, 500 MB of storage, the daily brief and scheduled discovery, a career page without the Kall footer, and the apply extension.
- **Premium** ($25/month) — unlimited applications, 400 AI actions a month, 5 GB of storage, a career page per role, a custom domain, and everything in Plus.

Allowances are weekly on Free and Plus (a large free tier stays useful and affordable; see `docs/UNIT_ECONOMICS.md`'s reasoning for why a weekly cadence beats a monthly one someone exhausts in three days) and monthly on Premium's AI-action ceiling. Prices and the enforcement logic live in `apps/web/app/lib/plans.ts` and `backend/kall/services/quota.py`; this is the plain-language source of truth for what a person on each plan actually gets, not the numbers themselves, so it does not need to change every time cost inputs are re-checked.

**Pending, not yet built** (tracked in Linear SSE-206, decided 2026-09-15 in
the Notion PRD "Billing, Plans & Quotas"): unit-economics modeling found
free-tier AI cost was the dominant deficit driver, so Plus moves to
$9/month and Premium to $25/month, and Free's AI surface drops to
effectively zero -- career-growth-plan generation, skills analysis,
resume "suggest-strategy," and interview-prep/application Q&A all move
entirely behind Plus, and the profile-field chip suggester becomes
deterministic (no LLM call) on Free rather than quota-gated. This table
still describes what's actually live; do not treat it as final.

## Success Definition

Kall succeeds when users make higher-quality career decisions with less repetitive work and greater confidence. Application volume alone is not a primary success metric.