from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = (
    ROOT / ".github" / "workflows" / "ci.yml",
    ROOT / ".github" / "workflows" / "manual-build.yml",
)


def test_github_workflows_cannot_deploy_to_the_retired_aws_project() -> None:
    for path in WORKFLOWS:
        body = path.read_text()
        assert "KALL_DEPLOY_AWS_ACCESS_KEY_ID" not in body
        assert "KALL_DEPLOY_AWS_SECRET_ACCESS_KEY" not in body
        assert "693272753663" not in body
        assert "kall-api-build" not in body
        assert "kall-web-build" not in body
        assert "\n  deploy:\n" not in body
        assert "deploy_api" not in body
        assert "deploy_web" not in body


def test_retired_account_buildspecs_are_not_executable_release_inputs() -> None:
    legacy_directory = ROOT / "ops" / "codebuild"
    assert not (legacy_directory / "kall-api.buildspec.yml").exists()
    assert not (legacy_directory / "kall-web.buildspec.yml").exists()


def test_obsolete_duplicate_build_workflow_is_removed() -> None:
    assert not (ROOT / ".github" / "workflows" / "build.yml").exists()


def test_ci_is_the_single_complete_automatic_source_gate() -> None:
    body = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert "push:\n    branches: [main]" in body
    assert "pull_request:" in body
    for job in ("backend", "web", "e2e", "accessibility", "extension", "mobile-e2e"):
        assert f"\n  {job}:\n" in body
    assert body.count("npm ci") == 5
    assert body.count('node-version: "24.18.1"') == 5


def test_manual_workflow_remains_explicitly_build_only() -> None:
    body = (ROOT / ".github" / "workflows" / "manual-build.yml").read_text()
    assert "workflow_dispatch:" in body
    assert body.count('node-version: "24.18.1"') == 2
    assert "jobs:\n  web:" in body
    assert "\n  extension:\n" in body
    assert "cloud credentials or deployment controls" in body


def test_mobile_registration_is_open_like_web_but_the_invite_only_ui_stays_testable() -> None:
    app_config = (ROOT / "apps" / "mobile" / "app.config.js").read_text()
    playwright_config = (ROOT / "apps" / "mobile" / "playwright.config.ts").read_text()
    # A release build no longer hard-codes invite-only -- it follows app.json
    # like any other build, the same way the web app's own gate now does.
    assert "isRelease\n        ? false" not in app_config
    # The override that lets a test force either state regardless of build
    # type still exists, so the invite-only screen stays exercisable.
    assert "KALL_MOBILE_ALLOW_REGISTRATION" in app_config
    assert "process.env.KALL_MOBILE_ALLOW_REGISTRATION ?? '0'" in playwright_config
