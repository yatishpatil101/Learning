# Manual verification — sandbox and production

How to prove a deployed environment works. The Playwright suite already proves the app's logic
against mocks; this page covers only what it cannot reach:

- **Real vendors** — WhatsApp OTP, Cashfree payments and webhooks, R2 storage, Google Maps,
  Cashfree Secure ID, Turnstile.
- **Deployed wiring** — the Pages proxy, `ORIGIN_SHARED_SECRET`, cookies, CORS on R2.
- **Real devices** — camera capture, touch, Android back, iOS Safari.

| Environment | What to run | When |
|---|---|---|
| local | `e2e\run-fast.ps1 -Full` green | Before any deploy. A red suite does not go to sandbox. |
| sandbox | §1 + §2 (full regression) | Before every production release |
| prod | §1 + §3 (smoke) | After every production deploy, ~20 minutes |
| both | §4 (logs) | After every run |

## Ground rules

- **Every login is a real WhatsApp OTP.** The fixed OTP code, the "any code works" sender and the
  self-grant Verified badge are `@LocalOnly` and do not exist outside `local`
  ([`system/profiles.md`](./system/profiles.md#local-only)). There is no shortcut, and adding one to
  a deployed environment would be a login bypass.
- **Maker-checker needs two operators.** Rent-agreement refund approval and hard-signal listing
  co-approval refuse the same person on both sides, so each environment needs a second back-office
  account with the relevant permission, not a second administrator.
- **Production never-do list** — these touch real people:
  - Never **approve** a test listing. It goes public, into search, sitemaps and alerts.
  - Never **unlock a real owner's contact** from a test account. That discloses a real person's
    number for no purpose (DPDP).
  - Never **message, offer on, or book a visit** to a real user's listing.
  - Never create a **deal or tenancy** against a real user.

## Test accounts

Mobile numbers live in the team password manager, never in this repo.

| Actor | Role | Sandbox | Prod |
|---|---|---|---|
| Buyer, free tier | `buyer` | team member's number | company SIM |
| Buyer, paid plan | `buyer` | team member's number | company SIM (see §5) |
| Tenant | `buyer` holding a tenancy | team member's number | sandbox only — a tenancy needs a counterparty |
| Owner, free tier | `owner` | team member's number | company SIM |
| Owner, paid plan | `owner` | team member's number | company SIM (see §5) |
| Staff, one per team in use | `staff` | team member's number | company SIM |
| Admin × 2 | `admin` | team members' numbers | company SIMs |

Keep free-tier accounts even once paid ones exist: an unlimited account never hits a gate, so it
cannot tell you the gate works.

## 1. Wiring — both environments, no login

Set `HOST` to `https://sandbox.draazy.com` or the production origin.

```bash
curl -fsS "$HOST/api/actuator/health"                                   # {"status":"UP"}
curl -fsS "$HOST/" | grep -c '<div id="root"'                           # 1
curl -fsS -D - -o /dev/null "$HOST/api/properties" | grep -i content-type  # application/json
curl -s -o /dev/null -w '%{http_code}\n' "$HOST/api/me"                 # 401, not 500
curl -s -o /dev/null -w '%{http_code}\n' "$CLOUD_RUN_URL/api/properties" # 403
```

Health alone proves nothing: a mismatched `ORIGIN_SHARED_SECRET` keeps health green while every real
`/api` call answers 403. The third line is the real check — an HTML content type means the SPA
shell answered instead of the API. The failure table is in
[`DEPLOY_WALKTHROUGH.md`](./DEPLOY_WALKTHROUGH.md) (§ smoke test).

## 2. Sandbox — full regression

Test **journeys across roles**, not pages: most production bugs sit at the hand-off between two
actors. Each journey links the flow doc that defines the expected behaviour. Run the ones marked 📱 on
one Android phone (Chrome) and one iPhone (Safari) as well as desktop.

**A. Sign-in** 📱 — [auth](./flows/consumer/auth.md)
- [ ] Consumer signs up by mobile; the OTP arrives on WhatsApp within a minute
- [ ] Wrong OTP is refused with a clear message; resend works
- [ ] Session survives a refresh; sign-out ends it
- [ ] Staff and admin sign in at `/staff-login` and land in their own console, not the consumer app

**B. Owner lists a property** 📱 — [list-property-wizard](./flows/consumer/list-property-wizard.md)
- [ ] Free owner completes the wizard with photos taken on the phone
- [ ] Photos load back from R2 (a broken image here is R2 CORS)
- [ ] Map pin and locality are right
- [ ] Listing lands as pending; a second listing is refused at the free-tier limit

**C. Verification** — [property-verification](./flows/admin/property-verification.md)
- [ ] Staff sees the listing in the queue; approve stays disabled until every check is ticked
- [ ] Approve publishes it; the owner is notified
- [ ] Reject on a second listing: the owner sees the reason

**D. Discovery** 📱 — [search-listings](./flows/consumer/search-listings.md), [property-detail](./flows/consumer/property-detail.md), [societies](./flows/consumer/societies.md), [saved-alerts](./flows/consumer/saved-alerts.md)
- [ ] The listing from C appears in search, with filters and on the map
- [ ] Property page, society page and locality page render
- [ ] Save the property and a search; a matching new listing raises an alert

**E. Contact gate** 📱 — [contact-gate-leads](./flows/consumer/contact-gate-leads.md)
- [ ] Free buyer reveals contacts up to the free allowance, then hits the gate
- [ ] The owner sees the enquiry in their inbox

**F. Payments** 📱 — [plans-billing-refer](./flows/consumer/plans-billing-refer.md)
- [ ] Buy a plan with a Cashfree sandbox test card; the plan activates **from the webhook**, not
      from the browser redirect (close the tab before returning and it must still activate)
- [ ] The buyer from E is no longer gated; `/me/entitlements` agrees
- [ ] An abandoned checkout grants nothing; a second checkout while one is unpaid names the first
- [ ] The payment appears in admin finance

**G. Visit → offer → deal** — [schedule-visit](./flows/consumer/schedule-visit.md), [deals-offers-finalization](./flows/consumer/deals-offers-finalization.md)
- [ ] Buyer books a visit; owner confirms and completes it
- [ ] Buyer offers, owner counters, buyer accepts
- [ ] Buyer requests finalization, owner accepts; the deal closes (and a rental creates a tenancy)

**H. Tenancy** — [rent-tenancy](./flows/consumer/rent-tenancy.md)
- [ ] The tenant sees the tenancy; the owner's rent ledger records a payment

**I. Identity verification** 📱 — [contact-gate-leads §9](./flows/consumer/contact-gate-leads.md#9-identity-verification-hardware-checklist), [users-kyc](./flows/admin/users-kyc.md)
- [ ] Capture front, back and selfie on a real phone camera
- [ ] Staff sees all three images; approval requires confirming the server-chosen pose
- [ ] The badge appears on the user and on their listings; the WhatsApp decision message arrives

**J. Rent agreement** — [rent-agreement](./flows/consumer/rent-agreement.md), [service-queues](./flows/ops/service-queues.md)
- [ ] Pay for an agreement; it reaches the drafting desk
- [ ] Draft is shared, the customer accepts, the final document is delivered
- [ ] Refund: one operator requests, a different one approves; the refund shows in Cashfree

**K. Everything else**
- [ ] Flatmates: post a room and a seeker post; ops moderates them — [flatmates](./flows/consumer/flatmates.md), [flatmate-moderation](./flows/ops/flatmate-moderation.md)
- [ ] Support ticket raised, answered by ops, closed — [support-tickets](./flows/consumer/support-tickets.md)
- [ ] Report a listing; it reaches trust & safety — [trust-safety-reports](./flows/admin/trust-safety-reports.md)
- [ ] Referral link signs up a new user and credits the referrer — [plans-billing-refer](./flows/consumer/plans-billing-refer.md), [referrals-fraud](./flows/ops/referrals-fraud.md)
- [ ] Calculators and services hub — [services-calculators](./flows/consumer/services-calculators.md)
- [ ] Admin analytics, finance and enquiries reflect A–J — [analytics](./flows/admin/analytics.md), [finance](./flows/admin/finance.md), [enquiries-funnel](./flows/admin/enquiries-funnel.md)

## 3. Production — smoke

Short, mostly read-only, and restricted to test accounts. Respect the never-do list above.

- [ ] §1 wiring, against the production origin
- [ ] Consumer sign-in: OTP arrives on WhatsApp
- [ ] Staff sign-in at `/staff-login`: password, then an authenticator code (first time: scan the QR, save the recovery codes); the right console loads
- [ ] Browse without signing in: search with a filter, the map, one property page, one society page, `/plans`
- [ ] Test owner submits a listing with a photo → it reaches the verification queue → staff **rejects** it
- [ ] Test buyer opens a real listing and sees the contact gate — **stop there, do not unlock**
- [ ] Test buyer raises a support ticket; staff answers and closes it
- [ ] Payment — only when payment code changed since the last check; see §5

## 4. After every run — logs

- [ ] Cloud Logging: no new `ERROR` since the deploy started
- [ ] Cloud Logging: no `Refund or reconcile` line — it means money was taken and nothing was
      granted (subscription, service-request and amendment settlement each log it)
- [ ] Cashfree dashboard → webhooks: every delivery in the window answered 200
- [ ] WhatsApp Manager: OTP messages delivered, not failed on template or token

## 5. Production payments today

Plan purchases have **no refund path** in the platform: admin finance reports refunds as a literal
zero ([finance §5.11](./flows/admin/finance.md), D63). So a real purchase followed by a Cashfree-dashboard refund leaves the
subscription active and finance overstating revenue by that amount.

Until §6 lands: buy the cheapest real plan on the test owner once, when payment code first ships to
production and again whenever it changes, and **keep it** rather than refunding. That account then
doubles as the paid test owner. Record each purchase in the team finance sheet so it can be excluded
from reported revenue.

## 6. Not built yet

Each of these moves a production check from "avoid" to "safe to run every deploy":

- **Hidden internal plan** — unlimited contacts and listings, never listed on `/plans`, granted only
  by an admin with an audit row. Entitlements already derive from the subscribed plan
  (`EntitlementService`), so this needs no bypass flag.
- **Test-account marker** — listings, leads, payments and page views from marked accounts excluded
  from public search, sitemaps, alerts, analytics and finance. Unblocks approving a test listing and
  the full contact-gate journey in production.
- **₹1 internal price** — a server-side price override for marked accounts only, never taken from
  the client, so a live payment can be checked on every deploy.
- **Plan refunds (D63)** — so a test purchase can be returned without leaving the ledger wrong.
