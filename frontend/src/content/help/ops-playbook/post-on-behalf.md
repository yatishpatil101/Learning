---
title: Post on behalf
slug: post-on-behalf
category: ops-playbook
audience: staff
access: staff
order: 7
updated: 2026-10-04
summary: Internal procedure for creating an owner listing from a call or WhatsApp handoff.
tags: [ops, listings, post-on-behalf, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Admin → Post on Behalf** (`/admin/post-on-behalf`) to create a listing for an owner who shared details by call or WhatsApp. It is an admin-portal desk: you need an `admin` account holding `postOnBehalf:write`.

The listing is created under the owner, not under staff. If the mobile does not belong to an existing user, the backend provisions an owner account and audits both the user provision and property creation.

## Wizard steps

| Step | Staff action |
| --- | --- |
| **Details** | Capture owner name, 10-digit mobile, property type and core property facts |
| **Location** | Capture locality, address and society or pin details when relevant |
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
3. On success, use **View All Properties** to open Properties.
4. Send the owner the claim link from **Properties → Staff Posted**.
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
