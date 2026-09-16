
from fastapi.testclient import TestClient


def test_rejects_disallowed_file_extension(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.exe", b"not a resume", "application/octet-stream")})
    assert response.status_code == 415


def test_rejects_oversized_file(client: TestClient) -> None:
    oversized = b"x" * (25 * 1024 * 1024 + 1)
    response = client.post("/api/me/resumes", files={"file": ("resume.txt", oversized, "text/plain")})
    assert response.status_code == 413


def test_accepts_a_reasonable_text_resume(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.txt", b"Jordan Smith\nSenior Engineer", "text/plain")})
    assert response.status_code == 200
    assert response.json()["file_path"] == "uploads/1/resume.txt"


def test_rejects_an_empty_file(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.txt", b"", "text/plain")})
    assert response.status_code == 422
    assert "empty" in response.json()["detail"]


def test_rejects_a_pdf_that_is_not_actually_a_pdf(client: TestClient) -> None:
    response = client.post("/api/me/resumes", files={"file": ("resume.pdf", b"not really a pdf", "application/pdf")})
    assert response.status_code == 422
    assert "couldn't read" in response.json()["detail"]
