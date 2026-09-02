"""The web tier's half of the invite-only gate.

The backend decides who may *use* Kall (`_assert_alpha_access`). The Next.js
middleware decides who may *reach the sign-up screen at all*, and the two auth
pages decide what the screen claims about access. All three read the same
`ALPHA_INVITE_ONLY` variable, which is exactly the property worth pinning: a
build where the API opened up but the browser still redirected `/sign-up` away
-- or still promised "your invitation" to a member of the public -- would be a
worse state than either consistent one.

There is no JS unit-test runner in this repo (web coverage is Playwright e2e
against a running app and a live Clerk instance), so this asserts the contract
textually the same way `test_production_infrastructure.py` asserts the template.
"""

from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "apps" / "web"
MIDDLEWARE = WEB / "middleware.ts"
SIGN_IN = WEB / "app" / "sign-in" / "[[...sign-in]]" / "page.tsx"
SIGN_UP = WEB / "app" / "sign-up" / "[[...sign-up]]" / "page.tsx"

FLAG = "process.env.ALPHA_INVITE_ONLY === 'true'"


def test_signup_redirect_is_gated_on_the_flag_and_admits_invitation_tickets() -> None:
    middleware = MIDDLEWARE.read_text()

    # Fails closed on anything but the exact string 'true'? No -- deliberately the
    # opposite. An unset variable in the *browser* tier only affects copy and a
    # redirect; the API is the security boundary and rejects unset explicitly in
    # production (backend/kall/config.py). Keeping both tiers on the identical
    # comparison is what stops them disagreeing.
    assert FLAG in middleware
    assert "const hasInvitationTicket = request.nextUrl.searchParams.has('__clerk_ticket');" in middleware
    # Invite-only: /sign-up without a Clerk ticket goes to /alpha. With a ticket,
    # an invited user still completes registration -- that is the whole invite flow.
    assert "if (inviteOnly && isSignUp && !hasInvitationTicket) {" in middleware
    assert "return NextResponse.redirect(new URL('/alpha', request.url));" in middleware
    # Public signup: the guard is the only thing standing between a signed-out
    # visitor and the page, so /sign-up must remain a public route either way.
    assert "'/sign-up(.*)'," in middleware


def test_auth_page_copy_follows_the_same_flag() -> None:
    sign_in = SIGN_IN.read_text()
    sign_up = SIGN_UP.read_text()

    for page in (sign_in, sign_up):
        assert f"const inviteOnly = {FLAG};" in page
        assert "inviteOnly ?" in page

    # Invitation language must not be unconditional on either page.
    assert "'Private alpha invitation'" in sign_up
    assert "'Create your account'" in sign_up
    assert "'Private alpha'" in sign_in
    assert "'Welcome back'" in sign_in

    # Clerk's own "Sign up" footer link is a dead end while invite-only, and the
    # obvious next step once it is not. Hiding it must therefore be conditional.
    assert "...(inviteOnly ? { footerAction: { display: 'none' } } : {})," in sign_in
