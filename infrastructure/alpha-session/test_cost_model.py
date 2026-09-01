import unittest

import cost_model as model


class CostModelTests(unittest.TestCase):
    def test_two_hour_monthly_allowance_is_below_twenty(self):
        result = model.calculate()
        self.assertTrue(result["withinScenarioBudget"])
        self.assertLessEqual(model.d(result["totalUnroundedUsd"]), model.LIMIT)

    def test_cleanup_one_day_late_is_rejected(self):
        self.assertFalse(model.calculate(cleanup_delay_hours="24")["withinScenarioBudget"])

    def test_no_customer_managed_kms_charge(self):
        rows = model.calculate()["rowsUnroundedUsd"]
        self.assertEqual(rows["aws_managed_rds_kms_key"], "0")

    def test_current_plus_future_secret_count_is_thirteen(self):
        rows = model.calculate()["rowsUnroundedUsd"]
        self.assertEqual(rows["thirteen_existing_plus_split_database_secret_records"], "5.20")

    def test_build_cost_does_not_assume_free_tier(self):
        rows = model.calculate()["rowsUnroundedUsd"]
        self.assertEqual(rows["five_actual_codebuild_jobs_no_free_tier_assumed"], "0.060")


if __name__ == "__main__":
    unittest.main()
