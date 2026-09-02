# Legal and contact facts

Kall's public legal pages are driven by facts about the business, not about the
codebase: where it receives mail, which mailbox a deletion request reaches, what
refund a customer is actually owed. **No session should invent any of them.** A
guess that ships is worse than a blank, because a blank is visible and a guess is
not.

## Where they live

One file: [`apps/web/app/lib/legal.ts`](../apps/web/app/lib/legal.ts).

Fill a value in there once and it appears everywhere it is needed. Nothing else
in the repository should hardcode an address, a mailbox, a refund term, or a
governing-law state.

Anything still `null` renders on the live page as a yellow
`[... not set - see docs/LEGAL.md]` marker, and is listed by
`unresolvedLegalFacts()`. When that function returns an empty array, the legal
pages are ready to be public.

## What consumes them

| Page | Route | Public |
|---|---|---|
| Terms of Service | `/terms` | yes |
| Privacy Policy | `/privacy-policy` | yes |
| Support | `/support` | yes |

All three are linked from the site footer and allowed through `middleware.ts`
signed-out, because a person deciding whether to sign up, and a person whose
account is broken, both have to be able to read them.

## Settled (2026-09-02)

| Fact | Value |
|---|---|
| Operator | Skald and Stone LLC |
| Formation state | Washington |
| Governing law and venue | Washington |
| Mailing address | Registered Agents Inc, 100 N Howard St Ste R, Spokane, WA 99201 |
| Privacy contact | privacy@skaldandstone.com |
| Support contact | support@skaldandstone.com |
| Security contact | security@skaldandstone.com |
| Support reply target | 2 business days |
| Refunds | No refunds; cancelling stops the next renewal and paid access runs out the period |
| Minimum age | 18, or the local age of majority if higher |

The refund stance is `'no-refunds-cancel-anytime'`. Statutory refund rights are
still honored where they apply, and the Terms say so. Switching later is a
one-line change to `refundStance`; the Terms render whichever paragraph matches.

The minimum age is a policy choice rather than a looked-up fact, so it is written
into `/terms` section 2 directly rather than into `legal.ts`. The Privacy Policy
separately says Kall is not directed to children under 13, which is the standard
COPPA line and does not conflict.

## The mailing address is a registered agent, on purpose

`/terms` and `/privacy-policy` publish
`100 N Howard St Ste R, Spokane, WA 99201` - the Washington address of
Registered Agents Inc, the commercial registered agent for Skald and Stone LLC.

It is not a residential address, and it must never become one. What goes on a
legal page is permanently public and indexed, and cannot be quietly taken back
down. A commercial agent was chosen over a PO box because Washington requires
the registered agent to have a physical in-state street address and bars PO
boxes and private mailboxes from that role (RCW 23.95.400-.460) - so a PO box
would have covered the website while leaving a home address on the public
Secretary of State record, which is the more exposed of the two.

If this ever needs replacing, replace it with another business address. **Never
with a home address, not even as a placeholder.**

The change of registered agent was filed with the Washington Secretary of State
on 2026-09-02, so the state record and the published address now agree.

One thing still to confirm with the agent, not from here: whether mail addressed
to `Skald and Stone LLC` at that suite, with no `c/o Registered Agents Inc`
line, is delivered. The pages print the operator name on the line above the
street address, so that is the form a person will actually write. If the agent
needs the `c/o`, add it as the first entry in the `mailingAddress` array.

## The mailboxes: done, and the trap that nearly broke them

`privacy@`, `support@` and `security@` were created as Google Workspace groups on
skaldandstone.com on 2026-09-02, each with James as owner, and a test message to
each was sent and received. `mailboxesProvisioned` is `true` and
`unresolvedLegalFacts()` now returns an empty array: **the legal facts are
complete.**

**The default would have broken all three.** A new Google group only accepts
posts from inside the organization; an outsider emailing it is rejected. A
published privacy address that bounces the public is worse than publishing none
- a regulator reads an undeliverable privacy mailbox as a failure to respond to
a request, and a bouncing support address is a rejection reason at both Stripe
and the app stores. So "Who can post" was set to include External on all three,
while "Who can view conversations" was left internal-only (outsiders can send,
but cannot read the archive) and external membership was left off entirely.

That toggle is flaky in the admin console - it silently failed to apply on one
group and needed re-clicking. All three were verified afterwards from their
detail pages, each reading "Anyone can post content". **Re-check it on any group
added later.**

The test that mattered was sent from **outside** the organization. That
qualifier is the whole point: an internal test would have passed without ever
exercising the path the public uses. **If any of these addresses is ever changed
or recreated, set `mailboxesProvisioned` back to `false` until an external test
message has landed again.**

Anything still `null` in `legal.ts`, and this flag being `false`, are what
`unresolvedLegalFacts()` reports. A launch check should assert it returns an
empty array; today it does.

## Why a privacy mailbox is still needed

Kall does have self-service account deletion, and the pages now lead with it
rather than inviting a request. But deletion is one right out of several, and it
is the only one Kall automates:

- **Access and portability have no self-service path at all.** There is no data
  export anywhere in the product; `backend/kall/api_admin_portal.py:15` records
  that a bulk data-subject export was deliberately left out. Someone asking for
  a copy of their data can only be served by a human reading privacy@.
- **Correction** beyond editing your own profile fields, for example a record
  held in a support log.
- **Anyone who cannot sign in** - locked out, an already-deleted account, or a
  person acting under a legal authority - has no settings page to use.
- Both GDPR and CCPA expect a designated, published contact for requests. A
  product with no such address does not satisfy that by having a delete button.

If a real data export ever ships, revisit this section; the mailbox will still be
required, but it would stop being the only route to a copy of one's data.

## Known gap this surfaced

**Deleting an account does not cancel a Stripe subscription.** `DELETE /me` ->
`services/account_deletion.py` removes every local row, including the billing
ones, and deletes the Clerk identity, but nothing calls Stripe to cancel the
subscription. A paying customer who deletes their account can keep being
charged, with no account left to cancel from. The Terms currently tell people to
cancel first (section 9), which is honest but is not a fix. This should be fixed
before public launch, not documented around.

## Review before launch

These pages are written to be accurate about what Kall actually does, and the
account-closure section is drawn from the deletion code rather than from a
template. They have **not** been reviewed by a lawyer. Before public launch, a
Washington-licensed attorney should read `/terms` and `/privacy-policy`,
particularly the liability cap, the arbitration position (there is no
arbitration clause at present, which is deliberate but is a choice), and the
California and international-transfer language in the Privacy Policy.
