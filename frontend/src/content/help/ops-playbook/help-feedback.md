---
title: Help feedback
slug: help-feedback
category: ops-playbook
audience: staff
access: staff
order: 31
updated: 2026-10-10
summary: How to read reader ratings and comments on help articles and turn them into content fixes.
tags: [ops, internal, help, feedback, content]
modules: [helpFeedback]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- **Articles** tab: the articles at the top. Articles with 5 or more votes come first, sorted by the share of **not helpful** votes, highest first. Articles with fewer votes follow.
- A new article or a changed article that appears near the top soon after release.
- New comments on the **Comments** tab, newest first.
- A comment that mentions a wrong price, rule, link or step. That is a factual error and comes first.
- Comments that include personal details, such as a phone number. Do not copy them anywhere.

**Work on**

- Open each top article as a reader would and look for what is missing or unclear.
- Turn each clear comment into a specific fix: a missing step, a wrong figure, a confusing word, a dead link.
- Pass the fixes on to whoever maintains the help content, with the article name and the exact change.
- If a comment shows a customer who needs help now, ask Support to follow up (see "Steps: read and act").
- Weekly: check that last week's fixes are live, and watch whether those articles drop down the list.

## Desk and access

Use **Help feedback** at `/admin/help-feedback`. It is admin only and not available under `/staff`. It needs `settings:read`. The page is read-only. You cannot reply to a reader or delete a comment from it.

The subtitle reads "How readers rate each help article, and what they wrote. Articles with 5 or more votes come first, by share not helpful."

## How readers give feedback

At the bottom of every help article the reader sees "Was ... helpful?" with **Yes** and **No**.

- After **No**, a box asks "What was missing?". It takes up to 500 characters. The note under it says the text goes to the team that maintains the help and is never shown to others. It tells readers not to include a phone number and offers a link to raise a ticket.
- Comments are anonymous. You cannot see who wrote one.
- Each reader counts once per article. Voting again replaces their earlier vote and comment. A reader is the account when signed in, otherwise the browser, so clearing browser data lets them vote again.
- The same network address can leave up to 20 votes per article per day. Any extra are dropped with no message.

## What is on the page

| Tab | What each row shows | Action |
| --- | --- | --- |
| **Articles** | The article slug and a language chip, then "N helpful · N not helpful · N% not helpful · N comments · last ..." | **Read comments**, only if the article has comments |
| **Comments** | The article slug, language, a **Helpful** or **Not helpful** chip, the comment and the time | None |

**Read comments** opens the **Comments** tab for that one article. A note "Comments on" and the slug shows, with **Clear filters** to go back to all comments. Each tab has 20 rows per page.

Things to know when you read the numbers:

- The row shows the article's slug, not its title. The slug is the end of the address: `/help/a/<slug>` for the help centre.
- Each row shows the counts and the share that were **not helpful**. A new article with one or two votes can show 100%, which is why it sits below articles with 5 or more votes.
- The language chip says English for now. Articles are English only.
- "No feedback yet." and "No comments yet." are real empty states. A red message at the top means the load failed.

## Steps: read and act

1. Open **Articles** and pick the top article. Note its **not helpful** and comment counts.
2. Select **Read comments** and read every comment from the last few weeks.
3. Open the article in the help centre and compare. Look for the missing step, wrong number or unclear wording.
4. Decide what kind of fix it is:
   - Wrong fact, price, rule or link: fix first.
   - Missing step or answer: add it.
   - Hard to follow: shorten or reorder it.
   - Not an article problem, for example "app is slow": send it to Support or an admin.
5. Send the fix to whoever maintains the help content. Name the article and give the exact words to change.
6. After the fix is live, note the date and check again in a week.

Articles are plain text files in the product's help content folders, in English. Staff runbooks live in the same system, so a fix here follows the same path as a runbook fix.

## Never do

- Do not copy phone numbers, emails or names from comments into chats or tickets.
- Do not try to find out who wrote a comment.
- Do not delete or rewrite an article from one comment. Look for the same point in several.
- Do not treat the vote counts as customer satisfaction scores. They are only for readers who clicked.
- Do not promise a reader that an article will change.

## Related

- [Staff desks](/help/a/staff-desks)
- [Ticket handling and escalation](/help/a/ticket-escalation)
- [Erasure requests](/help/a/erasure-requests)
- [Analytics review](/help/a/analytics-review)
