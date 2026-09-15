import pytest
from kall.models import (
    Achievement,
    Employment,
    Job,
    JobRequirementAnalysis,
    ResumeDocument,
    ResumeSelection,
    TailoringChange,
    TailoringProposal,
    User,
)
from kall.services.documents import finalized_resume_content
from kall.services.tailoring import (
    _drafted_summary,
    _find_summary_paragraph,
    _requirement_keywords,
    create_tailoring_proposal,
    finalize_proposal,
    immutable_tokens,
    preserves_immutable_facts,
    review_change,
)
from sqlmodel import Session, SQLModel, create_engine, select


def test_immutable_tokens_catches_a_percentage_at_the_end_of_a_sentence() -> None:
    """Regression test: IMMUTABLE_PATTERN's percent branch ended in \\b, and
    \\b never matches immediately after "%" since "%" is itself a non-word
    character -- a \\b there requires a word/non-word transition that
    doesn't exist. Every percentage in a real sentence ("... by 40%.",
    "... by 40% through ...") extracted as zero tokens, so
    preserves_immutable_facts() could never actually catch a model rewrite
    that silently dropped a percentage -- exactly the fact the summary and
    achievement rewrites both claim to preserve."""
    assert immutable_tokens("Reduced deploy time by 40% through automation.") == ["40%"]
    assert not preserves_immutable_facts(
        "Reduced deploy time by 40% through automation.",
        "Shipped CI/CD pipelines for the platform team.",
    )


def test_summary_paragraph_skips_a_pdf_header_block_split_across_blank_lines() -> None:
    """Regression test: pypdf extraction split a resume header into
    "James\\n\\nShattuck\\n\\n360-809-2664", and the naive first-paragraph
    heuristic proposed editing that instead of an actual summary -- garbled
    text that could never look like an improvement."""
    text = (
        "James\n\n"
        "Shattuck\n\n"
        "360-809-2664\n\n"
        "Senior engineer with eight years building distributed systems and leading cross-functional teams.\n\n"
        "Experience\n\n"
        "Led the platform team at Acme."
    )
    assert _find_summary_paragraph(text) == (
        "Senior engineer with eight years building distributed systems and leading cross-functional teams."
    )


def test_summary_paragraph_skips_an_email_only_line() -> None:
    text = "james@example.com\n\nReal summary paragraph with plenty of actual words in it."
    assert _find_summary_paragraph(text) == "Real summary paragraph with plenty of actual words in it."


def test_summary_paragraph_falls_back_to_the_first_block_when_nothing_else_qualifies() -> None:
    """A resume with no real summary section (every block is short/contact-
    shaped) should not raise or return empty -- just proposing against the
    header is still better than proposing against nothing."""
    text = "James\n\nShattuck\n\n360-809-2664"
    assert _find_summary_paragraph(text) == "James"


def test_summary_paragraph_skips_a_skills_and_education_inventory_block() -> None:
    """Regression test: a resume's "Languages & Tools" list followed by an
    education block reads as long, contact-free prose by word count alone,
    so the header-noise check waved it through as "the summary" -- producing
    a garbled proposal that mashed a skills list into an education GPA line
    instead of touching the real narrative summary below it."""
    text = (
        "James Shattuck\n\n"
        "Languages & Tools: Java, JavaScript, TypeScript, Python, React, Node.js, "
        "AWS, Docker, Kubernetes, PostgreSQL, Terraform. Education: B.S. Computer "
        "Science, State University, GPA: 3.7\n\n"
        "Head of Quality Engineering with a decade of experience scaling test "
        "strategies for SaaS, FinTech, and IoT platforms.\n\n"
        "Experience\n\n"
        "Led the platform team at Acme."
    )
    assert _find_summary_paragraph(text) == (
        "Head of Quality Engineering with a decade of experience scaling test "
        "strategies for SaaS, FinTech, and IoT platforms."
    )


def test_summary_paragraph_handles_empty_text() -> None:
    assert _find_summary_paragraph("") == ""


def test_drafted_summary_reads_as_resume_prose_not_meta_commentary() -> None:
    """Regression test: the no-AI-key fallback used to append "Role focus:
    Head of Quality Engineering at Siftstack, emphasizing the role's
    documented requirements" -- a sentence describing what the tool did,
    not something a person would put on their own resume."""
    job = Job(source="test", company="Siftstack", title="Head of Quality Engineering", description="...", url="https://x/1")
    summary = _drafted_summary("Seasoned QA leader with a decade of experience.", job, "test automation, leadership")
    assert not summary.startswith("Role focus:")
    assert "Role focus" not in summary
    assert "Seasoned QA leader with a decade of experience." in summary
    assert preserves_immutable_facts("Seasoned QA leader with a decade of experience.", summary)


def test_immutable_metrics_and_dates_are_preserved() -> None:
    original = "Improved uptime to 99% in 2024 and saved $250,000."
    assert preserves_immutable_facts(original, "In 2024, improved uptime to 99% and saved $250,000.")
    assert not preserves_immutable_facts(original, "Improved uptime to 100% in 2025 and saved $500,000.")


def test_review_rejects_metric_mutation() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        change = TailoringChange(
            proposal_id=proposal.id,
            section="achievement",
            original_text="Raised automation to 80% in 2023.",
            proposed_text="Raised automation to 80% in 2023.",
            reason="Aligned evidence",
        )
        session.add(change)
        session.commit()
        session.refresh(change)
        with pytest.raises(ValueError):
            review_change(session, change, "edited", "Raised automation to 95% in 2024.")


def test_finalize_requires_every_change_reviewed() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        session.add(TailoringChange(proposal_id=proposal.id, section="summary", original_text="A", proposed_text="A", reason="Test"))
        session.commit()
        with pytest.raises(ValueError):
            finalize_proposal(session, proposal)


def test_finalize_proposal_sets_status_documents_service_expects() -> None:
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        proposal = TailoringProposal(user_id=1, job_id=1, resume_id=1, professional_profile_id=1)
        session.add(proposal)
        session.commit()
        session.refresh(proposal)
        change = TailoringChange(proposal_id=proposal.id, section="summary", original_text="A", proposed_text="A", reason="Test", status="accepted")
        session.add(change)
        session.commit()

        finalized = finalize_proposal(session, proposal)

        assert finalized.status == "finalized"
        assert finalized.id is not None
        # finalized_resume_content() is the consumer this status must satisfy;
        # a mismatched status string here previously made document generation
        # permanently unreachable after finalization.
        assert finalized_resume_content(session, finalized) == [{"section": "summary", "text": "A", "original": "A"}]


def test_created_proposal_survives_session_close() -> None:
    """Regression test: create_tailoring_proposal used to leave the returned
    proposal's attributes expired after its trailing commit, with no refresh
    before return. Once the caller's session closed (as happens between a
    FastAPI request finishing and its response_model being serialized), every
    attribute access raised, and the API silently responded with `{}`."""
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="proposal-survive@example.com", full_name="Survive User")
        session.add(user)
        session.commit()
        session.refresh(user)
        job = Job(source="test", company="North", title="Director", description="Lead quality", url="https://example.com/survive")
        session.add(job)
        session.commit()
        session.refresh(job)
        resume = ResumeDocument(user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt", mime_type="text/plain", extracted_text="Led quality initiatives.")
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.commit()

        job_id = job.id
        proposal = create_tailoring_proposal(session, user.id, job, 1)
        proposal_id = proposal.id

    # Session is closed here, mirroring a request-scoped session ending
    # before FastAPI serializes the response_model=TailoringProposal object.
    assert proposal.id == proposal_id
    assert proposal.status == "review_required"
    assert proposal.job_id == job_id


def test_summary_paragraph_reflows_word_per_line_extraction_and_drops_the_contact_header() -> None:
    """Regression test: a designed PDF came out of pypdf as one word per
    line with single newlines, so the whole header plus summary was a single
    "paragraph" and the mobile review showed "James / Shattuck / 360-809-2664
    / • / Vancouver, ..." one word to a row as the text to improve."""
    words = (
        ["James", "Shattuck", "360-809-2664", "•", "Vancouver,", "WA", "•", "jdshattuck@gmail.com"]
        + [""]
        + ["Strategic", "Director", "of", "Software", "Quality", "Engineering", "with", "over", "15", "years", "of", "experience", "delivering", "high-impact", "quality", "strategies."]
    )
    text = "\n".join(words)
    summary = _find_summary_paragraph(text)
    assert summary.startswith("Strategic Director of Software Quality Engineering")
    assert "\n" not in summary
    assert "jdshattuck" not in summary


def test_summary_paragraph_strips_a_contact_header_sharing_the_paragraph() -> None:
    text = (
        "James Shattuck 360-809-2664 • Vancouver, WA • jdshattuck@gmail.com • Strategic Director of Software "
        "Quality Engineering with over 15 years of experience."
    )
    assert _find_summary_paragraph(text) == (
        "Strategic Director of Software Quality Engineering with over 15 years of experience."
    )


def test_requirement_keywords_drops_boilerplate_and_dedupes() -> None:
    lines = [
        "3+ years of experience required in warehouse fulfillment operations",
        "Must have a valid warehouse fulfillment operations certificate",
    ]
    keywords = _requirement_keywords(lines)
    assert "warehouse" in keywords
    assert "fulfillment" in keywords
    assert "operations" in keywords
    assert "required" not in keywords
    assert "experience" not in keywords
    # Deduped: "warehouse" only appears once even though both lines have it.
    assert keywords.count("warehouse") == 1


def test_proposal_still_drafts_achievement_and_role_gap_changes_when_the_posting_has_no_skill_terms_words() -> None:
    """Regression test: JobRequirementAnalysis.required_skills/preferred_skills
    are matched against intelligence.SKILL_TERMS, a small curated vocabulary --
    a real posting phrased in language that vocabulary doesn't cover (common
    outside software roles) came back with both fields empty, which silently
    skipped achievement-matching and role-gap generation entirely and left
    only the summary change. ("The ai drafted resume copy only does summary
    and then stops.") explicit_requirements has no such vocabulary limit, so
    it must be used as a fallback matching signal instead of nothing."""
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="no-skill-terms@example.com", full_name="No Skillterms User")
        session.add(user)
        session.commit()
        session.refresh(user)

        job = Job(
            source="test",
            company="Riverside Logistics",
            title="Warehouse Fulfillment Lead",
            description="Coordinate warehouse fulfillment operations across three shifts.",
            url="https://example.com/warehouse-fulfillment-lead",
        )
        session.add(job)
        session.commit()
        session.refresh(job)

        # None of these words appear in intelligence.SKILL_TERMS.
        session.add(
            JobRequirementAnalysis(
                job_id=job.id,
                required_skills=[],
                preferred_skills=[],
                explicit_requirements=[
                    "3+ years of experience required coordinating warehouse fulfillment operations",
                ],
            )
        )

        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt",
            mime_type="text/plain", extracted_text="Led shift scheduling and inventory accuracy programs.",
        )
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))

        session.add(Employment(user_id=user.id, employer="Acme Distribution", job_title="Shift Supervisor", is_current=True))

        session.add(
            Achievement(
                user_id=user.id,
                employer="Acme Distribution",
                achievement_text="Coordinated warehouse fulfillment operations across a 40-person shift.",
                verification_status="verified",
            )
        )
        session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, 1)
        changes = list(session.exec(select(TailoringChange).where(TailoringChange.proposal_id == proposal.id)))

    sections = [change.section for change in changes]
    assert "summary" in sections
    assert "achievements" in sections, "A verified achievement matching the posting's own requirement text must still be proposed"


def test_achievement_changes_reword_to_the_postings_language_when_a_model_is_configured(monkeypatch) -> None:
    """Regression test: a verified achievement's proposed_text was always
    achievement_text itself -- an exact copy, no wording customization at
    all. Once experience actually imports into a tailored resume, its
    wording still has to move toward the posting's own vocabulary the same
    way the summary already does; this checks that path exists and that a
    rewrite dropping a fact is rejected the same way summary rewrites are."""
    from kall.config import get_settings
    from kall.services import tailoring

    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(
        tailoring, "ask_for_json",
        lambda *a, **k: {"achievement": "Shipped CI/CD pipelines that cut deploy time by 40%."},
    )

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="reword-achievement@example.com", full_name="Reword User")
        session.add(user)
        session.commit()
        session.refresh(user)

        job = Job(
            source="test", company="Northwind", title="DevOps Engineer",
            description="Own CI/CD pipelines and deployment automation.",
            url="https://example.com/devops-engineer",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["ci/cd"], preferred_skills=[]))

        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt",
            mime_type="text/plain", extracted_text="Built build automation for the platform team.",
        )
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.add(
            Achievement(
                user_id=user.id,
                achievement_text="Reduced deploy time by 40% through build automation.",
                skills=["ci/cd"],
                verification_status="verified",
            )
        )
        session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, 1)
        change = session.exec(
            select(TailoringChange).where(TailoringChange.proposal_id == proposal.id, TailoringChange.section == "achievements")
        ).one()

    assert change.proposed_text == "Shipped CI/CD pipelines that cut deploy time by 40%."
    assert change.original_text == "Reduced deploy time by 40% through build automation."
    assert change.evidence[0]["source"] == "model"
    get_settings.cache_clear()


def test_experience_bullets_get_alignment_suggestions_when_there_is_no_structured_employment(monkeypatch) -> None:
    """Regression test: _role_gap_changes requires at least one Employment
    row and bails out before ever looking at the resume text -- someone
    relying on a resume upload rather than manually filled-in structured
    history got a tailored resume with nothing customized but the summary,
    no matter how well their real experience matched the posting. Traced
    from a real account with zero Employment rows whose generated resume
    came back with only a summary."""
    from kall.config import get_settings
    from kall.services import tailoring

    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(
        tailoring, "ask_for_json",
        lambda *a, **k: {"bullets": [{
            "original": "Reduced deploy time by 40% through manual scripting.",
            "rewrite": "Shipped CI/CD pipelines that cut deploy time by 40%.",
        }]},
    )

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="fallback-experience@example.com", full_name="Fallback User")
        session.add(user)
        session.commit()
        session.refresh(user)

        job = Job(
            source="test", company="Northwind", title="DevOps Engineer",
            description="Own CI/CD pipelines and deployment automation.",
            url="https://example.com/devops-fallback",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["ci/cd"], preferred_skills=[]))

        # No Employment rows at all -- everything comes from the uploaded
        # resume's own text, via the parsed-fallback path.
        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt",
            mime_type="text/plain",
            extracted_text=(
                "Summary\nSeasoned engineer.\n\n"
                "Experience\nAcme Corp - Engineer 2019 - 2022\n"
                "Reduced deploy time by 40% through manual scripting.\n"
            ),
        )
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, 1)
        change = session.exec(
            select(TailoringChange).where(TailoringChange.proposal_id == proposal.id, TailoringChange.section == "experience_bullet")
        ).one()

    assert change.original_text == "Reduced deploy time by 40% through manual scripting."
    assert change.proposed_text == "Shipped CI/CD pipelines that cut deploy time by 40%."
    get_settings.cache_clear()


def test_experience_bullet_suggestion_is_dropped_when_not_found_verbatim_or_drops_a_fact(monkeypatch) -> None:
    """A rewrite the model didn't quote exactly from the source can never be
    found and replaced later (resume_assembly.py has no other addressable
    structure for unstructured fallback text), and a rewrite dropping a
    fact must be caught the same way every other rewrite in this file is."""
    from kall.config import get_settings
    from kall.services import tailoring

    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(
        tailoring, "ask_for_json",
        lambda *a, **k: {"bullets": [
            {"original": "This bullet does not appear in the resume at all.", "rewrite": "Something else."},
            {"original": "Reduced deploy time by 40% through manual scripting.", "rewrite": "Reduced deploy time through manual scripting."},
        ]},
    )

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="fallback-drops-fact@example.com", full_name="Fallback Drop User")
        session.add(user)
        session.commit()
        session.refresh(user)

        job = Job(
            source="test", company="Northwind", title="DevOps Engineer",
            description="Own CI/CD pipelines and deployment automation.",
            url="https://example.com/devops-fallback-2",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["ci/cd"], preferred_skills=[]))

        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt",
            mime_type="text/plain",
            extracted_text=(
                "Summary\nSeasoned engineer.\n\n"
                "Experience\nAcme Corp - Engineer 2019 - 2022\n"
                "Reduced deploy time by 40% through manual scripting.\n"
            ),
        )
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, 1)
        changes = list(session.exec(
            select(TailoringChange).where(TailoringChange.proposal_id == proposal.id, TailoringChange.section == "experience_bullet")
        ))

    assert changes == []
    get_settings.cache_clear()


def test_achievement_rewrite_that_drops_a_fact_falls_back_to_the_original(monkeypatch) -> None:
    """A model rewrite is only usable if it preserves every immutable fact
    from the original -- exactly the same safety rule summary rewrites
    already follow. A rewrite that drops the 40% must not reach the person
    as if Kall verified it."""
    from kall.config import get_settings
    from kall.services import tailoring

    get_settings.cache_clear()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(
        tailoring, "ask_for_json",
        lambda *a, **k: {"achievement": "Shipped CI/CD pipelines for the platform team."},
    )

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="reword-drops-fact@example.com", full_name="Drop User")
        session.add(user)
        session.commit()
        session.refresh(user)

        job = Job(
            source="test", company="Northwind", title="DevOps Engineer",
            description="Own CI/CD pipelines and deployment automation.",
            url="https://example.com/devops-engineer-2",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        session.add(JobRequirementAnalysis(job_id=job.id, required_skills=["ci/cd"], preferred_skills=[]))

        resume = ResumeDocument(
            user_id=user.id, name="resume.txt", file_path="uploads/1/resume.txt",
            mime_type="text/plain", extracted_text="Built build automation for the platform team.",
        )
        session.add(resume)
        session.commit()
        session.refresh(resume)
        session.add(ResumeSelection(user_id=user.id, job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id))
        session.add(
            Achievement(
                user_id=user.id,
                achievement_text="Reduced deploy time by 40% through build automation.",
                skills=["ci/cd"],
                verification_status="verified",
            )
        )
        session.commit()

        proposal = create_tailoring_proposal(session, user.id, job, 1)
        change = session.exec(
            select(TailoringChange).where(TailoringChange.proposal_id == proposal.id, TailoringChange.section == "achievements")
        ).one()

    assert change.proposed_text == "Reduced deploy time by 40% through build automation."
    assert change.evidence[0]["source"] == "rules"
    get_settings.cache_clear()


def test_proposal_listing_names_each_proposal_by_its_job(client) -> None:
    """The web tailoring and generate tabs used to ask the person to read a
    proposal's primary key off one screen and type it into another. This is
    the listing that lets them pick "Director of QA at North" instead."""
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    me = client.get("/api/me").json()
    assert client.get("/api/tailoring/proposals").json() == []

    job = Job(
        source="test",
        company="North",
        title="Director of QA",
        description="Lead quality",
        url="https://example.com/listing-gaps",
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    resume = ResumeDocument(
        user_id=me["id"], name="r.txt", file_path="x", mime_type="text/plain", extracted_text="Led QA."
    )
    session.add(resume)
    session.commit()
    session.refresh(resume)
    session.add(
        ResumeSelection(
            user_id=me["id"], job_id=job.id, professional_profile_id=1, selected_resume_id=resume.id
        )
    )
    session.commit()

    created = client.post("/api/tailoring/proposals", json={"job_id": job.id, "professional_profile_id": 1})
    assert created.status_code == 200, created.text
    proposal_id = created.json()["id"]

    listed = client.get("/api/tailoring/proposals")
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == proposal_id
    assert row["job_title"] == "Director of QA"
    assert row["company"] == "North"
    assert row["job_url"] == "https://example.com/listing-gaps"
    assert row["status"] == "review_required"
    assert row["change_count"] >= 1
    assert row["pending_count"] == row["change_count"]
    assert row["has_document"] is False

    assert client.post(f"/api/tailoring/proposals/{proposal_id}/review-all", json={"status": "accepted"}).status_code == 200
    assert client.post(f"/api/tailoring/proposals/{proposal_id}/finalize").status_code == 200
    assert client.post(f"/api/tailoring/{proposal_id}/documents", json={"template_key": "standard"}).status_code == 200

    finalized = client.get("/api/tailoring/proposals").json()[0]
    assert finalized["status"] == "finalized"
    assert finalized["pending_count"] == 0
    assert finalized["has_document"] is True
    assert finalized["finalized_at"] is not None


def test_proposal_listing_never_returns_another_account_s_proposals(client) -> None:
    from kall.db import get_session
    from kall.main import app

    session = next(app.dependency_overrides[get_session]())
    other = User(clerk_user_id="user_other", email="other@example.com", full_name="Other")
    session.add(other)
    job = Job(
        source="test",
        company="Elsewhere",
        title="Someone else's role",
        description="Not yours",
        url="https://example.com/not-yours",
    )
    session.add(job)
    session.commit()
    session.refresh(other)
    session.refresh(job)
    session.add(
        TailoringProposal(user_id=other.id, job_id=job.id, resume_id=1, professional_profile_id=1)
    )
    session.commit()

    assert client.get("/api/tailoring/proposals").json() == []
