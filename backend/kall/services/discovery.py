from datetime import datetime

from kall.models import CareerProfile, Job, JobMatch, SearchRun, SearchSource, User
from kall.providers.ashby import AshbyProvider
from kall.providers.greenhouse import GreenhouseProvider
from kall.providers.lever import LeverProvider
from kall.services.ats_web_search import build_ats_queries
from kall.services.matching import deterministic_match
from kall.services.normalization import normalize_discovered
from kall.services.opportunities import upsert_opportunity
from sqlmodel import Session, select

PROVIDERS={
    "greenhouse": GreenhouseProvider,
    "lever": LeverProvider,
    "ashby": AshbyProvider,
}


async def run_discovery(session: Session, user: User, profile: CareerProfile) -> SearchRun:
    sources = list(session.exec(select(SearchSource).where(SearchSource.user_id == user.id, SearchSource.enabled)))
    # Build the same unified ATS query used by the web workspace for every
    # immediate or scheduled run. Structured providers continue importing jobs;
    # ATS Search records the broader hidden-market query in run history.
    build_ats_queries(profile)
    requested_providers = {s.provider for s in sources}
    requested_providers.add("ats_search")
    run=SearchRun(
        user_id=user.id,
        professional_profile_id=profile.id,
        providers_requested=sorted(requested_providers),
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    collected=created=matched=0
    errors=[]
    for source in sources:
        provider_type=PROVIDERS.get(source.provider)
        if not provider_type:
            errors.append(f"Unsupported provider: {source.provider}")
            continue
        try:
            jobs=await provider_type().collect(source.company_name,source.board_key)
            collected += len(jobs)
            for discovered in jobs:
                normalized=normalize_discovered(discovered)
                existing=session.exec(select(Job).where(Job.url==normalized["url"])) .first()
                if existing:
                    job=existing
                else:
                    job=Job(**normalized)
                    session.add(job)
                    session.commit()
                    session.refresh(job)
                    created+=1
                existing_match=session.exec(select(JobMatch).where(
                    JobMatch.user_id==user.id,
                    JobMatch.career_profile_id==profile.id,
                    JobMatch.job_id==job.id,
                )).first()
                if not existing_match:
                    score,strengths,gaps=deterministic_match(job,profile)
                    match=JobMatch(
                        user_id=user.id,career_profile_id=profile.id,job_id=job.id,
                        score=score,strengths=strengths,gaps=gaps,
                        recommendation="apply" if score>=75 else "review" if score>=55 else "pass",
                    )
                    session.add(match)
                    session.commit()
                    matched += 1
                    match_score=score
                else:
                    match_score=existing_match.score
                # Every matched job also lands in the user's tracked-opportunity
                # inbox (save/reviewing/apply/dismiss state) -- without this call
                # the workflow-state feature has no rows to ever operate on.
                upsert_opportunity(session, user_id=user.id, profile_id=profile.id, job=job, match_score=match_score)
        except Exception as exc:
            errors.append(f"{source.company_name}/{source.provider}: {exc}")
    run.completed_at = datetime.utcnow()
    run.jobs_collected = collected
    run.jobs_created = created
    run.matches_created = matched
    run.errors = errors
    run.status = "completed_with_errors" if errors else "completed"
    session.add(run)
    session.commit()
    session.refresh(run)
    return run
