---
title: Users desk
slug: users-desk
category: ops-playbook
audience: staff
access: staff
order: 20
updated: 2026-10-10
summary: How to look up owner and buyer accounts, read their activity, and what only an administrator can change.
tags: [ops, internal, users, lookup, badges]
modules: [users]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Badge pending** chips on rows. A hand-granted badge is waiting for a second admin.
- **Flagged** chips and their reason. These are accounts someone raised for review.
- The **Suspended** tab count when a customer says they cannot sign in.
- Odd patterns in a lookup: many listings on a brand new account, or the same person under two numbers.
- This desk has no Dashboard tile. Open it yourself.

**Work on**

- Customer questions: find the account and read its status, flags and listing count.
- Support or verification cases that need to know who an account is and what it did.
- Flags and suspensions you need to ask an admin to action, with a clear reason.
- Anything an administrator must act on: pass it on with the account name and a clear reason.

## Desk and access

- Route: `/admin/users`. Staff open `/staff/users`.
- Permission: `users:read` (the **User lookup** function). The Identity checks function also gives you this.
- Staff and managers get a read-only list. **View activity**, staff notes and every change are **administrator only** (`users:write`).
- The page lists owners and buyers only. Staff accounts live in Team & Access.
- Header: **Users**, with the account count.

## What is on the page

| Part | What it does |
|---|---|
| Tabs | **All users**, **Active**, **Suspended**, **Archived**. Counts come from the server. **All users** does not include archived accounts. |
| **Badge approvals** tab | Administrators only. Hand-granted Verified badges waiting for approval. |
| Search | Type the start of a name, or a full 10-digit mobile. Email and part of a number are not searched. |
| Role chips | **All**, **Owners**, **Buyers**. |
| **Export CSV** | Shown only when that feature is switched on. Exports the first 100 matching rows. Mobile numbers are masked. |
| Rows | Name, status, **Verified**, **Flagged** (with reason), **Badge pending**, masked mobile, role, city, listings count, joined date. |

The page shows 20 rows at a time.

## Look up a customer

1. Open Users. Search by the start of the name, or the full mobile number.
2. Check the status chips. Does the row say Suspended, Flagged or Badge pending? Read the flag reason.
3. Check role, city and listings count against what the customer told you.
4. If you need the full history, ask an administrator. Only administrators see **View activity**: staff notes plus a timeline of the last 50 events (Joined Draazy, Sent an enquiry, Booked a visit, Requested a service, Listed a property, Moderation action).
5. If the account needs a change, pass it to an administrator with the account name and the reason.
## What an administrator can do

| Action | Rule |
|---|---|
| Grant or remove the Verified badge | A reason is required (10 to 300 characters). A hand-granted badge must be approved by a **different** admin, not the requester and not the user. Reject needs a 10 to 300 character reason. |
| Suspend / Reactivate | Suspend ends every signed-in session and refuses sign-in. Reason is optional but write one. |
| Archive / Restore | Archive removes the account from the directory, ends every signed-in session and refuses sign-in. Restore brings it back. Restore is refused if another live account has the same email. |
| Flag for review / Remove flag | A reason is required for a flag. |

- You cannot suspend or archive your own account.
- An archived account cannot be reactivated until it is restored first.
- With only one administrator, a hand-granted badge stays pending. Use identity review instead.
- A badge earned through identity review cannot be withdrawn here. Revoke it in identity review.
- A verified profile cannot have its name changed from the admin edit.
- Every change is audited.

## Never do

- Never share a customer's full mobile number or details outside the panel.
- Never export to CSV unless the job needs it. Delete the file when done.
- Never ask a customer for an OTP or password.
- Never suspend or archive to "see what happens". Both are visible to the customer.
- Never grant a badge to speed up a case. Use the identity review.

## Related

- [Ownership and badges](/help/a/ownership-and-badges)
- [Identity review](/help/a/identity-review)
- [Team and access](/help/a/team-and-access)
- [Staff desks](/help/a/staff-desks)
