import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import expiry_handler as expiry


class ExpiryHandlerTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "MANAGED_STACK_NAME": "kall-sandbox-012345abcdef",
            "SESSION_ID": "kall-0123456789abcdef0123456789abcdef",
            "CREATED_AT_EPOCH": "1000",
            "EXPIRES_AT_EPOCH": "8200",
            "EXPECTED_ACCOUNT": "734702670689",
            "EXPECTED_REGION": "us-east-2",
            "RULE_NAME": "kall-expiry-kall-0123456789abcdef0123456789abcdef",
        }
        self.config = expiry._config(self.environment)
        self.stack = {
            "StackId": "arn:aws:cloudformation:us-east-2:734702670689:stack/kall-sandbox-012345abcdef/uuid",
            "StackStatus": "CREATE_COMPLETE",
            "Tags": [
                {"Key": "SkaldAndStone-ManagedBy", "Value": "kall-session-expiry-v1"},
                {"Key": "SkaldAndStone-SessionId", "Value": self.environment["SESSION_ID"]},
                {"Key": "SkaldAndStone-ExpiresAtEpoch", "Value": "8200"},
            ],
        }

    def test_waits_before_expiry(self):
        self.assertEqual(expiry._evaluate(self.stack, self.config, 8199), "wait")

    def test_deletes_at_expiry(self):
        self.assertEqual(expiry._evaluate(self.stack, self.config, 8200), "delete")

    def test_accepts_existing_delete(self):
        self.stack["StackStatus"] = "DELETE_IN_PROGRESS"
        self.assertEqual(expiry._evaluate(self.stack, self.config, 9000), "deleting")

    def test_rejects_over_two_hours(self):
        bad = dict(self.environment, EXPIRES_AT_EPOCH="8201")
        with self.assertRaises(RuntimeError):
            expiry._config(bad)

    def test_rejects_wrong_account_stack(self):
        self.stack["StackId"] = self.stack["StackId"].replace("734702670689", "000000000000")
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_wrong_stack_name(self):
        self.stack["StackId"] = self.stack["StackId"].replace(
            "kall-sandbox-012345abcdef", "other-stack"
        )
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_missing_or_wrong_tags(self):
        for tag in self.stack["Tags"]:
            if tag["Key"] == "SkaldAndStone-SessionId":
                tag["Value"] = "kall-ffffffffffffffffffffffffffffffff"
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_the_legacy_colon_tag_contract(self):
        for tag in self.stack["Tags"]:
            tag["Key"] = tag["Key"].replace("SkaldAndStone-", "SkaldAndStone:")
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_unstable_stack(self):
        for status in ("UPDATE_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE", "CREATE_FAILED"):
            with self.subTest(status=status):
                self.stack["StackStatus"] = status
                with self.assertRaises(RuntimeError):
                    expiry._evaluate(self.stack, self.config, 9000)

    def test_templates_use_only_the_safe_tag_key_contract(self):
        root = Path(__file__).resolve().parent
        for name in ("kall-session-expiry.template.yaml", "kall-session-expiry.yaml"):
            body = (root / name).read_text()
            self.assertNotIn("SkaldAndStone:", body)
            self.assertIn("SkaldAndStone-SessionId", body)

    def test_templates_omit_reserved_concurrency_and_keep_one_bounded_target(self):
        root = Path(__file__).resolve().parent
        for name in ("kall-session-expiry.template.yaml", "kall-session-expiry.yaml"):
            body = (root / name).read_text()
            self.assertNotIn("ReservedConcurrentExecutions", body)
            self.assertIn("Default: 'false'", body)
            self.assertEqual(body.count("      Targets:\n"), 1)
            self.assertEqual(body.count("        - Arn: !GetAtt ExpiryFunction.Arn\n"), 1)
            self.assertIn("MaximumEventAgeInSeconds: 300", body)
            self.assertIn("MaximumRetryAttempts: 2", body)

        handler = (root / "expiry_handler.py").read_text()
        self.assertIn('ClientRequestToken=f"expiry-{config[\'session_id\']}"', handler)


if __name__ == "__main__":
    unittest.main()
