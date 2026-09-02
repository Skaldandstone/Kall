from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "cost-model.json"
CENT = Decimal("0.01")


def load_model(path: Path = MODEL) -> dict[str, object]:
    return json.loads(path.read_text())


def calculate_monthly_cost(model: dict[str, object]) -> dict[str, Decimal]:
    rates = {key: Decimal(value) for key, value in model["rates"].items()}
    usage = {
        key: Decimal(value) for key, value in model["assumptions"].items()
    }
    hours = Decimal(model["hours_per_month"])

    items = {
        "fargate_cpu": usage["fargate_vcpu"] * rates["fargate_vcpu_hour"] * hours,
        "fargate_memory": usage["fargate_memory_gb"]
        * rates["fargate_gb_hour"]
        * hours,
        "rds_compute": usage["rds_instances"]
        * rates["rds_multi_az_db_t4g_micro_hour"]
        * hours,
        "rds_storage": usage["rds_storage_gb"]
        * rates["rds_multi_az_gp3_gb_month"],
        "alb_hours": usage["alb_count"] * rates["alb_hour"] * hours,
        "alb_capacity": usage["average_alb_lcu"] * rates["alb_lcu_hour"] * hours,
        "secrets": usage["secrets"] * rates["secrets_manager_secret_month"],
        "alarms": usage["alarms"] * rates["cloudwatch_standard_alarm_month"],
        "logs": usage["logs_ingested_gb"] * rates["cloudwatch_logs_ingested_gb"],
        "documents": usage["s3_standard_gb"] * rates["s3_standard_gb_month"],
        "cloudfront_data": usage["cloudfront_data_out_gb"]
        * rates["cloudfront_us_data_out_gb"],
        "cloudfront_requests": usage["cloudfront_https_requests"]
        * rates["cloudfront_us_https_request"],
    }
    items["total"] = sum(items.values(), Decimal("0"))
    return {key: value.quantize(CENT, rounding=ROUND_HALF_UP) for key, value in items.items()}


if __name__ == "__main__":
    print(json.dumps({key: str(value) for key, value in calculate_monthly_cost(load_model()).items()}, indent=2))
