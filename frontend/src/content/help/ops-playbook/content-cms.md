---
title: Content (FAQs)
slug: content-cms
category: ops-playbook
audience: staff
access: staff
order: 22
updated: 2026-10-10
summary: How to add, edit, archive and restore the public FAQs in the Content module, and where they show on the site.
tags: [ops, internal, content, faq, cms]
modules: [content]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- Questions customers keep asking support. Each repeat is a missing or unclear FAQ.
- Answers that are out of date: fees, steps, contact details, policy changes.
- The counts under the heading: "N active, N archived". A sudden drop means someone archived FAQs.
- A page that says **Content module is disabled.** The feature is switched off in Settings.
- The Help centre FAQ page, once in a while, to check the order and wording look right.

**Work on**

- Add an FAQ when the same question reaches support more than once.
- Fix wrong or old answers. Edit instead of adding a second version.
- Archive FAQs that no longer apply.
- Restore an archived FAQ when it becomes true again.
- This desk has no Dashboard tile. Open it yourself.

## Desk and access

- Route: `/admin/content`. Staff open `/staff/content`. Page title: **Content**.
- Permissions: `content:read` and `content:write`. The **Content** function gives both together.
- The module today manages **FAQs only**. There is no blog, banner or page editor here.
- If the module is off you see **Content module is disabled.** with an **Enable in Settings** link. Ask an administrator to switch it on.
- The page shows Add, Edit and Archive to everyone who can open it. The server still checks your write permission and refuses if you do not have it.

## What is on the page

| Part | What it does |
|---|---|
| Heading line | "Frequently asked questions" with the count of active and archived FAQs. |
| **Add FAQ** | Opens a form with **Question**, **Answer** and **Category**. Click **Save**. You see "Saved". |
| Pencil (Edit) | Opens the same form for that FAQ. |
| Archive | Asks "Archive this FAQ? It will be hidden but preserved." Toast: "Archived". |
| **Show archived** | Loads archived FAQs. They appear dimmed under **Archived**, question only. |
| Restore | Asks "Restore this FAQ?" and brings it back. |

- **Category** is free text. The default is `general`. Use the same spelling every time, because the Help centre groups FAQs by category.
- The question is required.
- There is a limit of 500 FAQs.
- Every add, edit, archive and restore is recorded with your name.

## Where the FAQs show

Public FAQs come from this CMS. They are read from the server and shown in:

- The Help centre FAQ page (`/help/faq`), grouped by category, with search.
- The FAQ section on the Support page.
- The FAQ block on the Home page. It shows the first 6 in the list order below.
- The assistant chat widget.

Archived FAQs do not show. The list is ordered by category, then by when each FAQ was created.

- The public site keeps a short-lived copy. An edit can take about half a minute to appear. Refresh before you decide it did not work.
- The Home page shows only the first 6, so the order (category, then creation date) decides which ones. If the FAQs cannot load, Home shows a built-in set of five instead.
- Translations exist in the server, but this page has no way to edit them.

## Add or fix an FAQ

1. Open Content. Check the question is not already listed. Use **Show archived** too.
2. For a fix, click the pencil on the FAQ. For a new one, click **Add FAQ**.
3. Write the question the way a customer would ask it.
4. Write the answer in short plain sentences. Say what to do first.
5. Pick the category. Copy the spelling from the existing ones.
6. Click **Save** and wait for "Saved".
7. Open `/help/faq` and check it. Wait a moment and refresh if it has not changed.

## Retire an FAQ

1. Click Archive on the FAQ. Confirm.
2. It disappears from the public site but is kept. Use **Show archived**, then Restore, to bring it back.
3. Archive rather than delete. There is no delete.

## Never do

- Never put phone numbers, emails or names of customers or staff in an FAQ.
- Never promise a fee, discount or timeline that is not already policy.
- Never archive a whole category without checking with your manager.
- Never copy text from other websites.

## Related

- [Staff desks](/help/a/staff-desks)
- [Team and access](/help/a/team-and-access)
