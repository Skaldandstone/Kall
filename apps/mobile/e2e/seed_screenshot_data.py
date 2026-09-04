"""One-off seeder for Play Store screenshot data -- not a test fixture.

Run against the mobile e2e's throwaway SQLite DB (see env.ts's dbPath) after
the target Clerk user has made its first authenticated request, which
auto-provisions the local User row (kall/auth.py's ensure_local_user). Adds a
couple of realistic-looking applications so the Applications list and the
Application Review screen have something worth screenshotting, using the
same direct-ORM construction tests/test_application_pipeline.py uses for
pipeline tests -- there is no seeding endpoint in the API for this.
"""

import argparse
from datetime import datetime, timedelta

from kall.db import engine
from kall.models import Application, CareerProfile, Job, JobMatch, User
from kall.models.enums import ApplicationStatus
from sqlmodel import Session, select


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    args = parser.parse_args()

    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == args.email)).first()
        if not user:
            raise SystemExit(
                f"No local user found for {args.email} -- sign in first so ensure_local_user runs."
            )

        profile = CareerProfile(user_id=user.id, name="Default")
        session.add(profile)
        session.commit()
        session.refresh(profile)

        review_job = Job(
            source="manual",
            company="Anchor Robotics",
            title="Senior Backend Engineer",
            description="Own the services powering our fulfillment network.",
            url="https://boards.example.com/jobs/anchor-robotics-backend",
            location="Remote (US)",
        )
        interview_job = Job(
            source="manual",
            company="Northwind Analytics",
            title="Staff Data Engineer",
            description="Lead the data platform team.",
            url="https://boards.example.com/jobs/northwind-staff-data",
            location="Austin, TX",
        )
        session.add(review_job)
        session.add(interview_job)
        session.commit()
        session.refresh(review_job)
        session.refresh(interview_job)

        review_application = Application(
            user_id=user.id,
            job_id=review_job.id,
            career_profile_id=profile.id,
            status=ApplicationStatus.REVIEW_REQUIRED,
            prepared_payload={
                "screening_questions": [
                    {"prompt": "Why are you interested in this role?", "category": "general"},
                    {"prompt": "What is your work authorization status?", "category": "work_authorization"},
                ]
            },
        )
        interview_application = Application(
            user_id=user.id,
            job_id=interview_job.id,
            career_profile_id=profile.id,
            status=ApplicationStatus.SUBMITTED,
            submitted_at=datetime.utcnow() - timedelta(days=3),
            interview_scheduled_at=datetime.utcnow() + timedelta(days=2),
        )
        session.add(review_application)
        session.add(interview_application)
        session.commit()

        session.add(
            JobMatch(
                user_id=user.id,
                career_profile_id=profile.id,
                job_id=review_job.id,
                score=91,
                strengths=["Distributed systems depth", "Team leadership"],
                gaps=["Limited Kubernetes exposure"],
                recommendation="Strong match -- worth prioritizing.",
            )
        )
        session.commit()

    print("Seeded screenshot data.")


if __name__ == "__main__":
    main()
