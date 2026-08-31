# Kall Product Documentation

This directory is the authoritative, version-controlled source for Kall product, experience, architecture, and delivery documentation.

## Baseline

- Product baseline: **PRD v1.0 Alpha**
- Experience baseline: **KHIG v1.0**
- Engineering baseline: **Engineering Contract v1.0**
- Updated: 2026-08-02

## Structure

- `prd/` - product vision, MVP requirements, experience flows, milestone roadmap, and change history.
- `khig/` - Kall Human Interface Guidelines.
- `architecture/` - system architecture, APIs, data, AI, integrations, and engineering contracts.
- `adr/` - durable architecture and product decision records.
- `releases/` - versioned release notes; `CHANGELOG.md` is the running summary.
- `archive/` - point-in-time snapshots (handoffs, old PR summaries). Historical record only; nothing in it is current.

Operational docs live at this level: `AWS_DEPLOYMENT.md` (infrastructure), `PRODUCTION_DEPLOYMENT.md` (app configuration and Stripe cutover on top of it), `STRIPE_SETUP.md`, `LOCAL_DEVELOPMENT.md`, `TESTING.md`, `SECURITY.md`. `ROADMAP.md` here is the working competitive-gap log; the milestone roadmap is `prd/02-roadmap.md`.

## Governance

1. Product behavior that ships must be reflected in the PRD.
2. New API behavior must be documented in the Engineering Contract.
3. Material experience changes must align with the KHIG.
4. Significant architectural choices require an ADR.
5. Documentation changes should land in the same pull request as implementation whenever practical.

## Current Alpha Workspaces

- Morning Brief
- Career Profiles
- Resume Studio
- Opportunities and Job Intelligence
- Applications Workspace
- Candidate profile and field-level privacy

Figma remains the visual source of truth. This repository is the source of truth for product behavior, requirements, contracts, and decisions.