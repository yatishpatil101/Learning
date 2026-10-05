---
title: Society moderation
slug: society-moderation
category: ops-playbook
audience: staff
access: staff
order: 6
updated: 2026-10-04
summary: Internal procedure for society claims, resident verification, candidates, merges and society-content moderation.
tags: [ops, societies, moderation, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Admin → Societies** (`/admin/societies`). It is an admin-portal desk: you need an `admin` account holding `societies:read`, and `societies:write` for claims, residents, candidates, directory edits and moderation decisions.

## Console tabs

| Tab | Use it for | Primary actions |
| --- | --- | --- |
| **Claims** | Society ownership or committee claims | **Approve**, **Reject**, certificate evidence view |
| **Resident Verifications** | Residents proving they live in a society | **Verify**, **Reject** |
| **Candidates** | Auto-minted societies from listings and demand | **Verify**, **Merge**, **Undo** |
| **Directory** | Search and edit canonical society profiles | Edit profile fields |
| **Moderation** | Resident reports, WhatsApp links and location fixes | **Approve**, **Reject**, content removal decisions |

If a tab shows empty because loading failed, reload before deciding that the queue is clear.

## Claim decisions

Open certificate evidence when available. Use **Approve** only when the claimant and evidence match the society. Use **Reject** when the claim is unsupported, mismatched or unsafe.

Claim decisions are terminal. Do not reverse a claim by editing the row; escalate if a second decision is needed.

## Resident verification decisions

Use **Verify** when the resident evidence matches the society. Use **Reject** when it does not. A resident row can be decided again because flats change hands; use the opposite button when the resident status is wrong.

Resident verification grants society credibility on reviews and answers. Do not verify because the user is active in chat; rely on evidence.

## Candidate and merge decisions

Use **Verify** when a candidate is a real standalone society. Use **Merge** when it duplicates an existing canonical society. The merge modal searches target societies and confirms with **Merge**.

Use **Undo** only when the merged-away society should exist again. Duplicate hints are advisory; if suggestions are checking, failed or absent, search manually before merging.

## Moderation decisions

The **Moderation** tab has three work types:

| Work type | Action |
| --- | --- |
| Society content reports | Decide through the report action; upheld reports remove content from the hub |
| Pending WhatsApp links | **Approve** only a valid society group invite; **Reject** bad, spam or public links |
| Location fixes | **Approve** when the proposed pin matches the society; **Reject** suspicious or vague fixes |

WhatsApp invite links must be `https://chat.whatsapp.com/` links with a valid invite code. Approved links are visible to verified residents only, not to the public.

## Never do in society moderation

- Do not approve a society claim without evidence.
- Do not merge a candidate just because names are similar.
- Do not approve public or personal WhatsApp links.
- Do not accept a location correction that points away from the society.
- Do not use Directory edits to hide a moderation problem.

## Related

- [Reports and takedowns](/help/a/reports-and-takedowns)
- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Verification SLAs](/help/a/verification-sla)
