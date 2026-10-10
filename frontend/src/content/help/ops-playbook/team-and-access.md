---
title: Team and access
slug: team-and-access
category: ops-playbook
audience: staff
access: staff
order: 24
updated: 2026-10-10
summary: How managers and admins add staff, give them desks, reset sign-in, and suspend accounts in Team & Access.
tags: [ops, internal, team, access, permissions, 2fa]
modules: [team]
---

> [!IMPORTANT]
> Internal runbook. Visible to Draazy staff only.

## Daily checklist

**Monitor**

- Staff who see **Dashboard only**. They have no function yet and cannot work.
- The **Suspended** tab. Check nobody who should be working is in it.
- Staff who tell you they cannot sign in, lost their phone, or are locked out.
- Access that no longer matches the job: a person who moved desks or left.
- Alerts to administrators. When a manager changes staff access, the admins are notified.

**Work on**

- New joiners: create the account, give the right functions, share the invite.
- Reset 2FA or reissue an invite when someone is stuck.
- Move desks: tick the new functions, untick the old ones.
- Suspend accounts of people who have left.
- Check each new account can sign in and reaches the right desks.

## Desk and access

- Route: `/admin/team`. Permission: `users:write`. Only **managers and admins** can open it. Ops staff cannot.
- An **admin** can manage everyone except other admins. A **manager** can manage **ops staff** only.
- You cannot change your own access, reset your own 2FA or reissue your own invite. Ask another administrator.
- Header: **Team & Access**. Button: **Add member**.
- There is one administrator per environment. You cannot create another.

## What is on the page

| Part | What it does |
|---|---|
| Tabs | **All members**, **Ops staff** (active staff), **Managers** (active non-staff, includes the admin), **Suspended** |
| Search | "Name, mobile or email" |
| Rows | Role, status, mobile, email and **Access**. 20 per page |

The Access column reads: the function chips for staff, **Dashboard only** when none, **All functions** for a manager, **Every function** for the admin.

Row actions (shown only for people you may manage):

| Action | Effect |
|---|---|
| **Edit** | Change name, email and functions. Role and mobile are locked. |
| Reset 2FA | Removes their authenticator. They are signed out everywhere and set it up again at next sign-in. |
| Reissue invite | New one-time invite link. They are signed out everywhere and cannot sign in until they use it. Their old password stops working. |
| Suspend / Reactivate | See below. |

Reset 2FA and Reissue invite are hidden for yourself and for suspended members. Both ask you to confirm.

## Desks (functions) and permissions

Staff get desks from **Back-office functions**, grouped under Verification, Listings, Service desks, Support, Trust & safety, Content and Insights. A function can open one or more modules.

- Ticking a function replaces the person's whole set when you save. Check the full list each time.
- Everyone who can sign in always gets the Dashboard.
- Managers get every function by default.
- A manager can only give functions the manager holds.
- Examples: **User lookup** gives read-only Users. **Enquiries** gives read-only Enquiries. **Content** gives read and write on Content. **Support** gives tickets and notes.
- Every change is recorded.

## Add a new staff member

1. Click **Add member**.
2. Fill **Full name**, **Mobile** (10 digits) and **Email**. All are required. The mobile cannot be changed later.
3. Role is **Ops staff**. Only the admin sees the Manager option.
4. Tick the functions the person needs. Nothing ticked means Dashboard only.
5. Click **Create member**. You see "Member created".
6. The **Invite link** box appears. Copy it and send it privately to that person. It also goes to their email. It works once and expires in 7 days.
7. They open the link, set a password of at least 12 characters, and finish sign-in.

A duplicate mobile or email is refused. The role cannot be changed later. To change a role, suspend the account and create a new one.

## How staff sign in

- They sign in with email and password, then a code from their authenticator app, or a one-time recovery code.
- The first sign-in sets up the authenticator and shows 10 recovery codes once. They must save them.
- After 5 wrong tries in a row the account locks for 15 minutes.
- Administrators can switch off staff sign-in for the platform. People then see "Staff sign-in is switched off at the moment. Ask an administrator to turn it back on."

## Fix a sign-in problem

1. Lost phone or app: click Reset 2FA. Tell them to sign in and set it up again.
2. Lost password or invite expired: click Reissue invite. Send the new link privately.
3. Locked out: wait 15 minutes, or use Reset 2FA (it also clears the lock).
4. A manager can reset only staff whose functions the manager holds in full. For a manager's own sign-in, ask the admin.

## Suspend someone who has left

1. Open the person's row. Click Suspend.
2. The account is suspended and cannot sign in. The last administrator cannot be suspended.
3. Suspend ends their signed-in sessions. A page already open can keep working until its short access token runs out (15 minutes by default).
4. Click Reactivate to let them sign in again. An account archived earlier is restored instead, which is refused if another live account already uses that email.
5. The page says there is no hard delete.

## Never do

- Never send an invite link in a group chat or leave it where others can see it.
- Never give functions "just in case". Give only what the job needs.
- Never share one account between two people.
- Never ask a staff member for their password or recovery codes.
- Never skip suspending a leaver.

## Related

- [Staff desks](/help/a/staff-desks)
- [Users desk](/help/a/users-desk)
