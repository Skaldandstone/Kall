from datetime import date

from kall.models import (
    CareerProfile,
    ConsultingEngagement,
    ConsultingFollowUp,
    ConsultingLead,
    ConsultingProposal,
    Contact,
    User,
)
from sqlmodel import Session

BASE = "/api/me/consulting"


def _lead(client, **overrides):
    payload = {
        "organization": "Northstar Software",
        "opportunity_name": "Release readiness assessment",
        "relationship_segment": "former_colleague",
        "service_line": "Quality risk",
        "projected_value_cents": 500_000,
        "next_step": "Confirm discovery call",
    }
    payload.update(overrides)
    response = client.post(f"{BASE}/leads", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_discovery_plan_turns_a_profile_and_owned_contacts_into_lead_paths(client, engine, monkeypatch) -> None:
    captured = {}

    async def fake_aggregate(queries):
        captured["queries"] = queries
        return {
            "enabled": True,
            "results": [{"title": "Interim VP Quality", "url": "https://execthread.com/listings/x", "snippet": "…", "provider": "ExecThread", "domain": "execthread.com/listings"}],
            "sites_searched": len(queries),
            "sites_failed": 0,
        }

    monkeypatch.setattr("kall.api_consulting.aggregate_job_search", fake_aggregate)

    with Session(engine) as session:
        profile = CareerProfile(
            user_id=client.user_id,
            name="Quality leadership",
            target_titles=["VP Quality"],
            industries=["health tech"],
            functional_areas=["release readiness"],
        )
        contact = Contact(
            user_id=client.user_id,
            name="Avery Morgan",
            company="Northstar",
            title="CTO",
            relationship="former colleague",
        )
        session.add(profile)
        session.add(contact)
        session.commit()
        session.refresh(profile)

    response = client.get(f"{BASE}/discovery-plan/{profile.id}?focus=quality%20risk")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["profile_name"] == "Quality leadership"
    assert "quality risk" in payload["positioning"]
    assert len(payload["qualification_questions"]) == 5
    assert {item["provider"] for item in payload["searches"]} == {
        "ExecThread",
        "FractionalJobs.io",
        "GoFractional",
        "Fractionus",
    }
    assert all(item["search_url"].startswith("https://www.google.com/search?q=") for item in payload["searches"])
    assert payload["warm_lead_prompts"][0]["name"] == "Avery Morgan"
    # The searches actually run server-side, not just handed back as links.
    assert [item["provider"] for item in captured["queries"]] == ["ExecThread", "FractionalJobs.io", "GoFractional", "Fractionus"]
    assert captured["queries"][0]["domain"] == "execthread.com/listings"
    assert all(item["domain"] for item in captured["queries"])  # every board has a real, path-restricted domain now
    # intitle: keeps a site: search matching one specific listing's own page
    # title instead of the board's homepage; ?focus overrides target_titles.
    assert captured["queries"][0]["query"] == 'site:execthread.com/listings (intitle:"quality risk") (health tech)'
    assert payload["search_enabled"] is True
    assert payload["results"] == [{
        "title": "Interim VP Quality", "url": "https://execthread.com/listings/x", "snippet": "…",
        "provider": "ExecThread", "suggested_segment": "marketplace",
    }]

    # No focus is required: the profile alone produces a plan.
    unfocused = client.get(f"{BASE}/discovery-plan/{profile.id}")
    assert unfocused.status_code == 200
    assert "release readiness" in unfocused.json()["positioning"]
    unfocused_intent = captured["queries"][0]["query"]
    assert 'intitle:"VP Quality"' in unfocused_intent
    assert 'intitle:"release readiness"' in unfocused_intent

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_profile", email="profile-owner@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        private_profile = CareerProfile(user_id=other.id, name="Private")
        session.add(private_profile)
        session.commit()
        session.refresh(private_profile)
        private_profile_id = private_profile.id

    assert client.get(f"{BASE}/discovery-plan/{private_profile_id}").status_code == 404


def test_leads_are_segmented_and_scoped_to_the_signed_in_account(client, engine) -> None:
    warm = _lead(client)
    _lead(
        client,
        organization="Marketplace buyer",
        opportunity_name="Fractional quality lead",
        relationship_segment="marketplace",
    )

    with Session(engine) as session:
        other = User(clerk_user_id="user_other_consultant", email="other-consultant@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        session.add(ConsultingLead(
            user_id=other.id,
            organization="Private competitor",
            opportunity_name="Must stay private",
            relationship_segment="past_client",
        ))
        session.commit()

    all_leads = client.get(f"{BASE}/leads")
    assert all_leads.status_code == 200
    assert {row["organization"] for row in all_leads.json()} == {"Northstar Software", "Marketplace buyer"}

    warm_only = client.get(f"{BASE}/leads?warm_only=true")
    assert warm_only.status_code == 200
    assert [row["id"] for row in warm_only.json()] == [warm["id"]]

    former_colleagues = client.get(f"{BASE}/leads?relationship_segment=former_colleague")
    assert [row["id"] for row in former_colleagues.json()] == [warm["id"]]


def test_a_lead_cannot_link_another_accounts_contact(client, engine) -> None:
    with Session(engine) as session:
        other = User(clerk_user_id="user_other_contact", email="other-contact@example.com", full_name="Other")
        session.add(other)
        session.commit()
        session.refresh(other)
        contact = Contact(user_id=other.id, name="Someone else's contact")
        session.add(contact)
        session.commit()
        session.refresh(contact)
        contact_id = contact.id

    response = client.post(f"{BASE}/leads", json={
        "organization": "Northstar Software",
        "opportunity_name": "Release readiness assessment",
        "contact_id": contact_id,
    })
    assert response.status_code == 404


def test_consulting_offer_is_public_only_after_explicit_availability_opt_in(client) -> None:
    page = client.get("/api/me/career-page").json()["page"]
    client.patch("/api/me/career-page", json={"published": True})
    payload = {
        "available": False,
        "engagement_types": ["consulting", "fractional"],
        "rate_cents": 17500,
        "rate_basis": "hour",
        "currency": "USD",
        "availability_note": "One new engagement this quarter",
        "agreement_url": "https://example.com/terms",
    }
    saved = client.put(f"{BASE}/practice", json=payload)
    assert saved.status_code == 200, saved.text
    assert client.get(f"/api/career-pages/{page['slug']}").json()["consulting"] is None

    payload["available"] = True
    client.put(f"{BASE}/practice", json=payload)
    public_offer = client.get(f"/api/career-pages/{page['slug']}").json()["consulting"]
    assert public_offer["rate_cents"] == 17500
    assert public_offer["engagement_types"] == ["consulting", "fractional"]

    unsafe = client.put(f"{BASE}/practice", json={**payload, "agreement_url": "javascript:alert(1)"})
    assert unsafe.status_code == 422


def test_proposal_editing_invalidates_approval_and_has_no_send_action(client) -> None:
    lead = _lead(client)
    created = client.post(f"{BASE}/proposals", json={
        "lead_id": lead["id"],
        "title": "Release Readiness and Quality Risk Assessment",
        "summary": "Five-day review with an executive risk brief.",
        "deliverables": ["Risk brief", "Prioritized remediation plan"],
        "fee_cents": 500_000,
    })
    assert created.status_code == 200, created.text
    proposal = created.json()
    assert proposal["status"] == "draft"

    approved = client.post(
        f"{BASE}/proposals/{proposal['id']}/approve",
        json={"confirm_reviewed_for_manual_use": True},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved_for_manual_use"
    assert approved.json()["approved_at"] is not None

    edited = client.patch(f"{BASE}/proposals/{proposal['id']}", json={"fee_cents": 550_000})
    assert edited.status_code == 200
    assert edited.json()["status"] == "draft"
    assert edited.json()["approved_at"] is None

    paths = client.get("/openapi.json").json()["paths"]
    consulting_paths = {path for path in paths if path.startswith(BASE)}
    assert not any(path.endswith(("/send", "/submit")) for path in consulting_paths)


def test_each_follow_up_requires_message_approval_before_manual_completion(client) -> None:
    lead = _lead(client)
    created = client.post(f"{BASE}/follow-ups", json={
        "lead_id": lead["id"],
        "due_on": "2026-09-10",
        "channel": "email",
        "purpose": "Share the assessment outline",
    })
    assert created.status_code == 200
    follow_up = created.json()

    missing_message = client.post(
        f"{BASE}/follow-ups/{follow_up['id']}/approve",
        json={"confirm_reviewed_for_manual_use": True},
    )
    assert missing_message.status_code == 422

    premature = client.post(
        f"{BASE}/follow-ups/{follow_up['id']}/complete",
        json={"confirm_completed_outside_kall": True},
    )
    assert premature.status_code == 422

    drafted = client.patch(f"{BASE}/follow-ups/{follow_up['id']}", json={
        "draft_message": "Hi Morgan, here is the assessment outline we discussed."
    })
    assert drafted.status_code == 200
    approved = client.post(
        f"{BASE}/follow-ups/{follow_up['id']}/approve",
        json={"confirm_reviewed_for_manual_use": True},
    )
    assert approved.status_code == 200
    completed = client.post(
        f"{BASE}/follow-ups/{follow_up['id']}/complete",
        json={"confirm_completed_outside_kall": True},
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["completed_at"] is not None


def test_vaettir_design_partner_engagement_is_visible_in_the_private_workspace(client) -> None:
    lead = _lead(client, opportunity_name="Vaettir paid design partnership")
    created = client.post(f"{BASE}/engagements", json={
        "lead_id": lead["id"],
        "client_name": "Northstar Software",
        "name": "Vaettir design partnership",
        "status": "active",
        "fee_cents": 250_000,
        "starts_on": "2026-09-15",
        "ends_on": "2026-10-15",
        "design_partner_product": "vaettir",
        "design_partner_stage": "active",
    })
    assert created.status_code == 200, created.text
    assert created.json()["design_partner_product"] == "vaettir"

    invalid_dates = client.patch(f"{BASE}/engagements/{created.json()['id']}", json={
        "ends_on": "2026-09-01",
    })
    assert invalid_dates.status_code == 422

    workspace = client.get(f"{BASE}/workspace")
    assert workspace.status_code == 200
    payload = workspace.json()
    assert [row["id"] for row in payload["leads"]] == [lead["id"]]
    assert payload["proposals"] == []
    assert payload["follow_ups"] == []
    assert len(payload["engagements"]) == 1
    assert payload["engagements"][0]["design_partner_stage"] == "active"


def test_consulting_models_participate_in_account_deletion(engine) -> None:
    from kall.services.account_deletion import plan_deletion

    with Session(engine) as session:
        user = User(clerk_user_id="user_consulting_delete", email="consulting-delete@example.com", full_name="Consultant")
        session.add(user)
        session.commit()
        session.refresh(user)
        lead = ConsultingLead(user_id=user.id, organization="Client", opportunity_name="Assessment")
        session.add(lead)
        session.commit()
        session.refresh(lead)
        session.add(ConsultingProposal(user_id=user.id, lead_id=lead.id, title="Draft"))
        session.add(ConsultingFollowUp(user_id=user.id, lead_id=lead.id, due_on=date(2026, 9, 12), purpose="Check in"))
        session.add(ConsultingEngagement(user_id=user.id, lead_id=lead.id, client_name="Client", name="Pilot"))
        session.commit()

        report = plan_deletion(session, user.id)

    assert report.deleted["consultinglead"] == 1
    assert report.deleted["consultingproposal"] == 1
    assert report.deleted["consultingfollowup"] == 1
    assert report.deleted["consultingengagement"] == 1
