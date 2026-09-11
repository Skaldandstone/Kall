import { test, expect, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import AxeBuilder from "@axe-core/playwright";

/**
 * Baseline coverage for the mobile app's Expo web build: sign in as a
 * pre-provisioned invite-only user, land on the signed-in tab navigator, and
 * confirm each of the five tabs actually
 * renders its own screen (not a blank view or a crash) before signing out
 * and confirming the app returns to the signed-out auth stack.
 *
 * React Navigation exposes the bottom navigation as real ARIA tabs, so tab
 * changes use getByRole. Other React Native Pressables still render as plain
 * clickable elements on web unless the screen assigns an accessibility role.
 *
 * Identity is Clerk's, so this drives a real dev instance. Public sign-up is
 * deliberately disabled for the invite-only release. The test provisions a
 * narrow synthetic user through Clerk's development Backend API, deletes it
 * in `finally`, and uses Clerk's fixed test code when the browser needs device
 * verification.
 */
const CLERK_API = "https://api.clerk.com/v1";
const CLERK_TEST_CODE = "424242";
const E2E_PASSWORD = "MobileSmokeTest123!";

async function expectNoSeriousAccessibilityViolations(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // React Native Web does not expose browser landmarks; native screen-reader
    // navigation is covered through roles, labels, state, and heading traits.
    .disableRules(["landmark-one-main", "page-has-heading-one", "region"])
    // React Navigation keeps inactive native screens mounted and marks their
    // web wrappers aria-hidden. Audit only the active screen here.
    .exclude('[aria-hidden="true"]')
    .analyze();
  const serious = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  expect(serious, `${screen}: ${serious.map(({ id, help }) => `${id}: ${help}`).join("; ")}`).toEqual([]);
}

function secretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) {
    throw new Error("Mobile E2E requires a Clerk development secret key.");
  }
  return key;
}

async function createTestUser(): Promise<{ id: string; email: string }> {
  const email = `mobile-smoke-${Date.now()}+clerk_test@example.com`;
  const response = await fetch(`${CLERK_API}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email_address: [email],
      password: E2E_PASSWORD,
      first_name: "Mobile",
      last_name: "Smoke Test",
      skip_password_checks: true,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Could not create a Clerk mobile test user: HTTP ${response.status}`,
    );
  }
  return { id: ((await response.json()) as { id: string }).id, email };
}

async function deleteTestUser(id: string): Promise<void> {
  const response = await fetch(`${CLERK_API}/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secretKey()}` },
  }).catch(() => undefined);
  if (response && !response.ok && response.status !== 404) {
    console.warn(
      `Could not remove Clerk mobile test user: HTTP ${response.status}`,
    );
  }
}

async function signInProgrammatically(
  page: Page,
  email: string,
): Promise<void> {
  await clerk.loaded({ page });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await clerk.signIn({
        page,
        signInParams: {
          strategy: "password",
          identifier: email,
          password: E2E_PASSWORD,
        },
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (!/Couldn't find your account/i.test(String(error))) throw error;
      await page.waitForTimeout(1_000 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;

  await page.evaluate(async (code) => {
    const clerkClient = (window as { Clerk?: any }).Clerk;
    const signIn = clerkClient?.client?.signIn;
    if (!signIn || signIn.status === "complete") return;
    await signIn.prepareSecondFactor({ strategy: "email_code" });
    const result = await signIn.attemptSecondFactor({
      strategy: "email_code",
      code,
    });
    if (result?.createdSessionId)
      await clerkClient.setActive({ session: result.createdSessionId });
  }, CLERK_TEST_CODE);
}

async function finishDeviceVerificationIfNeeded(page: Page): Promise<void> {
  const codeField = page.locator(
    'input[placeholder="Verification code"]:visible',
  );
  const today = page.getByText("Today", { exact: true }).first();
  await expect(codeField.or(today)).toBeVisible({ timeout: 20_000 });
  if (await codeField.isVisible()) {
    await codeField.fill(CLERK_TEST_CODE);
    await page.getByText("Verify device").click();
  }
}

test("sign in as an invited user, browse every tab, and sign out", async ({
  page,
}) => {
  await setupClerkTestingToken({ page });
  const user = await createTestUser();

  try {
    await page.goto("/");
    await expect(page.getByText(/Invite-only alpha/)).toBeVisible();
    await expect(page.getByText("Need an account? Create one")).toHaveCount(0);
    await expectNoSeriousAccessibilityViolations(page, "Sign in");
    await signInProgrammatically(page, user.email);

    await test.step("Today is the useful signed-in landing screen", async () => {
      await expect(
        page.getByText("Today", { exact: true }).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Good morning/).first()).toBeVisible({ timeout: 20_000 });
      await expectNoSeriousAccessibilityViolations(page, "Today");
    });

    await test.step("Job search and consulting remain parallel tracks", async () => {
      await page.getByRole("tab", { name: "Job search and consulting" }).click();
      await expect(
        page.getByText("Kall scans your sources and brings the strongest matches here."),
      ).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page, "Job search");
      await expect(page.getByRole("tab", { name: "Job search", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.getByRole("tab", { name: "Consulting", exact: true }).click();
      await expect(page.getByText("Find work, then build the pipeline.")).toBeVisible();
      await expect(page.getByText("Consulting openings for you")).toBeVisible();
      await expect(page.getByText("Set up your consulting offer")).toBeVisible();
      await page.getByRole("tab", { name: "Job search", exact: true }).click();
      await expect(
        page.getByText("Kall scans your sources and brings the strongest matches here."),
      ).toBeVisible();
    });

    await test.step("Applications keeps failure and empty states distinct", async () => {
      await page.route("**/api/me/applications", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporarily unavailable" }),
        }),
      );
      await page.getByRole("tab", { name: "Applications" }).click();
      await expect(
        page.getByText("Applications are unavailable"),
      ).toBeVisible();
      await expect(
        page.getByText("No applications yet", { exact: true }),
      ).toHaveCount(0);
      await page.unroute("**/api/me/applications");
      await page.getByText("Try again", { exact: true }).click();
      await expect(
        page.getByText("No applications yet", { exact: true }),
      ).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page, "Applications");
    });

    await test.step("An application in review shows the package it will be sent with", async () => {
      const application = {
        id: 41,
        status: "review_required",
        job_id: 7,
        career_profile_id: 3,
        base_resume_id: 12,
        prepared_payload: {
          company: "VetsEZ",
          title: "Technical Director of Quality Assurance",
          tailoring_proposal_id: 5,
          cover_letter_proposal_id: 6,
          generated_document_id: 9,
          customize_resume: true,
          generate_cover_letter: true,
        },
      };
      await page.route("**/api/me/applications", (route) =>
        route.fulfill({
          json: {
            summary: { total: 1, active: 1, needs_review: 1, submitted: 0, best_match: 88 },
            stages: [
              {
                key: "review",
                label: "Needs review",
                count: 1,
                items: [{ id: 41, status: "review_required", stage: "review", company: "VetsEZ", role: "Technical Director of Quality Assurance" }],
              },
            ],
            next_decision: null,
            generated_at: new Date().toISOString(),
          },
        }),
      );
      await page.route("**/api/applications/41/review", (route) =>
        route.fulfill({
          json: {
            application,
            review: {
              status: "review_required",
              readiness_issues: ["Confirm final resume and cover letter"],
              documents_confirmed: false,
              answers_confirmed: false,
              sensitive_fields_confirmed: false,
              attestations_confirmed: false,
            },
            questions: [],
            answers: [],
          },
        }),
      );
      await page.route("**/api/applications/41", (route) => route.fulfill({ json: application }));
      await page.route("**/api/me/resume-studio", (route) =>
        route.fulfill({ json: { resumes: [{ id: 12, name: "QA leadership resume", version: 3, tags: [], industries: [], target_titles: [], is_default: true, updated_at: "2026-09-01T00:00:00Z", readiness: { score: 90, strengths: [], gaps: [], explanation: "" } }], profiles: [] } }),
      );
      await page.route("**/api/tailoring/proposals/5", (route) =>
        route.fulfill({
          json: {
            proposal: { id: 5, job_id: 7, resume_id: 12, status: "finalized", unsupported_requirements: [], finalized_at: "2026-09-10T00:00:00Z" },
            changes: [
              { id: 1, section: "summary", original_text: "Led QA.", proposed_text: "Led QA for federal health platforms.", edited_text: null, reason: "Match the posting", evidence: [], immutable_tokens: [], status: "accepted" },
              { id: 2, section: "skills", original_text: "Jira", proposed_text: "Jira, Xray", edited_text: null, reason: "Tooling", evidence: [], immutable_tokens: [], status: "rejected" },
            ],
          },
        }),
      );
      await page.route("**/api/cover-letters/6", (route) =>
        route.fulfill({
          json: {
            proposal: { id: 6, status: "finalized", emphasis: "balanced", tone: "formal", length: "standard" },
            changes: [
              { id: 61, position: 0, proposed_text: "I have led quality organizations through FedRAMP audits.", edited_text: null, status: "accepted" },
              { id: 62, position: 1, proposed_text: "This paragraph was cut.", edited_text: null, status: "rejected" },
            ],
          },
        }),
      );
      await page.route("**/api/documents/9", (route) =>
        route.fulfill({
          json: {
            document: { id: 9, template_key: "executive", checksum: "abc", document_type: "resume", content_json: { sections: [{ section: "summary", text: "Led QA for federal health platforms." }, { section: "experience", text: "Director of QA, 2019-2026." }] } },
            artifacts: [{ id: 1, format: "pdf", mime_type: "application/pdf", byte_size: 1024 }, { id: null, format: "docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byte_size: null }],
            coverage: null,
          },
        }),
      );
      await page.route("**/api/applications/41/autofill-pack", (route) =>
        route.fulfill({
          json: {
            application_id: 41,
            job: { company: "VetsEZ", title: "Technical Director of Quality Assurance", url: "https://jobs.example.com/vetsez/qa" },
            provider: "manual",
            fields: [
              { path: "identity.legal_name", label: "Legal name", value: "Test Candidate", tier: "always", requires_confirmation: false },
              { path: "identity.phone", label: "Phone", value: "555-0100", tier: "opt_in", requires_confirmation: false },
              { path: "work_authorization.authorized", label: "Authorized to work in the United States", value: true, tier: "always_confirm", requires_confirmation: true },
            ],
            resume: null,
            screening_answers: [],
            omitted: [{ path: "identity.address", label: "Street address", reason: "Not allowed for autofill" }],
          },
        }),
      );
      await page.route("**/api/submissions", (route) => route.fulfill({ json: [] }));

      await page.getByRole("tab", { name: "Today" }).click();
      await page.getByRole("tab", { name: "Applications" }).click();
      await page.getByText("Technical Director of Quality Assurance", { exact: true }).first().click();

      await expect(page.getByText("QA leadership resume", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/Tailoring finalized: 1 change kept, 1 rejected/)).toBeVisible();
      await expect(page.getByText("Led QA for federal health platforms.").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Open PDF" })).toBeVisible();
      await expect(page.getByText("I have led quality organizations through FedRAMP audits.")).toBeVisible();
      await expect(page.getByText("This paragraph was cut.")).toHaveCount(0);
      await expect(page.getByText("Test Candidate", { exact: true })).toBeVisible();
      await expect(page.getByText("Sensitive fields you have allowed")).toBeVisible();
      await expect(page.getByText("Street address: Not allowed for autofill")).toBeVisible();
      await expect(page.getByText("Authorized to work in the United States")).toBeVisible();
      await expect(page.getByText(/no screening questions Kall could detect/)).toBeVisible();
      await expect(page.getByLabel("Documents reviewed")).toBeEnabled();
      await expect(page.getByText("Finish the resume and cover letter above first.")).toHaveCount(0);
      await expectNoSeriousAccessibilityViolations(page, "Application review");

      for (const pattern of [
        "**/api/me/applications", "**/api/applications/41/review", "**/api/applications/41", "**/api/me/resume-studio",
        "**/api/tailoring/proposals/5", "**/api/cover-letters/6", "**/api/documents/9", "**/api/applications/41/autofill-pack", "**/api/submissions",
      ]) {
        await page.unroute(pattern);
      }
    });

    await test.step("Growth tab renders", async () => {
      await page.getByRole("tab", { name: "Growth" }).click();
      await expect(
        page.getByText("A practical plan shaped around where you want to go next."),
      ).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page, "Growth");
    });

    await test.step("Today tab renders", async () => {
      await page.getByRole("tab", { name: "Today" }).click();
      await expect(page.getByText(/Good morning/).first()).toBeVisible({ timeout: 20_000 });
    });

    await test.step("Profile tab renders and signs out", async () => {
      let createdProfile: Record<string, unknown> | undefined;
      await page.route("**/api/me/career-profiles", (route) =>
        route.fulfill({ json: { profiles: [] } }),
      );
      await page.route("**/api/me/resume-studio", (route) =>
        route.fulfill({ json: { resumes: [], profiles: [] } }),
      );
      await page.route("**/api/me/professional-profiles", async (route) => {
        createdProfile = route.request().postDataJSON();
        await route.fulfill({ json: { id: 27, ...createdProfile } });
      });
      await page.getByRole("tab", { name: "Profile" }).click();
      await expect(
        page.getByText("Career profiles", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Resumes", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Notifications", { exact: true }),
      ).toBeVisible();
      await expectNoSeriousAccessibilityViolations(page, "Profile");
      await page.getByText("Career profiles", { exact: true }).click();
      await expect(page.getByText("Build a direction with Kall")).toBeVisible();
      await page.getByText("Start guided profile", { exact: true }).click();
      await page.getByLabel("What should we call this career direction?").fill("Quality leadership");
      await page.getByText("Keep this answer", { exact: true }).click();
      await page.getByLabel("Add roles").fill("QA Director");
      await page.getByRole("button", { name: "Confirm roles entry" }).click();
      await expect(page.getByText("QA Director", { exact: true })).toBeVisible();
      await page.getByLabel("Add roles").fill("Head of Quality");
      await page.getByRole("button", { name: "Confirm roles entry" }).click();
      await expect(page.getByText("Head of Quality", { exact: true })).toBeVisible();
      await page.getByText("Keep this answer", { exact: true }).click();
      // Ten questions as of the guided-profile rewrite: required ones offer
      // "Leave open for now", optional ones offer "Skip this" instead. Walk
      // whichever is on screen until the review step appears.
      const review = page.getByText("Review your direction");
      for (let guard = 0; guard < 12 && !(await review.isVisible()); guard += 1) {
        const leaveOpen = page.getByText("Leave open for now", { exact: true });
        const skip = page.getByText("Skip this", { exact: true });
        await expect(leaveOpen.or(skip).or(review)).toBeVisible();
        if (await review.isVisible()) break;
        if (await leaveOpen.isVisible()) await leaveOpen.click();
        else await skip.click();
      }
      await expect(review).toBeVisible();
      await page.getByText("Create this profile", { exact: true }).click();
      await expect.poll(() => createdProfile).toMatchObject({
        name: "Quality leadership",
        target_titles: ["QA Director", "Head of Quality"],
      });
      await page.getByRole("tab", { name: "Today" }).click();
      await page.getByRole("tab", { name: "Profile" }).click();
      await page.getByText("Sign out").click();
      await expect(
        page.getByText("Sign in to your career workspace."),
      ).toBeVisible();
    });

    await test.step("Mobile password sign-in returns to the workspace", async () => {
      await page.locator('input[placeholder="Email"]:visible').fill(user.email);
      await page
        .locator('input[placeholder="Password"]:visible')
        .fill(E2E_PASSWORD);
      await page.getByText("Sign in", { exact: true }).click();
      await finishDeviceVerificationIfNeeded(page);
      await expect(
        page.getByText("Today", { exact: true }).first(),
      ).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    await deleteTestUser(user.id);
  }
});
