"""Fail-closed expiry handler for one tagged Kall sandbox stack."""

from __future__ import annotations

import json
import os
import re
import time

STACK_RE = re.compile(r"^kall-sandbox-[a-f0-9]{12}$")
SESSION_RE = re.compile(r"^kall-[a-f0-9]{32}$")
MAX_SESSION_SECONDS = 2 * 60 * 60


def _config(environment: dict[str, str]) -> dict[str, object]:
    created = int(environment["CREATED_AT_EPOCH"])
    expires = int(environment["EXPIRES_AT_EPOCH"])
    config = {
        "stack_name": environment["MANAGED_STACK_NAME"],
        "session_id": environment["SESSION_ID"],
        "created": created,
        "expires": expires,
        "account": environment["EXPECTED_ACCOUNT"],
        "region": environment["EXPECTED_REGION"],
        "rule_name": environment["RULE_NAME"],
        "deletion_role_arn": environment["DELETION_ROLE_ARN"],
    }
    if not STACK_RE.fullmatch(str(config["stack_name"])):
        raise RuntimeError("Managed stack name is outside the Kall sandbox boundary")
    if not SESSION_RE.fullmatch(str(config["session_id"])):
        raise RuntimeError("Session identifier is outside the Kall sandbox boundary")
    if not re.fullmatch(r"\d{12}", str(config["account"])):
        raise RuntimeError("Expected account is invalid")
    if config["region"] != "us-east-2":
        raise RuntimeError("Expected region is invalid")
    expected_role_arn = (
        f"arn:aws:iam::{config['account']}:role/"
        f"kall-expiry-{config['session_id']}-delete"
    )
    if config["deletion_role_arn"] != expected_role_arn:
        raise RuntimeError("CloudFormation deletion role is outside the exact session boundary")
    if expires <= created or expires - created > MAX_SESSION_SECONDS:
        raise RuntimeError("Expiry must be after creation and within two hours")
    return config


def _evaluate(stack: dict[str, object], config: dict[str, object], now: int) -> str:
    stack_id = str(stack["StackId"])
    expected_prefix = (
        f"arn:aws:cloudformation:{config['region']}:{config['account']}:"
        f"stack/{config['stack_name']}/"
    )
    if not stack_id.startswith(expected_prefix):
        raise RuntimeError("Resolved stack ARN is outside the exact account, region, or name")
    tags = {str(item["Key"]): str(item["Value"]) for item in stack.get("Tags", [])}
    expected_tags = {
        "SkaldAndStone-ManagedBy": "kall-session-expiry-v1",
        "SkaldAndStone-SessionId": str(config["session_id"]),
        "SkaldAndStone-ExpiresAtEpoch": str(config["expires"]),
    }
    if any(tags.get(key) != value for key, value in expected_tags.items()):
        raise RuntimeError("Runtime stack expiry tags do not match the controller contract")
    status = str(stack["StackStatus"])
    if status == "DELETE_IN_PROGRESS":
        return "deleting"
    if status == "DELETE_FAILED":
        return "recover-delete" if now >= int(config["expires"]) else "wait"
    if status.endswith("_IN_PROGRESS") or status.endswith("_FAILED") or "ROLLBACK" in status:
        raise RuntimeError("Runtime stack is not in a deletion-safe stable state")
    return "delete" if now >= int(config["expires"]) else "wait"


def _delete_arguments(
    stack: dict[str, object], config: dict[str, object], action: str
) -> dict[str, str]:
    if action not in {"delete", "recover-delete"}:
        raise RuntimeError("Delete arguments require a deletion action")
    token_prefix = "expiry-v2" if action == "recover-delete" else "expiry"
    return {
        "StackName": str(stack["StackId"]),
        "ClientRequestToken": f"{token_prefix}-{config['session_id']}",
        "RoleARN": str(config["deletion_role_arn"]),
    }


def handler(_event, _context):
    import boto3
    from botocore.exceptions import ClientError

    config = _config(dict(os.environ))
    cloudformation = boto3.client("cloudformation", region_name=str(config["region"]))
    events = boto3.client("events", region_name=str(config["region"]))
    try:
        stack = cloudformation.describe_stacks(StackName=str(config["stack_name"]))["Stacks"][0]
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code")
        message = error.response.get("Error", {}).get("Message", "")
        if code == "ValidationError" and "does not exist" in message:
            events.disable_rule(Name=str(config["rule_name"]))
            print(json.dumps({"state": "cleanup-verified-stack-absent", "scheduleDisabled": True}))
            return {"state": "complete"}
        raise

    action = _evaluate(stack, config, int(time.time()))
    if action in {"delete", "recover-delete"}:
        cloudformation.delete_stack(**_delete_arguments(stack, config, action))
    print(json.dumps({"state": action, "stackName": config["stack_name"], "sessionId": config["session_id"]}))
    return {"state": action}
