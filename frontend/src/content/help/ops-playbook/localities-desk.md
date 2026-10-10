---
title: Localities desk
slug: localities-desk
category: ops-playbook
audience: staff
access: staff
order: 23
updated: 2026-10-10
summary: How to read the Localities directory, retire or restore an area, and who to tell about duplicates or missing pins.
tags: [ops, internal, localities, directory]
modules: [localities]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- Two rows that look like the same area, with different spelling or slugs.
- A locality with a missing **Pin**. It shows a dash instead of coordinates.
- An **Active** locality with no **Live listings** that sellers keep choosing.
- A **Retired** locality that still has many live listings.
- New areas that appear after owners post. Check that the name looks right.

**Work on**

- Retire an area that should stop taking new listings, and restore one that was closed by mistake.
- Report duplicates, wrong names and missing pins to your manager or engineering, with the slug.
- Answer owner and support questions such as "why can I not find my area?".
- Check a locality's live listing count before telling a customer there is stock there.
- This desk has no Dashboard tile. Open it yourself.

## Desk and access

- Route: `/admin/localities`. Staff open `/staff/localities`.
- Permission: `localities:read` to see the page, `localities:write` to retire or restore (both are in the **Localities** function). Managers and admins can open it too. Without `localities:write` the page shows no action button.
- You can **retire** and **restore** an area. There is no add, rename or merge button.
- To rename or merge one, tell engineering. Give the name, the slug and what is wrong.

## What is on the page

Header: **Localities**, "Every area buyers can search, and how many live listings each has."

The note on the page says: areas appear when someone picks them from Google Maps suggestions. Retiring an area stops new listings there; its existing listings and page stay. Restore reopens it.

| Part | What it does |
|---|---|
| Search ("Locality or slug") | Finds part of a name or part of a slug. |
| Status chips | **All**, **Active**, **Retired**, each with a count. |
| **Clear filters** | Appears when a filter or search is set. |
| Rows | 20 per page. |

| Column | Meaning |
|---|---|
| Locality | The name, and its slug (the text in the web address) |
| Pin | Latitude and longitude to 4 decimals, or a dash if none |
| Live listings | Listings that are approved and not archived |
| Status | **Active** or **Retired** |
| Action | **Retire** on an active area, **Restore** on a retired one. Hidden without `localities:write`. |

The directory lists every area that is not retired. It also lists retired areas that still have live listings.

## How an area gets created

Nobody types a locality in. It is created when an owner or a customer picks a place from the Google Maps suggestions. The system accepts it only if:

- Google calls it a locality, neighbourhood or sub-locality. "Pune" on its own is refused.
- It is inside Pune. Otherwise the person sees "Pick a locality in Pune."
- It is not already there. A place with the same name within about 2.5 km is reused instead of making a new row.

A retired area cannot be picked again. Anyone who picks it, by suggestion or by name, sees "That area isn't open for new listings." Only **Restore** reopens it.

If two areas get the same name, the second slug gets a number, like `kothrud-2`. A place that was refused is remembered for about a day, so it will not be accepted again straight away.

## Check an area

1. Open Localities and search for the name or slug.
2. Look for the same area under other spellings.
3. Check **Live listings**. Zero means nothing is live there now.
4. Check **Pin**. A dash means the map cannot place the area properly.
5. If something is wrong, write down the name, the slug and the problem, and report it.

## Retire or restore an area

1. Search for the area and find its row.
2. Press **Retire** (or **Restore**). A confirmation says what will happen. Read it, then confirm.
3. Retiring does not take anything down. **Live listings** stay online and the area page keeps working. Only new listings in that area are blocked.
4. Restore opens the area for new listings again.
5. Every retire and restore is written to the audit log with your name and the live count.

Retire only when the area is wrong, for example after someone picked the wrong place. Do not retire an area just because it has no listings. Retiring does not move listings, so a duplicate still needs engineering.

## Answer "my area is missing"

1. Search the directory, including **Retired**.
2. If it is not there, ask the person to pick the area from the suggestions list when posting. The area is created then.
3. If it is there as **Retired**, find out why. Restore it only if that was a mistake. Otherwise tell the person the area is closed.
4. If the suggestions never show it, the place is probably outside Pune or not a locality in Google Maps. Report it with the exact name.
5. Do not promise the area will be added.

## Never do

- Never tell an owner you have added, renamed or merged an area. You cannot.
- Never ask a customer to type a different area name to force a match. It makes duplicates.
- Never delete or edit listings to "fix" a locality. Report it instead.
- Never treat an empty or failed list as "no localities". It is unknown.

## Related

- [Society moderation](/help/a/society-moderation)
- [Verification and SLA](/help/a/verification-sla)
- [Staff desks](/help/a/staff-desks)
