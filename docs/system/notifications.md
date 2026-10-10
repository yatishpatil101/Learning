# Notifications

Every message Draazy sends, by channel and audience, with the exact copy. The source of truth is the code; when
copy changes there, update the row here in the same commit.

`{curly}` marks a runtime value. Links are app routes.

## Channels at a glance

| Channel | Status | Cost to Draazy | Sender | Used for |
|---|---|---|---|---|
| In-app (bell) | Live | Free | `Notifier` → `NotificationPublisher` | Almost everything: consumer events, staff hand-offs |
| Web push | Live when `PUSH_VAPID_PRIVATE_KEY` is set; otherwise logs only | Free | `PushSender` (`WebPushSender`, fallback `LoggingPushSender`) | New chat messages only |
| WhatsApp — Meta Cloud API | Live when `WHATSAPP_ENABLED=true` | ~₹0.115 + 18% GST per message | `WhatsAppOtpSender`, `WhatsAppDecisionMessenger` | One-time codes, identity rejected / revoked, the daily waiting-on-you digest |
| WhatsApp — click-to-chat (`wa.me`) | Live | Free (sent from a person's own WhatsApp) | `ClickToChatSender` (staff), plain links (consumers) | Staff → owner outreach; consumer → consumer handoffs |
| Email — ZeptoMail | Live when `ZEPTOMAIL_ENABLED=true` | Per-email credit | `EmailSender` (`ZeptoMailEmailSender`) | Staff invite and password reset only |
| SMS | Not built | — | — | — |

Configuration for the paid channels is in [DEPLOY.md](../DEPLOY.md) (WhatsApp identity template, ZeptoMail).

## Delivery rules

- **One writer.** Every in-app row goes through `Notifier.notify(userId, type, title, body, link)`, implemented by
  `NotificationPublisher` (`@Transactional(MANDATORY)` — it joins the caller's transaction, so a rolled-back action
  leaves no row).
- **Quiet hours.** When the user has quiet hours on (default off, 22:00–07:00), a row written inside the window gets
  `deliverAfter` and stays hidden until the window closes. Turning quiet hours off releases held rows.
- **Match-alert switch.** `matchAlerts=false` drops only the `match.*` and `price.*` families (`NotificationTypes`).
- **Retention.** Rows older than 90 days are swept daily (`NotificationRetention`).
- **Channel toggles.** The `whatsapp` toggle (`Notifier.allowsWhatsapp`) gates the paid identity and digest sends;
  codes are never gated. The `email` and `sms` toggles are stored but read by nothing.
- **Chat bursts.** `message.received` writes one bell row per unread run (only when the recipient's unread count in
  that conversation is 1); push is scheduled for every message.
- **Paid sends happen after commit** and are best-effort: a failed identity-decision WhatsApp is logged and the
  in-app row still stands. An OTP delivery failure is surfaced to the caller.
- **Privacy.** No notification body carries another user's mobile number. Contact details are revealed only on the
  surfaces behind the contact gate.
- **Frontend.** `frontend/src/services/providers/http/notificationMapper.js` maps a type to a UI chip by its prefix
  (`contact`, `visit`, `offer`, `document`, `photo`, `listing`, `identity`, `flatmate`, `service`, `match`,
  `message`, …). A new type with an existing prefix needs no frontend change.
- **Badge.** The consumer bell shows a count only while `GET /notifications/unread-count` is above zero. That
  count uses the same rules as the list: unread and not held by quiet hours.
- **Money.** Rupee amounts in copy go through `Notifier.rupees()` and use Indian grouping (`₹40,00,000`).

## In-app — consumer

### Leads and contact

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `contact.received` | Buyer asks for the owner's contact | Owner | New contact request | `{buyer name} wants to contact you about {listing}. Approve or decline it.` | `/dashboard#leads` |
| `contact.approved` | Owner approves | Buyer | Your contact request was approved | You can now message the owner and see their number unless they keep it hidden — open the listing. | `/property/{id}` |
| `photo.requested` | Buyer asks for more photos (first ask per listing) | Owner | Someone wants more photos | `A buyer asked for more photos of {listing}.` | `/dashboard#leads` |
| `photo.added` | Owner adds photos | Each requester | More photos added | `The owner added more photos of {listing} — take a look.` | Listing |
| `photo.declined` | Owner says no more photos | Each requester | No more photos available | `The owner has shared everything they have of {listing}.` | Listing |
| `document.requested` | Buyer asks to see property documents | Owner | New document request | `{buyer name} asked to see documents for {listing}.` | `/dashboard#leads` |
| `document.granted` | Owner approves | Buyer | Property documents unlocked | `The owner approved your request — open your documents to view them. Access expires in {n} days.` | `/view-documents/{id}` |
| `message.received` | 1:1 chat message (first of an unread run) | Recipient | `{sender} sent you a message` | Message preview | `/messages?c={id}` |
| `message.received` | Flatmate group message (first of an unread run) | Each other member | `{sender} in {group}` | Message preview | `/messages?c={id}` |

### Visits

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `visit.requested` | Visitor books a visit | Owner | New visit request | `{visitor} wants to visit {listing}. Confirm it or suggest another time.` | `/dashboard#visits` |
| `visit.confirmed` | Owner confirms | Visitor | Your visit is confirmed | `The owner confirmed your visit to {listing}. Open your visits to see the slot.` | `/dashboard#visits` |
| `visit.rescheduled` | Either side moves the slot | The other side | A visit was moved to a new time | `{mover} proposed a new slot for {listing}. It is back to scheduled until you confirm it.` | `/dashboard#visits` |
| `visit.cancelled` | Either side cancels | The other side | A visit was cancelled | `The owner/The visitor cancelled the visit to {listing}.` | `/dashboard#visits` |

### Offers

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `offer.received` | Buyer submits an offer | Owner | `New offer on {listing}` | `{buyer} offered ₹{amount}. Open the listing to respond.` | `/property/{id}` |
| `offer.countered` | Either side counters | The other side | `New counter-offer on {listing}` | `The owner/The buyer countered at ₹{amount}. Open the listing to respond.` | `/property/{id}` |
| `offer.accepted` | Owner accepts | Buyer | Your offer was accepted | `The owner accepted ₹{amount} for {listing}.` | `/property/{id}` |
| `offer.declined` | Owner declines | Buyer | Your offer was declined | `The owner declined your offer on {listing}.` | `/property/{id}` |

### Listings (owner)

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `listing.approved` | Moderator / verification desk / override approves | Owner | Your listing is approved | It is now live and visible to buyers. | `/property/{id}` |
| `listing.rejected` | Moderator or reviewer rejects | Owner | Your listing was not approved | `A moderator could not approve it: {reason}` (or `A reviewer …`) | `/dashboard` |
| `listing.needs_info` | Reviewer asks for clarification | Owner | Your listing needs info | Reason-code message for the owner, plus the reviewer's note | `/dashboard?review={id}` |
| `listing.needs_info_reminder` | No reply (first reminder) | Owner | Your listing still needs info | Please reply or edit your listing so Draazy can finish the review. Listings with no update are archived after 14 days. | `/dashboard` |
| `listing.needs_info_reminder` | No reply, day 7 | Owner | Your listing still needs info | Please reply or edit your listing in the next 7 days, or we'll archive it for now. | `/dashboard` |
| `listing.needs_info_timeout` | No reply in 14 days | Owner | Your listing was archived | We archived it because we did not receive the requested info within 14 days. You can restore and resubmit when ready. | `/dashboard` |
| `listing.badge_declined` | Ownership badge declined | Owner | Verified badge not granted yet | Reviewer's reason | `/dashboard?tab=documents&prop={id}` |

### Identity verification

Only a reviewer's reject, the pending-expiry reject and a revoke also go out as a paid WhatsApp (see
[WhatsApp — paid](#whatsapp--paid-meta-cloud-api)); approvals and the automatic check's rejects are in-app only.

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `identity.approved` | KYC reviewer approves | User | You're verified | `Your identity has been confirmed. Your profile name now matches your ID: {legal name}` | `/dashboard` |
| `identity.rejected` | Reviewer rejects, or the pending-expiry sweep rejects | User | Verification needs another try | We couldn't verify your ID this time. Open the verification page to see why and retake. | `/verify-identity` |
| `identity.rejected` | Automatic check rejects | User | Verification needs another try | The automatic check's reason | `/verify-identity` |
| `identity.revoked` | Reviewer withdraws the badge | User | Verified badge withdrawn | Reviewer's reason | `/verify-identity` |

### Alerts

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `match.saved-search` | Saved-search sweep finds new matches (instant / daily / weekly) | Searcher | `{n} new home(s) match {search name}` (flatmates: `match(es)`) | Tap to see what came up since you last looked. | `/dashboard#alerts` |
| `match.society-listing` | New listing in a followed society | Follower | `New listing in {society}` | Listing title | `/property/{id}` |

Both are governed by the `matchAlerts` switch.

### Flatmates

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `flatmate.interest` | Someone shows interest in a seeker post | Post owner | `{name} is interested in teaming up` | Open your request inbox to review their interest. | Post |
| `flatmate.interest.sent` | Same action | Requester | `Your message is with {name}` | If they accept, we will share your mobile number with them so they can reply. Nobody else on the board can see it. | Post |
| `flatmate.{kind}.interest` | Interest in a room/group listing | Host | `{name} is interested in {target}` | Open your request inbox to review their interest. | Target |
| `flatmate.request.accepted` / `.declined` | Host decides | Requester | Your flatmate request was accepted / declined | Good news — the host accepted your request. They have your number. / The host has declined this one. Plenty of other people are looking. | Target |
| `flatmate.groupApplication.received` | A group applies to a flat | Flat owner | A group applied to your flat | `{group} would like to rent {listing}.` | `/dashboard` |
| `flatmate.groupApplication.accepted` / `.declined` | Owner decides | Applicant | Your group's application was accepted / declined | `The owner of {listing} accepted your group. They will be in touch to arrange the paperwork.` / `The owner of {listing} declined your group.` | Group |
| `flatmate.group.left` | Member leaves | Host | `{name} left {group}` | A seat is open again. | Group |
| `flatmate.group.removed` | Host removes a member | Removed member | `You're no longer in {group}` | The host removed you from this group. | Group |
| `flatmate.{post\|group}.expiring` | Expiry sweep, a few days before | Owner | `Your flatmate {post} comes off the board in {n} days` | `Renew it from your dashboard to keep it up for another {n} days.` | `/dashboard#listings` |
| `flatmate.{post\|group}.expired` | Expiry sweep | Owner | `Your flatmate {post} is off the board` | `It went {n} days without an update. Renew it from your dashboard to put it back up.` | `/dashboard#listings` |
| `flatmate.moderated.live` | Moderator approves an ad | Author | Your flatmate ad is live | People can now see it and contact you. | Ad |
| `flatmate.moderated.{verdict}` | Moderator rejects / removes | Author | Your flatmate ad is not live | It did not pass our review. | Ad |
| `flatmate.moderated.held` | Linked listing stopped being live | Host | Your flatmate ad is back in review | The listing it was linked to is no longer live, so our team will check the ad before it shows again. | Ad |
| `flatmate.review.approved` | Agreement check passes (staff) | Host | Your flatmate post is verified | Thanks — we have checked your agreement and your post now shows as verified. | Post |
| `flatmate.review.approved` | Matched to a Draazy-registered agreement (automatic) | Host | Your flatmate post is Tenant-verified | We matched it to the rent agreement we registered for you, so there was nothing left for our team to check. | Post |
| `flatmate.review.rejected` | Agreement check fails | Host | We could not verify your flatmate post | `We could not verify your post. {reason}` | Post |
| `flatmate.review.expired` | Agreement end date passed | Host | Your flatmate verification has expired | Stored reason | Post |

### Services (rent agreement and other paid services)

Links open the service's page (`ServiceRequestTypes.pageFor`).

| Type | Trigger | To | Title | Body |
|---|---|---|---|---|
| `service.party-invited` | Requester adds the other party | Invitee | `You were added as the {landlord/tenant}` | Complete your details so this request can move forward. |
| `service.party-details-submitted` | Other party fills their details | Requester | The other side has filled in their details | Open the request and pay to send it to our drafting team. |
| `service.draft-shared` | Drafter shares a draft (or a checked draft is released) | Requester | Your draft is ready to review | Our team has shared a draft with you. Approve it, or ask for changes. |
| `service.amendment-proposed` | Staff propose revised terms | Requester | Revised terms to accept | `The new terms add ₹{delta} of charges. Accept and pay to continue.` / Accept the new terms so our team can revise your draft. |
| `service.amendment-withdrawn` | Staff withdraw revised terms | Requester | Revised terms withdrawn | Our team withdrew the revised terms. Nothing more is due for them. |
| `service.document-rejected` | Staff reject an uploaded document | Uploader | `Re-upload {document}` | Staff reason |
| `service.refund-approved` | Refund approved | Requester | `₹{amount} refund on its way` | It goes back to the card or account you paid with. Banks usually take 5–7 working days. |
| `service.cancelled` | Staff cancel the request | Requester | Your request was cancelled | `Our team cancelled this request: {reason}` |

## In-app — staff and admin

| Type | Trigger | To | Title | Body | Link |
|---|---|---|---|---|---|
| `listing.owner_confirmed` | Owner confirms a post-on-behalf listing via the claim link | Staff member who posted it | Owner confirmed a listing | `"{listing}" is ready for review.` | `/admin/properties` |
| `service.amendment-applied` | Customer accepts revised terms | Assigned drafter | Revised terms accepted | The customer accepted the revised terms. Share the revised draft. | `/ops/drafting-desk` |
| `team.manager-action` | A **manager** creates, edits, archives, restores, suspends or reactivates a staff account, resets 2FA, reissues an invite or changes permissions | Every live admin | Manager changed team access | `{action}: {staff name}` | `/admin/team` |

Staff read these in the admin top bar's bell, under **For you**. The red dot there means "something unread" only:
unread personal notifications or owner replies. The pending-verification and open-ticket queues are listed in the
same panel but never light the dot, because they are standing work rather than news.

## WhatsApp — paid (Meta Cloud API)

Business-initiated template messages from the Draazy number. Both templates must be approved on the WABA.

### One-time codes — `AUTHENTICATION` template

| Setting | Value |
|---|---|
| Template | `WHATSAPP_OTP_TEMPLATE_NAME` / `WHATSAPP_OTP_TEMPLATE_LANG` (default `en_US`); boot fails if unset while WhatsApp is enabled |
| Parameters | `{{1}}` = the 6-digit code; the same code fills the copy-code URL button |
| Sender | `WhatsAppOtpSender` (local profile logs `[MOCK OTP]`; sandbox uses `draazy.otp.sandbox-code`) |

The same template carries every code purpose:

| Purpose | When | To |
|---|---|---|
| `login` | Sign-in | Anyone signing in |
| `owner-consent` | A flatmate host lists a flat they don't own; the owner confirms consent | Property owner |
| `draft-approval` | A party approves a service draft | That party |

Spend guards (`OtpSendBudget`, prod values): 60-second resend cooldown, 5 sends per mobile per window, 500 per
platform per window, 100 per purpose per window.

### Identity-verification decisions — `UTILITY` template

Template `WHATSAPP_IDENTITY_TEMPLATE_NAME` (blank = in-app only), one body parameter `{{1}}` holding the whole
line. Sent after commit by `WhatsAppDecisionMessenger`; failures are logged and swallowed.

| Decision | `{{1}}` |
|---|---|
| Rejected (reviewer, or pending too long) | Your Draazy identity verification could not be completed. Open the app to see the reason and retake your photos. |
| Revoked | Your Draazy verified badge was withdrawn. Open the app to see the reason and submit again. |

Approvals and the automatic check's rejects are in-app only. Both sends respect the user's `whatsapp` toggle.

### Waiting-on-you digest — `UTILITY` template

One WhatsApp per user per day, sent by `WaitingDigestSweep` at 10:00 IST (`draazy.engagement.waiting-digest.enabled`,
default on) through `WaitingDigestService`. Template `WHATSAPP_DIGEST_TEMPLATE_NAME` / `WHATSAPP_DIGEST_TEMPLATE_LANG`
(default `en_US`); blank name = skipped and logged, nothing is sent. Needs Meta approval before it is set. Suggested
body: `You have {{1}} waiting for your reply on Draazy. Open the app to respond.`, with `{{1}}` = `1 request` or
`N requests`.

A user is included only when all of these hold:

- Something addressed to them is still unanswered: a `pending` contact request or document request, a `pending`
  offer, or a `scheduled` visit whose slot has not passed, each on an `approved` listing they own. The count adds all
  four kinds.
- At least one such request arrived after they last opened the app (`users.last_active`, touched when the app opens its
  message stream) and after the previous digest, so the same request is announced once.
- The account is `active` and the `whatsapp` preference is on (`Notifier.allowsWhatsapp`).
- No digest went to them in the last 20 hours. The send is claimed with a conditional update of
  `users.waiting_digest_at`, so overlapping instances cannot both send; a send the vendor did not accept (or a
  blank template) releases the claim so the requests are announced on the next run.
- The listing and the account are not archived.

A failed send is logged and does not stop the rest of the batch.

## WhatsApp — free click-to-chat (staff → owner)

Staff pick a template in the admin console; the server renders it, writes an `outbound_message` row (`prepared`)
and returns a `wa.me/91{mobile}?text=…` link. The staff member presses send in **their own** WhatsApp, so Meta
charges nothing. `POST /properties/{id}/outreach/{messageId}/sent` is the staff attestation that turns the row
`sent`; when the message carries the claim link, the listing moves to the `link_sent` step.

Templates are seeded in `backend/src/main/resources/db/migration/R__DML_seed_reference_data.sql` (table
`message_template`). There is deliberately no editing screen: changing this copy is a reviewed migration.

Variables, filled server-side by `OwnerOutreachService`: `{owner_name}`, `{owner_mobile}`, `{title}`,
`{locality}`, `{price}`, `{market_rate}` (₹/sq ft for the locality), `{listing_id}`, `{staff_name}`,
`{claim_link}` (`{base-url}/signin?claim={id}`), `{listing_link}` (`{base-url}/property/{id}`). `{price}` and
`{market_rate}` are digits with Indian grouping (`24,00,000`); the template supplies the `₹`. A key with no value
(for example `{market_rate}` in a locality with fewer than three live sale listings) is left in braces so staff see
the gap in the preview.

Where staff use them:
- **Post on Behalf** success screen → *Send claim link on WhatsApp* (`wa-onboard`) → *I've sent it*.
- **Property review** → WhatsApp templates panel (any template); the Communication log shows each one with *Mark sent*.
- **Needs Follow-up** board → one-click reminder (`wa-gentle`) and availability check (`wa-stale` / `wa-dormant`).

### Onboarding

**`wa-onboard` — Onboarding welcome** (post on behalf)
```
Hi {owner_name}, welcome to Draazy! 🏠

Your property "{title}" in {locality} has been listed by our team. To make it live, please:

1️⃣ Open your claim link: {claim_link}
2️⃣ Upload property photos
3️⃣ Complete identity verification

Need help? Reply here or call us.
— {staff_name}, Draazy Team
```

### Reminders

**`wa-photos` — Photo upload reminder**
```
Hi {owner_name},

Your listing "{title}" is almost ready! We just need property photos to publish it.

📸 Upload 4-6 clear photos showing:
• Living room/bedrooms
• Kitchen & bathrooms
• Balcony/exterior

Listings with photos get 3x more enquiries!

Upload here: {claim_link}
— Draazy Team
```

**`wa-identity` — Identity verification**
```
Hi {owner_name},

One last step! Please verify your identity for "{title}" to go live.

🔒 A quick photo of your ID and a selfie — a one-time check to build trust with buyers.

Verify here: {claim_link}
— Draazy Team
```

**`wa-gentle` — Gentle follow-up**
```
Hi {owner_name},

Just checking in on "{title}" in {locality}. We have interested buyers waiting!

Is there anything blocking you from completing the listing? Happy to help over call.

— {staff_name}, Draazy
```

**`wa-stale` — Confirm still available (stale)**
```
Hi {owner_name}, 👋

Quick check on your listing "{title}" in {locality} — buyers are still finding it, but you haven't confirmed availability in a while.

Is it still available?
✅ Reply "YES" to confirm and keep it live & trusted
🏠 Reply "DONE" if it's already rented/sold and we'll close it

Confirming takes one tap: 🔗 {listing_link}

— Draazy Team
```

**`wa-dormant` — Dormant listing reactivation**
```
Hi {owner_name}, ⏰

Your listing "{title}" in {locality} has been *paused* because it hasn't been confirmed as available in a while — so buyers can no longer see it.

If it is still available, reactivate it in one tap:
🔗 {listing_link}

Just reply "YES" and we'll make it live again instantly. If it's already rented/sold, reply "DONE" and we'll close it for you.

— Draazy Team
```

### Notifications and advice

**`wa-live` — Listing live notification**
```
Great news, {owner_name}! 🎉

Your property "{title}" is now LIVE on Draazy!

🔗 View: {listing_link}

Buyers can now see your listing and send enquiries. We'll notify you when someone is interested.

— Draazy Team
```

**`wa-enquiry` — New enquiry alert**
```
Hi {owner_name},

You have a new enquiry for "{title}"! 📩

A buyer is interested in your property. Please check your Draazy dashboard to approve or decline the contact request.

— Draazy Team
```

**`wa-pricing` — Pricing suggestion**
```
Hi {owner_name},

Quick market update for {locality}:

📊 Avg rate: ₹{market_rate}/sqft
🏷️ Your listing: ₹{price}

Properties priced within 10% of market rate get 2x more views. Would you like to adjust?

— {staff_name}, Draazy
```

**`wa-docs` — Document request**
```
Hi {owner_name},

To complete verification of "{title}", we need:

📄 Property ownership proof (sale deed / society NOC)
📄 Recent electricity bill

Please upload via your dashboard or share photos here.

— {staff_name}, Draazy Team
```

### Verification reasons

Suggested in the review modal from the reviewer's reason code.

| Template | Name | Message (after `Hi {owner_name},`) — each ends `— Draazy Team` |
|---|---|---|
| `reason_photos_not_real` | Actual property photos needed | For "{title}", please add clear photos of the actual property so buyers know what they will visit. Upload them here: {claim_link} |
| `reason_duplicate` | Duplicate listing check | We found another similar listing for "{title}". Please keep only the correct one live, or reply here if this is a separate property. |
| `reason_broker` | Owner confirmation needed | Please confirm "{title}" is being listed by the owner or family member, not a broker. Reply here and we will continue the review. |
| `reason_wrong_details` | Listing details need a quick fix | Some details on "{title}" look different from the property. Please check the price, address, photos and room details, then resubmit. |
| `reason_locality_unclear` | Locality needs confirmation | We could not place "{title}" in the right locality. Please update the locality or share the nearest landmark here. |
| `reason_document_unreadable` | Readable document needed | The document/photo for "{title}" is not clear enough to read. Please upload a brighter, full-page photo and we will check again. |
| `reason_name_mismatch` | Name confirmation needed | The name on the document for "{title}" does not match the listing owner. Please share the correct document or tell us the family connection. |

## WhatsApp — consumer-initiated links (free)

Prefilled `wa.me` links the user sends from their own WhatsApp. Draazy records nothing.

| Where | From → To | Prefilled text |
|---|---|---|
| Owner profile (`Owner.jsx`) | Buyer → owner | `Hi {first name}, I saw your profile on Draazy and I'm interested in your listings. Are they still available?` |
| Schedule visit (`ScheduleVisit.jsx`) | Visitor → owner | `Hi, I've requested a {mode} visit to {listing} on {date} at {time} (via Draazy). Could you confirm the slot?` |
| Dashboard visits — confirmed | Owner → visitor | `Hi {name}, your visit to {listing} is confirmed {when}. See you then! — Draazy` |
| Dashboard visits — cancelled / no-show | Owner → visitor | `Hi {name}, unfortunately the visit to {listing} {when} has been cancelled. Happy to help you reschedule. — Draazy` |
| Dashboard visits — pending | Owner → visitor | `Hi {name}, regarding your visit request for {listing} {when}. Let me know if the slot works and I'll confirm it. — Draazy` |
| Dashboard visits — reschedule | Owner → visitor | `Hi {name}, can we move your visit to {listing} to {date} at {time}? Please confirm and I'll lock it in. — Draazy` |
| Rent agreement co-fill invite | Requester → other party | `Hi {name}, {inviter} invited you to complete your rent-agreement details on Draazy for {property}. Please sign in (or create an account) first, then open this invite: {link}` + `Sign up: {signup link}` |
| Property share (`useProperty.js`) | Anyone → anyone | `{title} {price} on Draazy (₹0 brokerage): {url}` |
| Refer & earn | User → friend | `Join me on Draazy — India's broker-free property platform. Use my code {code} to get started: {link}` |
| Reels share | Anyone → anyone | `{text} — {url}` |
| Chat thread / dashboard contact buttons | Either party, after the contact gate | No prefilled text |
| Support (`supportContact.js`) | User → Draazy support (`wa.me/918728872895`) | No prefilled text |

Visit and owner-profile copy is translated (`frontend/src/i18n/locales/{lang}/dashboard.json`, `owner.json`).

## Email (ZeptoMail)

Back-office only. No consumer email is sent: consumer email addresses are not verified.

| Email | Trigger | To | Subject |
|---|---|---|---|
| Staff invite | Admin/manager creates a staff account | The new account's email | You're invited to the Draazy back office |
| Password reset | Admin/manager reissues the invite (reset) | The account's email | Reset your Draazy back-office password |

Body (`StaffInviteMailer`, plain text, sent after commit; skipped when the account has no email):
```
Hi {name},

{lead}

{invite link}

The link works once and expires in {n} days. If you weren't expecting this email, ignore it and tell your Draazy administrator.
```
`{lead}` is `You've been given a Draazy back-office account. Open this link to choose your password:` (invite) or
`Your Draazy back-office password was reset. Open this link to choose a new one:` (reset). The admin's copy-link
dialog remains the fallback.

## Web push

Only one payload exists, for new chat messages (`PushPayloads.messageReceived`):

| Title | Body | Opens |
|---|---|---|
| Draazy | You have a new message | `/messages?c={conversationId}` |

Browsers subscribe through `/me/push-subscriptions` (the frontend needs `VITE_VAPID_PUBLIC_KEY`).

- **Sender.** With `PUSH_VAPID_PRIVATE_KEY` set (plus `PUSH_VAPID_PUBLIC_KEY`, and `PUSH_VAPID_SUBJECT` as the
  `mailto:` or https contact), `WebPushSender` encrypts the payload (RFC 8291, `aes128gcm`), signs a VAPID JWT
  (RFC 8292, ES256) and POSTs to the browser vendor's endpoint, on the JDK alone. Without the private key
  `LoggingPushSender` is wired and nothing leaves the process. A key pair that is not valid P-256, or a private key
  without its public key, or a public key that is not the private key's pair, fails boot rather than the first push.
- **Delivery.** Scheduled off the request thread for every message; best-effort, one attempt, 5 s timeout, TTL 24 h.
- **Expired subscriptions.** A 404 or 410 from the push service deletes that `push_subscriptions` row. Other failures
  (4xx, 5xx, network) keep it.
- **Endpoint guard.** The endpoint is client-supplied, so the sender only posts to public `https` URLs on port 443:
  userinfo, loopback, private, link-local, carrier-grade-NAT, unique-local and NAT64 addresses are refused and the
  row is dropped. A user keeps at most 10 subscriptions (the newest) and the request fields are length-capped.
- **Device.** `frontend/public/push-sw.js` (imported into the Workbox worker) shows the notification and, on tap,
  focuses an open tab or opens the payload `url` (same-origin paths only).

## Gaps and planned changes

**Not notified today**
- Consumer account suspended / reactivated.
- Contact request declined, document request declined.
- Owner gets no automatic message when staff post on their behalf — the claim link goes by click-to-chat (by design).

**WhatsApp cost plan (built)**
- The paid Cloud API carries three things: one-time codes, the daily [waiting-on-you digest](#waiting-on-you-digest--utility-template),
  and identity *rejected* (by a reviewer or the pending-expiry sweep) / *revoked*.
- Identity *approved* and the automatic check's rejects send no WhatsApp: the user is in the app at that moment and the
  bell row covers both.
- Everything else stays in-app, plus web push.
- Staff → owner messaging stays on free click-to-chat.
- The `whatsapp` toggle gates every paid send except codes. The `email` and `sms` toggles stay stored-only: wire them
  before adding any new paid send on those channels.
- Consumer email (receipts, refunds) only after consumer email verification exists.

## Adding a notification

1. Call `notifier.notify(...)` inside the transaction that makes the change; never notify the actor.
2. Name the type `{domain}.{event}` so the frontend prefix mapper picks it up.
3. Keep the body free of other users' mobile numbers and other PII.
4. For a new paid channel send, get the Meta template approved first and go through a `provider/` seam with a
   logging fallback.
5. Add the row to this document.
