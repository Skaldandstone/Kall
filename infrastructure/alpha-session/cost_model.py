"""Deterministic Kall two-hour-session cost ceiling using captured us-east-2 rates."""

import json
from decimal import ROUND_UP, Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRICE_FILE = HERE / "regional-prices.json"
MONTH_HOURS = Decimal("672")  # conservative proration denominator retained from reviewed v1
LIMIT = Decimal("20.00")


def d(value):
    return Decimal(str(value))


def calculate(resource_hours="12", retained_snapshot_gib="20", cleanup_delay_hours="0"):
    captured = json.loads(PRICE_FILE.read_text(encoding="utf-8"))
    prices = {name: d(value["price"]["usd"]) for name, value in captured["prices"].items()}
    hours = d(resource_hours) + d(cleanup_delay_hours)
    rows = {
        "existing_foundation_and_operations_allowance": d("4.50"),
        "thirteen_existing_plus_split_database_secret_records": d("13") * d("0.40"),
        "aws_managed_rds_kms_key": d("0"),
        "retained_encrypted_snapshot_month": d(retained_snapshot_gib) * prices["rds_backup"],
        "twenty_gib_snapshot_overlap_during_sessions": d("20") * prices["rds_backup"] * hours / MONTH_HOURS,
        "four_task_fargate_cpu_overlap_ceiling": d("4") * d("0.5") * hours * prices["fargate_cpu"],
        "four_task_fargate_memory_overlap_ceiling": d("4") * d("1") * hours * prices["fargate_memory"],
        "rds_instance": hours * prices["rds_instance"],
        "rds_full_two_vcpu_credit_reserve": hours * d("2") * d("0.075"),
        "rds_allocated_storage_during_session": d("20") * prices["rds_storage"] * hours / MONTH_HOURS,
        "application_load_balancer": hours * prices["alb_hour"],
        "one_alb_lcu_allowance": hours * prices["alb_lcu"],
        "six_public_ipv4_overlap_ceiling": d("6") * hours * prices["ipv4"],
        "five_actual_codebuild_jobs_no_free_tier_assumed": d("12") * d("0.005"),
        "expiry_controller_execution_ceiling": d("0.01"),
        "s3_ecr_logs_requests_egress_and_rounding_contingency": d("2.00"),
    }
    total = sum(rows.values(), d("0"))
    return {
        "rowsUnroundedUsd": {key: str(value) for key, value in rows.items()},
        "totalUnroundedUsd": str(total),
        "totalRoundedUpUsd": str(total.quantize(Decimal("0.01"), rounding=ROUND_UP)),
        "withinScenarioBudget": total <= LIMIT,
        "remainingScenarioUsd": str(LIMIT - total),
        "resourceHours": str(hours),
        "invoiceOrHardCap": False,
    }


def main():
    output = {
        "schemaVersion": 2,
        "account": "734702670689",
        "region": "us-east-2",
        "checkedAtRateCapture": json.loads(PRICE_FILE.read_text(encoding="utf-8"))["checkedAt"],
        "securityGatePassed": False,
        "securityGateBlocker": "Both successor images have 7 HIGH, 1 MEDIUM, and 2 UNDEFINED ECR basic findings.",
        "awsManagedRdsKeyVerified": True,
        "currentSecretRecords": 11,
        "futureSplitDatabaseSecretRecords": 2,
        "retainedSnapshotGiB": 20,
        "actualCodeBuildBilledMinuteCeiling": 12,
        "codeBuildPriceSource": "https://aws.amazon.com/codebuild/pricing/",
        "scenario": calculate(),
        "cleanup24HoursLate": calculate(cleanup_delay_hours="24"),
        "twoSnapshotsRetainedFullMonth": calculate(retained_snapshot_gib="40"),
        "notes": [
            "The USD20 figure is a deterministic scenario ceiling, not an AWS invoice hard cap.",
            "No free-tier or startup-credit reduction is assumed.",
            "External Cloudflare DNS costs and traffic outside the contingency are not fabricated.",
            "An incomplete cleanup or failed image gate prevents a new session.",
        ],
    }
    target = HERE / "cost-model.json"
    target.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
