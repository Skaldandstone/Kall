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
            "DELETION_ROLE_ARN": (
                "arn:aws:iam::734702670689:role/"
                "kall-expiry-kall-0123456789abcdef0123456789abcdef-delete"
            ),
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

    def test_recovers_only_an_expired_delete_failed_stack(self):
        self.stack["StackStatus"] = "DELETE_FAILED"
        self.assertEqual(expiry._evaluate(self.stack, self.config, 8199), "wait")
        self.assertEqual(expiry._evaluate(self.stack, self.config, 8200), "recover-delete")

        arguments = expiry._delete_arguments(self.stack, self.config, "recover-delete")
        self.assertEqual(arguments["StackName"], self.stack["StackId"])
        self.assertEqual(
            arguments["ClientRequestToken"],
            "expiry-v8-kall-0123456789abcdef0123456789abcdef",
        )
        self.assertEqual(arguments["RoleARN"], self.environment["DELETION_ROLE_ARN"])

    def test_rejects_a_deletion_role_outside_the_exact_session(self):
        bad = dict(self.environment, DELETION_ROLE_ARN="arn:aws:iam::734702670689:role/other")
        with self.assertRaises(RuntimeError):
            expiry._config(bad)

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

    def test_function_writes_to_the_retained_custom_log_group(self):
        root = Path(__file__).resolve().parent
        for name in ("kall-session-expiry.template.yaml", "kall-session-expiry.yaml"):
            body = (root / name).read_text()
            self.assertIn("      LoggingConfig:\n        LogGroup: !Ref ExpiryLogGroup", body)
            self.assertEqual(body.count("LogGroup: !Ref ExpiryLogGroup"), 1)
            self.assertNotIn("DependsOn: ExpiryLogGroup", body)
            self.assertNotIn("/aws/lambda/", body)

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
        self.assertIn('token_prefix = "expiry-v8" if action == "recover-delete" else "expiry"', handler)
        self.assertIn('"RoleARN": str(config["deletion_role_arn"])', handler)

    def test_cloudformation_uses_a_dedicated_bounded_deletion_role(self):
        root = Path(__file__).resolve().parent
        guard = (root / "expiry.guard").read_text()
        self.assertIn(".'Fn::GetAtt' == 'RuntimeDeletionRole.Arn'", guard)
        self.assertNotIn(".'Fn::GetAtt'[0]", guard)
        required_actions = {
            "cloudwatch:DeleteAlarms",
            "ec2:RevokeSecurityGroupIngress",
            "ecs:DescribeServices",
            "elasticloadbalancing:DescribeRules",
            "rds:DeleteDBInstance",
            "cloudfront:UpdateDistribution",
            "iam:DeleteRolePolicy",
        }
        for name in ("kall-session-expiry.template.yaml", "kall-session-expiry.yaml"):
            body = (root / name).read_text()
            self.assertIn("Service: cloudformation.amazonaws.com", body)
            self.assertIn("Action: iam:PassRole", body)
            self.assertIn("iam:PassedToService: cloudformation.amazonaws.com", body)
            self.assertIn("DELETION_ROLE_ARN: !GetAtt RuntimeDeletionRole.Arn", body)
            self.assertIn(
                "- Sid: DeregisterRuntimeTaskDefinitions\n"
                "                Effect: Allow\n"
                "                Action: ecs:DeregisterTaskDefinition\n"
                "                Resource: '*'",
                body,
            )
            self.assertEqual(body.count("ecs:DeregisterTaskDefinition"), 1)
            self.assertIn(
                "- Sid: SnapshotExactDatabase\n"
                "                Effect: Allow\n"
                "                Action: rds:CreateDBSnapshot\n"
                "                Resource:\n"
                "                  - !Sub arn:${AWS::Partition}:rds:${ExpectedRegion}:${ExpectedAccount}:db:kall-alpha-postgres\n"
                "                  - !Sub arn:${AWS::Partition}:rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:kall-sandbox-29f1815c16c9-snapshot-database-*\n"
                "                Condition:\n"
                "                  StringEquals:\n"
                "                    aws:RequestedRegion: !Ref ExpectedRegion",
                body,
            )
            self.assertEqual(body.count("rds:CreateDBSnapshot"), 1)
            self.assertEqual(
                body.count("rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:"), 2
            )
            for broad_snapshot_pattern in (
                "rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:*",
                "rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:kall-sandbox-*",
                "rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:kall-sandbox-29f1815c16c9-*",
                "rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:kall-sandbox-29f1815c16c9-snapshot-*",
            ):
                self.assertNotIn(broad_snapshot_pattern, body)
            rds_create_actions = [
                line.strip().removeprefix("- ").removeprefix("Action: ")
                for line in body.splitlines()
                if "rds:Create" in line
            ]
            self.assertEqual(rds_create_actions, ["rds:CreateDBSnapshot"])
            self.assertIn(
                "- Sid: TagExactDatabaseSnapshot\n"
                "                Effect: Allow\n"
                "                Action: rds:AddTagsToResource\n"
                "                Resource: !Sub arn:${AWS::Partition}:rds:${ExpectedRegion}:${ExpectedAccount}:snapshot:kall-sandbox-29f1815c16c9-snapshot-database-*\n"
                "                Condition:\n"
                "                  StringEquals:\n"
                "                    aws:RequestedRegion: !Ref ExpectedRegion",
                body,
            )
            self.assertEqual(body.count("rds:AddTagsToResource"), 1)
            self.assertNotIn("rds:RemoveTagsFromResource", body)
            for role_name in (
                "kall-alpha-api-execution",
                "kall-alpha-api-task",
                "kall-alpha-web-execution",
                "kall-alpha-web-task",
                "kall-alpha-bootstrap-execution",
                "kall-alpha-migration-execution",
            ):
                self.assertIn(f"role/{role_name}", body)
            self.assertNotIn("role/${ManagedStackName}-*", body)
            self.assertIn(
                "Action: logs:DeleteLogGroup\n"
                "                Resource: !Sub arn:${AWS::Partition}:logs:${ExpectedRegion}:${ExpectedAccount}:log-group:/skaldandstone/alpha/kall-database-admin",
                body,
            )
            self.assertEqual(body.count("logs:DeleteLogGroup"), 1)
            self.assertNotIn("log-group:/skaldandstone/alpha/kall-api", body)
            self.assertNotIn("log-group:/skaldandstone/alpha/kall-web", body)
            self.assertNotIn("logs:${ExpectedRegion}:${ExpectedAccount}:log-group:/skaldandstone/development/kall-expiry", body)
            for action in required_actions:
                self.assertIn(f"- {action}", body)
            for forbidden in ("ec2:Create", "ecs:RegisterTaskDefinition", "secretsmanager:"):
                self.assertNotIn(forbidden, body)


if __name__ == "__main__":
    unittest.main()
