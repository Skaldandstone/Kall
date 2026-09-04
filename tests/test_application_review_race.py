"""build_review() checks for an existing ApplicationReview row and inserts
one if none exists -- a classic time-of-check-to-time-of-use race. Two
nearly-simultaneous calls for the same application (the review page's
effect firing twice under React Strict Mode in development is exactly how
this showed up) can both pass the existence check before either commits,
and the second insert then hits ApplicationReview.application_id's unique
constraint. This reproduces that race with real threads sharing one
database connection, and confirms both callers get back the same row
instead of one of them raising an unhandled IntegrityError.
"""

import contextlib
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

from kall.models import Application, ApplicationReview, CareerProfile, Job, ResumeDocument, User
from kall.services.application_review import build_review, detect_questions
from kall.services.applications import prepare_application
from sqlmodel import Session, SQLModel, create_engine, select


def test_build_review_survives_two_concurrent_calls_for_the_same_application() -> None:
    # A real file-backed database, not the shared in-memory StaticPool engine
    # the other tests use: that pool hands every Session the exact same
    # underlying connection, so two threads racing on it corrupt each
    # other's transaction rather than genuinely racing at the database level
    # the way two separate request handlers hitting Postgres would.
    db_path = Path(tempfile.mkstemp(suffix=".db")[1])
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)

    with Session(engine) as setup:
        user = User(clerk_user_id="user_race", email="race@example.com", full_name="Race Condition")
        setup.add(user)
        setup.commit()
        setup.refresh(user)

        job = Job(
            source="test", company="Acme Robotics", title="Staff Backend Engineer",
            description="Required: Python.", url="https://boards.example.com/jobs/race",
        )
        setup.add(job)
        setup.commit()
        setup.refresh(job)

        profile = CareerProfile(user_id=user.id, name="Backend")
        setup.add(profile)
        setup.commit()
        setup.refresh(profile)

        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path=f"uploads/{user.id}/resume.txt",
            mime_type="text/plain", extracted_text="Built Python services at scale.",
        )
        setup.add(resume)
        setup.commit()
        setup.refresh(resume)

        # No tailoring/cover letter needed here -- only the review race is
        # under test.
        application = prepare_application(
            setup, user, job, profile, resume, customize_resume=False, generate_cover_letter=False,
        )
        application_id = application.id

    # Widen the window between build_review's existence check and its
    # commit just enough for two threads to reliably land inside it
    # together, rather than depending on real OS scheduling luck.
    barrier = threading.Barrier(2)

    def synced_detect_questions(app: Application) -> list[dict]:
        barrier.wait(timeout=5)
        return detect_questions(app)

    results: list[int] = []
    errors: list[BaseException] = []
    lock = threading.Lock()

    def run() -> None:
        with Session(engine) as session:
            app = session.get(Application, application_id)
            with patch("kall.services.application_review.detect_questions", side_effect=synced_detect_questions):
                try:
                    review = build_review(session, app)
                except BaseException as exc:  # noqa: BLE001 - the failure mode under test
                    with lock:
                        errors.append(exc)
                else:
                    with lock:
                        results.append(review.id)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors, f"build_review raised under a concurrent call: {errors}"
    assert len(results) == 2
    # Both concurrent callers must agree on the one review row that exists.
    assert results[0] == results[1]

    with Session(engine) as session:
        rows = list(session.exec(select(ApplicationReview).where(ApplicationReview.application_id == application_id)))
        assert len(rows) == 1

    engine.dispose()
    # Best-effort: some platforms keep a brief file-handle lock after
    # engine.dispose(). The OS temp-file reaper cleans this up either way.
    with contextlib.suppress(OSError):
        db_path.unlink(missing_ok=True)
