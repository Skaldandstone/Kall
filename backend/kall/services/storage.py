"""File storage for uploaded resumes and generated documents.

`ResumeDocument.file_path` and `DocumentArtifact.file_path` are storage keys
(e.g. "uploads/1/resume.pdf"), not filesystem paths -- what they resolve to
depends on which backend is active. Object storage (S3) is the production
default once AWS_S3_BUCKET is set; without it, files live on local disk,
which is what tests and local development use and is not durable across a
redeploy of an ephemeral container.
"""

from functools import lru_cache
from pathlib import Path
from typing import Protocol

from kall.config import get_settings


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


class LocalStorage:
    def save(self, key: str, data: bytes) -> None:
        path = Path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def read(self, key: str) -> bytes:
        return Path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = Path(key)
        if path.is_file():
            path.unlink()

    def exists(self, key: str) -> bool:
        return Path(key).is_file()


class S3Storage:
    def __init__(self, bucket: str, region: str, client=None) -> None:
        self._bucket = bucket
        self._region = region
        self._client_instance = client

    @property
    def _client(self):
        # Delay credential resolution until the first S3 operation. This keeps
        # configuration and dependency inspection side-effect free, while the
        # cached client is reused for every request after creation.
        if self._client_instance is None:
            import boto3

            self._client_instance = boto3.client("s3", region_name=self._region)
        return self._client_instance

    def save(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ServerSideEncryption="AES256")

    def read(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            # HeadObject does not expose a modeled NoSuchKey exception, so its
            # HTTP error code is the only reliable missing-object signal.
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise


@lru_cache
def get_storage() -> Storage:
    settings = get_settings()
    if settings.aws_s3_bucket:
        return S3Storage(settings.aws_s3_bucket, settings.aws_region)
    return LocalStorage()
