# Kall

Kall is a privacy-first career identity, job discovery, application preparation, and application tracking platform.

This repository is a production-oriented MVP containing identity profiles, professional profiles, Resume Studio, Greenhouse/Lever/Ashby discovery, matching, application preparation, field-level privacy, and subscription foundations.

## Safety rule

Kall prepares and prefills applications, but does not silently submit sensitive EEO attestations. Prepared applications require explicit review and approval before a supported ATS connector may submit them.

## Quick start

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn kall.main:app --reload
```

Run the web client separately:

```bash
cd apps/web
npm install
npm run dev
```

API docs: http://localhost:8000/docs
Web app: http://localhost:3000

## Status

Current version: see [`VERSION`](VERSION). Full history: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

Kall runs on AWS (ECS Fargate, RDS Postgres, S3, CloudFront - see [`docs/AWS_DEPLOYMENT.md`](docs/AWS_DEPLOYMENT.md)), with CI covering backend tests, a web production build, and an end-to-end browser smoke test on every push.
