---
title: Erasure requests
slug: erasure-requests
category: ops-playbook
audience: staff
access: staff
order: 30
updated: 2026-10-10
summary: How admins review right-to-erasure requests, when to refuse, and what is deleted or kept.
tags: [ops, internal, erasure, privacy, dpdp]
modules: [erasure]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Erasure requests** with the **Pending** chip (the default view). Any row there is waiting for a decision.
- The "Filed ... ago" time on each pending row. The page shows no deadline, so you track age yourself.
- The **Reason** the person gave, if they gave one.
- Anything the person said that points to a live obligation: a rent agreement, an unsettled payment, an open deal or a report about them.

**Work on**

- Decide each pending request. Do not leave one without a decision.
- Before you erase, check for live obligations (see "Steps: decide a request").
- For a refusal, write a clear plain reason for the person.
- Weekly: open **Erased** and **Rejected** and check that each decision has a sensible **Note**.

## Desk and access

Use **Erasure requests** at `/admin/erasure-requests`. It is admin only and does not exist under `/staff`. It needs `settings:read` and an admin role. There is no extra capability or second-admin step, so one admin can decide a request. Take care.

People file a request themselves from their own account. A reason is optional. A person with a pending request cannot file another one.

## What is on the page

The subtitle reads: "Right-to-erasure requests. Erasing is permanent."

| Item | What it shows |
| --- | --- |
| Chips **Pending**, **Erased**, **Rejected**, **All** | Filter by decision. **Pending** shows first |
| Row title "Request" and a short id | The first 8 characters of the request id. The row does not show the person's name |
| **Filed** / **Decided** | How long ago |
| **Reason** | What the person wrote |
| **Note** | What the deciding admin wrote |
| **Erase data** (red) and **Reject** | Only on pending rows |

**Erase data** opens "Erase this person's data". It says "This archives the account and clears its name, phone number, email and documents. Records we must keep (payments, rent agreements, deals) stay. It cannot be undone." There is an optional **Note** (up to 2000 characters) and the button **Erase permanently**. A toast says "Data erased".

**Reject** opens "Reject erasure request". **Reason for the person** is required. The button is **Reject**. A toast says "Erasure request rejected".

A decided request is final. If you try to decide it again the server refuses. A new ask from the person is a new request.

## What gets deleted

When you choose **Erase permanently**, the system:

- Deletes the person's sign-in codes, login sessions, push subscriptions, queued messages, notifications and identity check records.
- Deletes their rental records, help article feedback, uploaded KYC documents (the files too, unless the same file was filed on a property or service request) and draft approvals for services. Unclaimed service-request parties are removed.
- Blanks stored tax and ID numbers and personal fields on the identity, tenant and service profiles.
- Removes the person from page view records.
- Replaces the account: the phone number becomes a made-up value, and the name, email, avatar, city and password are cleared. The account is archived and says "Erased on the account holder's request".

## What is kept, and why

These are recorded on the request as the reason for keeping them:

| Kept | Why |
| --- | --- |
| Payments and invoices | Records the business must hold |
| Rent agreements and rent receipts | Records tied to a signed agreement |
| Closed deals and offers | Records involving the other party |
| Audit log | Proof of who did what in the panel |
| Abuse reports | Protects other users |
| Reviews and ratings | Content others rely on |
| Listings and property records | Property data, not only the person |

Some other personal data is not yet removed by the erasure: referral phone numbers and codes, flatmate group member names, contact names and phone numbers on tickets and service requests, deals, saved searches, city waitlist entries, managed property tenant names, and flatmate posts and consent records. Make sure your lead knows these gaps exist. Do not tell the person that everything was erased.

## Steps: decide a request

1. Open **Erasure requests**. Read the **Reason**.
2. The page does not show who filed it and does not check obligations for you. Find out from the person's account, or from a colleague who can see it, whether they have a live rent agreement, an unsettled payment, an open deal or a report against them.
3. If they have none, choose **Erase data**, add a **Note** saying what you checked, then **Erase permanently**.
4. If they do, choose **Reject** and write the reason in plain words, for example: "You have an active registered rent agreement, so we must keep it."
5. If you cannot tell, leave it **Pending** and ask your lead. Do not guess.

No deadline is enforced or shown on this page. Ask your lead for the legal time limit and treat it as the target.

## Never do

- Do not erase without checking for live obligations. It cannot be undone.
- Do not reject without a reason the person can understand.
- Do not paste the person's phone number, email or documents into the **Note**.
- Do not tell the person that their payment and rent records were erased. They are kept.
- Do not decide a request about yourself or someone you know. Pass it to another admin.

## Related

- [Reports and takedowns](/help/a/reports-and-takedowns)
- [Identity review](/help/a/identity-review)
- [Settings and integrations](/help/a/settings-and-integrations)
- [Help feedback](/help/a/help-feedback)
