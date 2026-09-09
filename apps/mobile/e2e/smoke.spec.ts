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
      await expect(page.getByText("Ask Kall to find consulting leads")).toBeVisible();
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
      for (let question = 2; question < 7; question += 1) {
        await page.getByText("Leave open for now", { exact: true }).click();
      }
      await expect(page.getByText("Review your direction")).toBeVisible();
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
