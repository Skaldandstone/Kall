import xml.etree.ElementTree as ET

from kall.models import Application, CareerProfile, Job, User
from kall.services.email_filter_export import build_gmail_filter_xml, tracked_employer_domains
from sqlmodel import Session

API = "/api/me/email-connections/gmail-filters.xml"


def test_tracked_employer_domains_dedupes_and_strips_www(engine) -> None:
    with Session(engine) as session:
        user = User(email="filters@example.com", full_name="Filters")
        session.add(user)
        session.commit()
        session.refresh(user)
        profile = CareerProfile(user_id=user.id, name="P")
        session.add(profile)
        session.commit()
        session.refresh(profile)
        for url in ["https://www.acme.com/jobs/1", "https://acme.com/jobs/2", "https://other.example/jobs/3"]:
            job = Job(source="test", company="X", title="Y", description="...", url=url)
            session.add(job)
            session.commit()
            session.refresh(job)
            session.add(Application(user_id=user.id, job_id=job.id, career_profile_id=profile.id))
        session.commit()

        domains = tracked_employer_domains(session, user.id)
    assert domains == ["acme.com", "other.example"]


def test_build_gmail_filter_xml_is_valid_and_includes_ats_domains(engine) -> None:
    with Session(engine) as session:
        xml = build_gmail_filter_xml(session, 1)
    root = ET.fromstring(xml)  # raises if malformed
    assert root.tag.endswith("feed")
    entries = root.findall("{http://schemas.google.com/g/2005}entry")
    assert len(entries) >= 10  # every ATS domain, at minimum
    assert "boards.greenhouse.io" in xml
    assert "Kall/Job Search" in xml


def test_gmail_filters_endpoint_downloads_as_xml(client) -> None:
    response = client.get(API)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/xml")
    assert "attachment" in response.headers["content-disposition"]
    ET.fromstring(response.text)
