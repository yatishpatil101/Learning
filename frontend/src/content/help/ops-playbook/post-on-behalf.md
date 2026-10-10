---
title: Post on behalf
slug: post-on-behalf
category: ops-playbook
audience: staff
access: staff
order: 7
updated: 2026-10-10
summary: Internal procedure for creating an owner listing from a call or WhatsApp handoff.
tags: [ops, listings, post-on-behalf, internal]
modules: [postOnBehalf]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **You have an unsaved draft** banner ? **Resume** or **Discard** it before starting another.
- Properties ? **To verify** with the **Awaiting owner** chip ? staff-posted listings waiting on the owner.
- **Link opened** chip ? the owner opened the claim link but has not confirmed.
- **Reminded ?** count on a row ? how many nudges the owner has had.

**Work on**

- Enter each new call or WhatsApp handoff through **Details**, **Location**, **Pricing** and **Photos & Review**.
- Read the pending-listing warning before you submit, so you do not repeat a property.
- After **Send to Owner**, press **Send claim link on WhatsApp**, then **I've sent it**.
- Nudge owners who have not confirmed with the bell icon (**Remind the owner on WhatsApp**).

## Desk and access

Use **Admin → Post on Behalf** (`/admin/post-on-behalf`) to create a listing for an owner who shared details by call or WhatsApp. You need the **Post on behalf** function (`postOnBehalf:write`); staff open it under `/staff/post-on-behalf`.

The listing is created under the owner, not under staff. If the mobile does not belong to an existing user, the backend provisions an owner account and audits both the user provision and property creation.

## Wizard steps

| Step | Staff action |
| --- | --- |
| **Details** | Capture owner name, 10-digit mobile, property type and core property facts |
| **Location** | Pick the locality, search the society on Google Maps (a pick sets its pin and pincode) and add the full address |
| **Pricing** | Capture rent or sale price and deposit where applicable |
| **Photos & Review** | Add photo URLs if supplied, review, then submit |

Choose **For Rent** or **For Sale** before entering details. The choice controls deposit and possession fields.

## Validation rules

| Field | Rule |
| --- | --- |
| Owner mobile | Must be 10 digits starting with 6, 7, 8 or 9 |
| Owner name | Required |
| Locality | Required |
| Price | Required |
| Floor | Cannot be greater than total floors |
| Land listings | Require NA status and other rights; farmland sale also requires buyer eligibility |
| Photos | Optional URL entries; owner can add uploads after claiming |

The browser autosaves a draft under `dz_pob_draft_v2`. Use **Resume** to continue or **Discard** to clear it.

## Duplicate and plan warnings

The desk checks pending listings under the same mobile and shows an advisory warning. It also checks the owner's listing allowance. Staff-posted creation is exempt from the freemium ceiling, but overage is an owner-plan conversation before submission.

Do not ignore a pending-listing warning. Open **Admin → Properties** and confirm you are not recreating the same property.

## Submission and owner handoff

1. Review the generated listing title and all required fields.
2. Click **Send to Owner**.
3. On the success screen, click **Send claim link on WhatsApp**, press send in your WhatsApp, then click **I've sent it**. This is free: it goes from your own WhatsApp.
4. To resend later, open the listing's review, pick **Onboarding welcome** under WhatsApp templates, and use **Mark sent** in the Communication log.
5. Wait for owner confirmation before the listing goes live.

The owner confirmation endpoint records claim-link opened time and owner confirmation time. Publication is blocked while a staff-posted listing still waits for owner confirmation.

Use internal notes for call details that matter to reviewers. The listing creation route has no notes field, so the desk saves notes to the listing timeline after creation.

## Never do in post on behalf

- Do not use your own mobile as the owner mobile.
- Do not bypass owner confirmation for a staff-posted listing.
- Do not create a second pending listing when the same mobile already has the same property waiting.
- Do not promise the listing is live after **Send to Owner**; it still needs owner confirmation and review.
- Do not paste private call notes into public listing fields.

## Related

- [Verification SLAs](/help/a/verification-sla)
- [Ownership and badges](/help/a/ownership-and-badges)
- [Drafting desk and service queues](/help/a/drafting-desk)
