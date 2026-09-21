"""Create -- never execute -- the change set that turns native billing on.

Going live with store purchases is one CloudFormation parameter flip plus the
four product IDs (see docs/NATIVE_BILLING.md). Doing that by hand in the console
means retyping four identifiers that must match RevenueCat exactly, where a bare
Google subscription ID silently maps every purchase to `free`. This builds the
change set from the values the repository already agrees on, keeps every other
parameter at its current value, and stops there: creating a change set only
describes the update, and `infrastructure/production/README.md` requires a human
to inspect the complete actions and validation events before execution.

    python scripts/enable_native_billing.py --stack kall-production
    python scripts/enable_native_billing.py --stack kall-production --sandbox

Print the plan without calling AWS at all with --dry-run. Execute the change set
yourself, from the console or the CLI, once you have read it.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import UTC, datetime

#: The product identifiers RevenueCat reports, which the webhook matches
#: exactly. The Google pair keeps the `subscription:base-plan` colon form used
#: for products created after February 2023; the bare subscription ID maps every
#: purchase to `free` instead of a plan.
GOOGLE_PLUS_PRODUCT_ID = "kall_plus_monthly:monthly"
GOOGLE_PREMIUM_PRODUCT_ID = "kall_premium_monthly:monthly"
APPLE_PLUS_PRODUCT_ID = "com.skaldandstone.kall.plus.monthly"
APPLE_PREMIUM_PRODUCT_ID = "com.skaldandstone.kall.premium.monthly"

#: Mirrors the template's AllowedPattern for each parameter, so a typo fails
#: here with a readable message rather than inside CloudFormation validation.
GOOGLE_PATTERN = re.compile(r"^[a-z0-9._-]+:[a-z0-9._-]+$")
APPLE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


def parameters(*, sandbox: bool) -> dict[str, str]:
    return {
        "EnableRevenueCatNative": "true",
        "RevenueCatGooglePlusProductId": GOOGLE_PLUS_PRODUCT_ID,
        "RevenueCatGooglePremiumProductId": GOOGLE_PREMIUM_PRODUCT_ID,
        "RevenueCatApplePlusProductId": APPLE_PLUS_PRODUCT_ID,
        "RevenueCatApplePremiumProductId": APPLE_PREMIUM_PRODUCT_ID,
        # Sandbox acceptance is for license-tester and Apple-sandbox
        # verification. Narrow it back to PRODUCTION once that passes.
        "RevenueCatAcceptedEnvironments": "PRODUCTION,SANDBOX" if sandbox else "PRODUCTION",
    }


def check_patterns(values: dict[str, str]) -> None:
    for name, pattern in (
        ("RevenueCatGooglePlusProductId", GOOGLE_PATTERN),
        ("RevenueCatGooglePremiumProductId", GOOGLE_PATTERN),
        ("RevenueCatApplePlusProductId", APPLE_PATTERN),
        ("RevenueCatApplePremiumProductId", APPLE_PATTERN),
    ):
        if not pattern.match(values[name]):
            raise SystemExit(f"{name}={values[name]!r} does not match the template's AllowedPattern.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack", required=True, help="Production stack name.")
    parser.add_argument("--region", default="us-east-2", help="The project's Region.")
    parser.add_argument(
        "--sandbox",
        action="store_true",
        help="Accept SANDBOX events too, for license-tester and Apple-sandbox verification.",
    )
    parser.add_argument("--name", default=None, help="Change-set name. Defaults to a timestamped one.")
    parser.add_argument("--dry-run", action="store_true", help="Print the parameters and exit.")
    args = parser.parse_args()

    wanted = parameters(sandbox=args.sandbox)
    check_patterns(wanted)

    print("Native billing parameters to set:")
    for name, value in wanted.items():
        print(f"  {name} = {value}")
    print("\nEvery other stack parameter keeps its current value.")
    if args.dry_run:
        print("\nDry run: no AWS call was made.")
        return 0

    import boto3  # imported here so --dry-run works without credentials

    client = boto3.client("cloudformation", region_name=args.region)
    current = client.describe_stacks(StackName=args.stack)["Stacks"][0]
    existing = {item["ParameterKey"] for item in current.get("Parameters", [])}
    unknown = sorted(set(wanted) - existing)
    if unknown:
        raise SystemExit(f"{args.stack} has no parameter(s): {', '.join(unknown)}")

    overrides = [{"ParameterKey": k, "ParameterValue": v} for k, v in wanted.items()]
    inherited = [
        {"ParameterKey": key, "UsePreviousValue": True}
        for key in sorted(existing - set(wanted))
    ]
    name = args.name or f"native-billing-{datetime.now(UTC):%Y%m%d-%H%M%S}"
    created = client.create_change_set(
        StackName=args.stack,
        ChangeSetName=name,
        ChangeSetType="UPDATE",
        UsePreviousTemplate=True,
        Parameters=overrides + inherited,
        Capabilities=["CAPABILITY_NAMED_IAM"],
        Description="Enable RevenueCat native billing with both stores' products",
    )
    print(f"\nChange set created, not executed:\n  {created['Id']}")
    print(
        "\nRead the complete change-set actions and validation events, then execute it\n"
        "yourself. After execution, confirm ALPHA-independent env vars on the API task\n"
        "definition carry all four product IDs, then run the per-platform purchase\n"
        "verification in docs/NATIVE_BILLING.md."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
