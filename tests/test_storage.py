import io
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import Stubber
from kall.services.storage import LocalStorage, S3Storage


def _s3_storage() -> S3Storage:
    # Explicit nonsecret fake credentials keep Stubber unit tests independent
    # of whatever AWS login provider is configured on the developer machine.
    client = boto3.client(
        "s3",
        region_name="us-east-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    return S3Storage("kall-documents", "us-east-2", client=client)


def test_local_storage_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    storage = LocalStorage()
    key = "uploads/1/resume.txt"

    assert not storage.exists(key)
    storage.save(key, b"hello resume")
    assert storage.exists(key)
    assert storage.read(key) == b"hello resume"
    assert (tmp_path / key).read_bytes() == b"hello resume"

    storage.delete(key)
    assert not storage.exists(key)
    # Deleting an already-missing key is a no-op, not an error.
    storage.delete(key)


def test_s3_storage_save_and_read_use_the_configured_bucket() -> None:
    storage = _s3_storage()
    stubber = Stubber(storage._client)
    stubber.add_response(
        "put_object",
        {},
        {"Bucket": "kall-documents", "Key": "uploads/1/resume.txt", "Body": b"hello", "ServerSideEncryption": "AES256"},
    )
    stubber.add_response(
        "get_object",
        {"Body": StreamingBody(io.BytesIO(b"hello"), 5)},
        {"Bucket": "kall-documents", "Key": "uploads/1/resume.txt"},
    )
    with stubber:
        storage.save("uploads/1/resume.txt", b"hello")
        assert storage.read("uploads/1/resume.txt") == b"hello"


def test_s3_storage_exists_is_false_for_a_missing_key() -> None:
    storage = _s3_storage()
    stubber = Stubber(storage._client)
    stubber.add_client_error("head_object", service_error_code="404", http_status_code=404)
    with stubber:
        assert storage.exists("uploads/1/missing.txt") is False


def test_s3_storage_exists_does_not_hide_access_failures() -> None:
    storage = _s3_storage()
    stubber = Stubber(storage._client)
    stubber.add_client_error("head_object", service_error_code="AccessDenied", http_status_code=403)
    with stubber, pytest.raises(ClientError):
        storage.exists("uploads/1/private.txt")
