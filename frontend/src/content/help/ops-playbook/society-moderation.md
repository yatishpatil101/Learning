---
title: Society moderation
slug: society-moderation
category: ops-playbook
audience: staff
access: staff
order: 6
updated: 2026-10-04
summary: Internal procedure for society candidates, duplicate merges and directory edits.
tags: [ops, societies, moderation, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Use **Admin → Societies** (`/admin/societies`). It is an admin-portal desk: you need an `admin` account holding `societies:read`, and `societies:write` for merges and directory edits.

A society is identified by its Google Maps place. Owners and seekers can only pick a society from Google Maps suggestions, so every society row maps to one real place.

## Console tabs

| Tab | Use it for | Primary actions |
| --- | --- | --- |
| **Candidates** | Societies added from listings and demand, with duplicate hints | **Merge**, **Undo** |
| **Directory** | Search and edit canonical society profiles | Edit profile fields |

If a tab shows empty because loading failed, reload before deciding that the queue is clear.

## Merge decisions

Use **Merge** when a candidate duplicates an existing canonical society. The merge modal searches target societies and confirms with **Merge**.

Use **Undo** only when the merged-away society should exist again. Duplicate hints are advisory; if suggestions are checking, failed or absent, search manually before merging.

## Never do in society moderation

- Do not merge a candidate just because names are similar.
- Do not use Directory edits to hide a moderation problem.

## Related

- [Reports and takedowns](/help/a/reports-and-takedowns)
- [Ticket handling and escalation](/help/a/ticket-escalation)
