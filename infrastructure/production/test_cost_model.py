from decimal import Decimal

from infrastructure.production.cost_model import calculate_monthly_cost, load_model


def test_production_cost_model_is_deterministic_and_below_shared_budget() -> None:
    costs = calculate_monthly_cost(load_model())

    assert costs == {
        "fargate_cpu": Decimal("14.78"),
        "fargate_memory": Decimal("3.24"),
        "rds_compute": Decimal("23.36"),
        "rds_storage": Decimal("4.60"),
        "alb_hours": Decimal("16.43"),
        "alb_capacity": Decimal("5.84"),
        "secrets": Decimal("2.40"),
        "alarms": Decimal("0.60"),
        "logs": Decimal("0.50"),
        "documents": Decimal("0.12"),
        "cloudfront_data": Decimal("0.85"),
        "cloudfront_requests": Decimal("1.00"),
        "total": Decimal("73.71"),
    }
    assert costs["total"] < Decimal("100.00")


def test_production_cost_model_names_unmodeled_costs() -> None:
    model = load_model()
    exclusions = " ".join(model["excluded_or_variable"])

    for expected in ("credits", "taxes", "Stripe", "SES", "OpenAI", "WAF"):
        assert expected in exclusions
