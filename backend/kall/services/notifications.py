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

Push is real plumbing with nowhere to send yet. Mobile push needs Firebase
Cloud Messaging (Android) and APNs (iOS) credentials and developer-account
setup that do not exist in this repository -- apps/mobile/README.md already
says so. `send_push` raises NotConfiguredError naming exactly that, rather
than faking a provider call that would look identical to a real one failing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from kall.config import get_settings

logger = logging.getLogger(__name__)


class NotConfiguredError(RuntimeError):
    """The channel has no working provider yet. Distinct from a send failure:
    this means nobody could have received it, not that delivery was attempted
    and failed."""


@dataclass
class NotificationAction:
    label: str
    deep_link: str


def _action_links_html(actions: list[NotificationAction]) -> str:
    if not actions:
        return ""
    links = "".join(
        f'<p><a href="{action.deep_link}">{action.label}</a></p>' for action in actions
    )
    return f"<hr>{links}"


class NotificationService:
    def send_email(
        self, recipient: str, subject: str, html: str, actions: list[NotificationAction]
    ) -> None:
        settings = get_settings()
        if not settings.ses_sender_email:
            raise NotConfiguredError(
                "SES_SENDER_EMAIL is not set -- no email provider is configured, "
                "so no emails can be sent until a verified sender address is set."
            )

        import boto3

        client = boto3.client("ses", region_name=settings.aws_region)
        body = html + _action_links_html(actions)
        client.send_email(
            Source=settings.ses_sender_email,
            Destination={"ToAddresses": [recipient]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Html": {"Data": body, "Charset": "UTF-8"}},
            },
        )

    def send_push(
        self, user_id: int, title: str, body: str, actions: list[NotificationAction]
    ) -> None:
        del user_id, title, body, actions
        raise NotConfiguredError(
            "No push provider is configured. Mobile push needs Firebase Cloud "
            "Messaging (Android) and APNs (iOS) credentials that do not exist "
            "in this deployment -- see apps/mobile/README.md."
        )
