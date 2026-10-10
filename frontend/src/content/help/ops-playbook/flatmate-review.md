---
title: Flatmate review
slug: flatmate-review
category: ops-playbook
audience: staff
access: staff
order: 12
updated: 2026-10-10
summary: How staff publish, hide, badge, and re-check flatmate posts and group applications.
tags: [ops, flatmates, moderation, badges, internal]
modules: [flatmates]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Pending** tab count, oldest first by default.
- Card chips: **Awaiting publish**, **Edited since review**, **Live ? not yet reviewed**, **Badge claim**, **Owner consent missing**, **Contested address**.
- The "first 100 of each list" note ? decide some cards to see the rest.
- **Published** tab ? new group applications go live on submission.

**Work on**

- Clear **Pending** oldest first: **Publish**, **Hide for review** or **Remove**.
- Read the changed fields on **Edited since review** cards, then **Looks fine** or choose another decision.
- Decide badge claims: **Approve badge**, or **Reject badge** with a reason. Never approve a tenant badge without **Owner consent**.
- Scan new group applications under **Published**: **Clear** or **Remove**.

## Desk and access

Use **Flatmates** in the sidebar (page title **Flatmate Moderation**, `/admin/flatmates`; staff open it under `/staff/flatmates`). You need the **Flatmates** function (`flatmates:read` to view, `flatmates:write` to decide).

The desk is merged: publication moderation, badge verification, edit re-checks, and group-application moderation all land in one card list.

## Queue tabs and filters

| Tab | Sources |
| --- | --- |
| **Pending** | Pending publication rows, edit re-check rows, pending badge claims, and group applications held for review |
| **Published** | `approved` and legacy `live` moderation rows, plus live and cleared applications |
| **Hidden & removed** | `flagged`, `removed`, and `rejected` moderation rows |

Filter by **All / Room / Group / Seeker post**, search title, author, or locality, and sort oldest or newest. Pending defaults to oldest first. Each source is capped at 100 rows; when capped, decide visible rows to reveal more.

## Card signals

| Chip | Meaning |
| --- | --- |
| **Awaiting publish** | The post is not public yet |
| **Live · not yet reviewed** | A flatless post (seeker post, or a group still looking for a flat) self-published and still needs a scan |
| **Edited since review** | A public item changed after review |
| **Badge claim · tenant / owner / identity** | The host trust claim has a review row |
| **Owner consent missing** | Tenant-tier badge cannot be approved yet |
| **Contested address** | Address guardrails flagged the claim |
| **Group application** | This is application moderation, not owner acceptance |

The badge on `pending` renders as **Under Review**. Do not treat that as a rejection.

## Publication decisions

Open the card and use **Decision**:

| Button | Effect |
| --- | --- |
| **Publish** / **Clear** | Sets moderation public: `approved` |
| **Hide for review** | Sets `flagged`; hides the item from public feeds |
| **Remove** | Sets `removed`; notifies the author when it was public |
| **Looks fine** | Clears an edit re-check while keeping the current moderation state |

**Edit details** (top of the card) lets you correct the post's fields as a moderator before deciding.

Publication does not grant a trust badge. Use it only to decide whether the city can see the post.

## Badge decisions

Use **Badge verification** only for the host trust claim:

| Button | Effect |
| --- | --- |
| **Approve badge** | Sets the review `approved` and applies the host badge |
| **Reject badge** | Sets the review `rejected`; a reason is required and shown to the host |

For tenant-tier claims, approval is refused until owner consent is recorded. The row must show **Owner consent** before approval. Rejection withholds the badge only; it does not take the post down.

## Hold-for-review rule

Unflagged owner-tier posts and flatless posts (seeker posts, groups still looking for a flat) self-publish. A room with no photos, tenant-tier and identity-tier posts, and flagged posts are born `pending` until Ops uses **Publish**.

Legacy `live` means public. Moderator approval writes `approved`; both are public on the feed and in the **Published** tab.

## Edit re-moderation

Edits are classified by what changed:

| Edit type | Queue result |
| --- | --- |
| Foundation change on a room or housed group | Returns to `pending` |
| Public content change such as photos, title, note, rent, deposit, map pin, details, lifestyle, or group seats | Keeps current visibility but adds **Edited since review** |
| Seeker-post profile or preference change | Adds **Edited since review** |
| Silent fields | No queue item |

When a re-check is present, read the changed fields and use **Looks fine** only if the current public or hidden state is still correct. Choose another decision if the edit changes visibility.

## Group applications

Group applications are not pre-moderated: they go live on submission and show under **Published**. Moderate after the fact. The owner's `accepted` or `declined` status is not yours to change. This desk writes only `modStatus`:

| Action | What it changes |
| --- | --- |
| **Clear** | The application may stand |
| **Hide for review** | The application is hidden from the moderation view |
| **Remove** | The application is removed by ops |

Never describe a moderation removal as the owner declining the applicant.

## What never to do

- Never approve a tenant badge without owner consent
- Never use **Publish** as a badge approval
- Never use **Reject badge** to hide a public post
- Never decide an owner's group-application acceptance
- Never ignore an edit re-check on a live post
- Never treat `live` and `approved` as different public outcomes

## Related

- [Identity review](/help/a/identity-review)
- [Ownership and badges](/help/a/ownership-and-badges)
- [Reports and takedowns](/help/a/reports-and-takedowns)
