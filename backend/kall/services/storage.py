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
    def __init__(self, bucket: str, region: str) -> None:
        import boto3

        self._bucket = bucket
        self._client = boto3.client("s3", region_name=region)

    def save(self, key: str, data: bytes) -> None:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data, ServerSideEncryption="AES256")

    def read(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False


@lru_cache
def get_storage() -> Storage:
    settings = get_settings()
    if settings.aws_s3_bucket:
        return S3Storage(settings.aws_s3_bucket, settings.aws_region)
    return LocalStorage()
