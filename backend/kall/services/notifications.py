"""Actually sending a notification, once something has decided to.

This replaced a stub. `send_email` and `send_push` printed to stdout and were
never called from anywhere -- the schema for a real outbox already existed
(`NotificationDelivery`, `NotificationPreference`, `DeviceRegistration` in
models/opportunities.py) but nothing drained it. See jobs/notifications.py
for the worker that does; this module is only the sending itself.

Email goes through SES, since AWS is already the host and boto3 is already a
dependency for S3 -- no new vendor. It is not configured until
`SES_SENDER_EMAIL` is set to a verified address, and until then this raises
rather than pretending to have sent something, the same rule
services/openai_json.py and services/account_deletion.py's Clerk call
already follow: an unconfigured feature must look like "not configured," not
like a silent success.

Push uses Expo's device-token relay. The mobile build obtains a platform token
through the signed Expo project and registers it encrypted. No FCM or APNs
credential is stored in the Kall API container.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from email.message import EmailMessage
from functools import lru_cache
from html import unescape

import httpx
from botocore.config import Config
from botocore.exceptions import ClientError, ConnectTimeoutError, EndpointConnectionError
from kall.config import get_settings
from kall.models import DeviceRegistration
from kall.security import decrypt_sensitive
from kall.services.email_templates import action_button, html_to_text, render_email_document
from sqlmodel import Session, select

logger = logging.getLogger(__name__)


class NotConfiguredError(RuntimeError):
    """The channel has no working provider yet. Distinct from a send failure:
    this means nobody could have received it, not that delivery was attempted
    and failed."""


class RetryableDeliveryError(RuntimeError):
    """A definite rejection or a connection that never reached the provider."""


class PermanentDeliveryError(RuntimeError):
    """The provider definitively rejected the message; retrying will not help."""


@lru_cache(maxsize=2)
def _ses_client(region: str):
    import boto3

    # SendEmail has no idempotency token. The outbox owns retries, so SDK
    # retries must not hide another send after an uncertain response.
    return boto3.client("ses", region_name=region, config=Config(
        connect_timeout=3, read_timeout=10,
        retries={"total_max_attempts": 1, "mode": "standard"},
    ))


@dataclass
class NotificationAction:
    label: str
    deep_link: str


def _action_links_html(actions: list[NotificationAction]) -> str:
    if not actions:
        return ""
    return "".join(action_button(action.label, action.deep_link) for action in actions)


class NotificationService:
    def send_email(
        self,
        recipient: str,
        subject: str,
        html: str,
        actions: list[NotificationAction],
        unsubscribe_url: str | None = None,
    ) -> str:
        settings = get_settings()
        if not settings.ses_sender_email:
            raise NotConfiguredError(
                "SES_SENDER_EMAIL is not set -- no email provider is configured, "
                "so no emails can be sent until a verified sender address is set."
            )

        client = _ses_client(settings.aws_region)
        content = html + _action_links_html(actions)
        body = render_email_document(subject, content, unsubscribe_url)
        text = html_to_text(content)
        try:
            # send_raw_email only when there is a List-Unsubscribe header to
            # add -- SES's Simple send_email API has no way to set custom
            # headers at all, but a raw MIME message needs no other reason
            # to exist, so the simple API stays the default path.
            if unsubscribe_url:
                message = EmailMessage()
                message["Subject"] = subject
                message["From"] = settings.ses_sender_email
                message["To"] = recipient
                # RFC 8058: List-Unsubscribe-Post is what tells Gmail/Yahoo/Apple
                # Mail to POST the link themselves with no page ever shown to
                # the person -- the https URL alone (no List-Unsubscribe-Post)
                # only yields the older "open this link" behavior.
                message["List-Unsubscribe"] = f"<{unsubscribe_url}>"
                message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
                message.set_content(text)
                message.add_alternative(body, subtype="html")
                response = client.send_raw_email(
                    Source=settings.ses_sender_email,
                    Destinations=[recipient],
                    RawMessage={"Data": message.as_bytes()},
                )
            else:
                response = client.send_email(
                    Source=settings.ses_sender_email,
                    Destination={"ToAddresses": [recipient]},
                    Message={
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {
                            "Html": {"Data": body, "Charset": "UTF-8"},
                            "Text": {"Data": text, "Charset": "UTF-8"},
                        },
                    },
                )
        except (ConnectTimeoutError, EndpointConnectionError) as error:
            raise RetryableDeliveryError("Could not connect to the email provider.") from error
        except ClientError as error:
            # Adapter boundary: classify an explicit AWS response without
            # retaining recipients, credentials, or request contents.
            code = error.response.get("Error", {}).get("Code", "Unknown")
            if code in {"Throttling", "ThrottlingException", "TooManyRequestsException"}:
                raise RetryableDeliveryError("Email provider throttled this attempt.") from error
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 500) < 500:
                raise PermanentDeliveryError(f"Email provider rejected the message ({code}).") from error
            raise
        return response["MessageId"]

    def send_push(
        self,
        session: Session,
        user_id: int,
        title: str,
        body: str,
        actions: list[NotificationAction],
    ) -> str:
        rows = list(session.exec(select(DeviceRegistration).where(
            DeviceRegistration.user_id == user_id,
            DeviceRegistration.enabled.is_(True),
        )))
        registrations = [
            (row, decrypt_sensitive(row.encrypted_token)) for row in rows
        ]
        registrations = [(row, token) for row, token in registrations if token]
        if not registrations:
            raise NotConfiguredError("No enabled mobile device is registered for push notifications.")

        push_body = unescape(re.sub(r"<[^>]+>", " ", body))
        push_body = " ".join(push_body.split())[:1000]
        messages = []
        for _row, token in registrations:
            data = {"screen": "Opportunities"}
            if actions:
                data["url"] = actions[0].deep_link
            messages.append({"to": token, "title": title[:100], "body": push_body, "data": data, "sound": "default"})
        try:
            response = httpx.post(
                "https://exp.host/--/api/v2/push/send",
                json=messages,
                headers={"Accept": "application/json", "Accept-Encoding": "gzip, deflate"},
                timeout=httpx.Timeout(10.0, connect=3.0),
            )
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            raise RetryableDeliveryError("Could not connect to the push provider.") from error
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableDeliveryError(f"Push provider temporarily rejected the request ({response.status_code}).")
        if response.status_code >= 400:
            raise PermanentDeliveryError(f"Push provider rejected the request ({response.status_code}).")

        payload = response.json()
        tickets = payload.get("data", []) if isinstance(payload, dict) else []
        if not isinstance(tickets, list) or len(tickets) != len(registrations):
            raise RuntimeError("Push provider returned an unexpected receipt set.")
        accepted: list[str] = []
        permanent_errors: list[str] = []
        for (row, _token), ticket in zip(registrations, tickets, strict=True):
            if isinstance(ticket, dict) and ticket.get("status") == "ok" and ticket.get("id"):
                accepted.append(str(ticket["id"]))
                continue
            details = ticket.get("details", {}) if isinstance(ticket, dict) else {}
            code = details.get("error") if isinstance(details, dict) else None
            if code == "DeviceNotRegistered":
                row.enabled = False
                session.add(row)
            permanent_errors.append(str(code or "rejected"))
        session.commit()
        if accepted:
            return ",".join(accepted)
        raise PermanentDeliveryError(
            "Push provider rejected every registered device (" + ", ".join(permanent_errors) + ")."
        )
