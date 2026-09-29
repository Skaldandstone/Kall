# App Review notes draft for Kall 1.2.0 (21)

Reviewer access remains a submission prerequisite. Before submission, enter the
dedicated reviewer username and password in App Store Connect, confirm the same
identity exists in production Clerk, and verify a native sign-in. Do not paste
credentials into this file or the free-form notes field.

Kall is a career-search assistant for people pursuing full-time roles,
consulting work, or both. It helps users build reviewed career profiles, find
opportunities, prepare application materials, track applications and consulting
work, and manage career next steps. Kall never submits a job application,
contacts a lead, or publishes a career page without the user's action.

After a successful sign-in, the reviewer lands on Today. The main review path
uses the labels visible in the submitted build:

1. Today: review the daily brief and suggested next actions.
2. Work: switch between job search and consulting opportunities.
3. Apply: review tracked applications and prepared materials.
4. Growth: review career-development and interview-preparation tools.
5. Profile: open Plan and billing for native subscriptions, or choose Delete my
   account to inspect the confirmation screen.

Plus and Premium are monthly auto-renewing subscriptions sold through Apple's
native purchase flow in this iOS build. From Profile, choose Plan and billing to
see both products and their localized prices from the App Store. The purchase actions are
Choose Kall Plus and Choose Kall Premium. A reviewer can open either Apple
purchase sheet and cancel without completing a transaction. Restore purchases
is on the same screen. Apple's sandbox should be used for any completed review
purchase.

The submitted build presents email, Google, and Apple sign-in controls. Verify
the dedicated review identity against production before submission so the
primary product areas can be inspected without creating career data. Account
deletion is available from Profile through Delete my account, requires the
account email, and presents a final destructive confirmation.

The reviewer identity and App Store Connect username/password, requested
physical-device recording, and separate native Plus and Premium
subscription-review screenshots remain submission prerequisites. Do not state
that access or media is ready until every field is populated and visually
verified in App Store Connect. Simulator captures are internal QA evidence only
and cannot satisfy the physical-device App Review gate.
