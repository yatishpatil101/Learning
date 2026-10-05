---
title: Service queues
slug: service-queues
category: ops-playbook
audience: staff
access: staff
order: 11
updated: 2026-10-04
summary: How staff work non-rent-agreement service requests on their service desk pages.
tags: [ops, services, queues, internal]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Desk and access

Open your service from the sidebar: **Property & Legal** (`/admin/legal`), **Interior & Renovation** (`/admin/interior`), **Packers & Movers** (`/admin/packers`) or **Property Valuation** (`/admin/valuation`). You see only the desks you were granted.

The route is for `staff` and `admin`. Legacy `/ops/legal`, `/ops/interior`, `/ops/packers`, and `/ops/valuation` bookmarks redirect here with the matching desk filter.

## Current desk types

| Filter | Current label |
| --- | --- |
| `legal` | Property & Legal |
| `interior` | Interior & Renovation |
| `packers` | Packers & Movers |
| `valuation` | Property Valuation |

**Home Loans** (`/admin/home-loans`) has no service requests: it is the loans ticket board, worked like any other ticket.

## Queue controls

| Control | Use it for |
| --- | --- |
| **All statuses** | Filter by server status |
| **Name, mobile or request id** | Search requester or request |
| **Unassigned only** | Find work with no holder |
| **Refresh** | Re-read the current page |

The **Overdue only** checkbox is tied to rent-agreement SLA data. Non-rental rows use age colouring only: amber after 24 hours and rose after 72 hours while still open.

## Status states

| Status | What it means |
| --- | --- |
| `new` | Request is ready for ops |
| `assigned` | A staff member owns it |
| `in-progress` | Work is underway |
| `draft-shared` | A deliverable was shared with the customer |
| `changes-requested` | Customer asked for changes |
| `approved` | Customer approved the draft |
| `completed` | Final document uploaded |
| `cancelled` | Terminal cancellation |

Staff may set only `assigned`, `in-progress`, and `cancelled`. Use **Share draft** to reach `draft-shared`; customer approval reaches `approved`; **Upload registered copy** completes the request even when the uploaded file is a final service document rather than a legal registration.

## Working procedure

1. Open the row and read the summary fields.
2. Use **Take this request** before handling identity numbers or uploading files.
3. Read **Documents**. If the checklist fails, retry before asking the customer for anything.
4. Use **Files on this request** to open customer uploads and previously shared deliverables.
5. Use **Drafting workflow → Share draft** when the customer needs to review a deliverable.
6. Use **Message thread** for customer-visible updates.
7. Use **Internal notes** for staff-only context.
8. Use **Cancel request** only with a clear reason; the customer is notified.

## Documents and files

The checklist is folded from service metadata and request documents. It is read-only except where the rent-agreement workflow adds verification buttons. For non-rental desks, treat it as the list of what exists and what is missing.

Do not call a failed checklist an empty checklist. The screen’s failure text is deliberate: a failed read means the system does not know what was filed.

## Identity numbers

The **Parties' identity numbers** panel can appear on any service request, but it is only useful when numbers were recorded. Reveal only after taking the request. Closing the modal or opening another matter clears the numbers from component state, and the server audits allowed and refused reads.

## Cancellation

`completed` and `cancelled` are terminal. For every other status, cancellation requires a reason. The reason is sent as a customer-visible message and a cancellation notification.

## What never to do

- Never work a matter under another holder’s name
- Never treat a load failure as no documents filed
- Never reveal identity numbers before taking the request
- Never invent a loans queue from this screen
- Never use rent-agreement-only actions such as overlap, refunds, registration check, or police intimation on these desks

## Related

- [Drafting desk and service queues](/help/a/drafting-desk)
- [Ticket handling and escalation](/help/a/ticket-escalation)
