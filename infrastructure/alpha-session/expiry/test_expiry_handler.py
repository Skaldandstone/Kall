import os
import sys
import unittest

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
                {"Key": "SkaldAndStone:ManagedBy", "Value": "kall-session-expiry-v1"},
                {"Key": "SkaldAndStone:SessionId", "Value": self.environment["SESSION_ID"]},
                {"Key": "SkaldAndStone:ExpiresAtEpoch", "Value": "8200"},
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
        self.stack["StackId"] = self.stack["StackId"].replace("kall-sandbox-012345abcdef", "other-stack")
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_missing_or_wrong_tags(self):
        for tag in self.stack["Tags"]:
            if tag["Key"] == "SkaldAndStone:SessionId":
                tag["Value"] = "kall-ffffffffffffffffffffffffffffffff"
        with self.assertRaises(RuntimeError):
            expiry._evaluate(self.stack, self.config, 9000)

    def test_rejects_unstable_stack(self):
        for status in ("UPDATE_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE", "CREATE_FAILED"):
            with self.subTest(status=status):
                self.stack["StackStatus"] = status
                with self.assertRaises(RuntimeError):
                    expiry._evaluate(self.stack, self.config, 9000)


if __name__ == "__main__":
    unittest.main()
