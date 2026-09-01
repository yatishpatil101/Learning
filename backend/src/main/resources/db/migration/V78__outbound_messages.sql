-- V78: the owner-outreach ledger, and the template library it draws from (D216).
--
-- ---------------------------------------------------------------------------------------------
-- What was here before
-- ---------------------------------------------------------------------------------------------
-- Nothing. The admin console has had a Follow-up tab and a WhatsApp template panel since the mock
-- era, and neither had a server behind it. `sendOwnerReminder` incremented a number in the
-- browser's own copy of the database and produced no message. `sendWhatsappTemplate` interpolated
-- a template and opened wa.me -- which is a real send, but left no record anywhere the next
-- colleague could see. Two staff members chasing the same owner had no way to discover each other.
--
-- ---------------------------------------------------------------------------------------------
-- `prepared` is a status, not a euphemism
-- ---------------------------------------------------------------------------------------------
-- The send this platform performs today is WhatsApp click-to-chat: the server renders the text and
-- the staff member's own WhatsApp opens with it typed out, and they press send. That is a genuine
-- and fully working mechanism -- no Business API, no vendor, no Meta template approval, which is
-- why the console has been able to use it all along -- but it is one the server cannot witness.
-- The staff member may send it, edit it first, or close the tab, and nothing reports back.
--
-- So the ledger records what actually happened: a message was composed and handed to a human.
-- `status` starts at `prepared` and stays there. It does not start at `sent`, because that would
-- be the platform asserting something it has no evidence for, in a table whose whole purpose is to
-- be the evidence. When a Business Solution Provider is eventually wired in it will move rows to
-- `sent` or `failed` on a delivery callback, and the vocabulary is already here to receive it --
-- but until then the Follow-up tab should say "prepared", and the count beside a listing should be
-- read as "chasers written", not "chasers delivered".
--
-- This is also why there is no `simulated` flag. A flag would imply the row is a stand-in for a
-- real send that will happen elsewhere. It is not; the send is real and the row is an accurate
-- record of the part of it the server participated in.
--
-- ---------------------------------------------------------------------------------------------
-- Why templates are a table
-- ---------------------------------------------------------------------------------------------
-- The ten templates existed as a frozen array in the browser bundle, which meant changing the
-- wording of a reminder was a frontend deploy. They are operational copy: the people who know
-- whether "Is it still available?" is working are the desk staff reading the replies, and they
-- should not need a release to act on that. A table also gives every environment the same library
-- -- the live e2e run can assert on a template that is actually there rather than one the bundle
-- happened to ship.
--
-- `id` is the template's slug rather than a uuid, because these are referenced by name in code,
-- in audit rows and in conversation ("send them wa-aadhaar"), and a uuid would make every one of
-- those an indirection. The slugs are the ones the console already used, so existing muscle memory
-- and any prior audit trail keep meaning the same thing.
--
-- `active` rather than deletion: a retired template must still resolve, because `outbound_message`
-- rows point at it and the Follow-up tab renders their names. Deleting one would either break the
-- foreign key or blank out history that was true when it was written.

create table message_template (
    id          text primary key,
    channel     text        not null check (channel in ('whatsapp', 'sms', 'email')),
    category    text        not null check (category in ('onboarding', 'reminder', 'notification', 'advice', 'verification')),
    name        text        not null,
    body        text        not null,
    active      boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- The desk lists by channel and hides retired copy; nothing ever scans the whole table.
create index idx_message_template_channel on message_template (channel) where active;

-- ---------------------------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------------------------
-- `body` is the rendered text, stored in full rather than reconstructed from the template plus
-- variables at read time. Templates are editable now, so re-rendering would show a colleague the
-- message as it reads *today* rather than the one the owner was actually sent -- which is the
-- opposite of what a record is for. It also means a row survives its template being retired.
--
-- `recipient_mobile` is stored beside `recipient_user_id` for the same reason: an owner who later
-- changes their number should not retroactively make the log claim the chaser went somewhere it
-- did not. The user reference answers "who", the mobile answers "where it went".
--
-- `subject_type`/`subject_id` rather than a `property_id` column: the first caller is the listing
-- funnel, but the mechanism is not about listings -- a visit no-show or a document chase are the
-- obvious next two, and neither hangs off a property. Same discriminator shape V76 used, and for
-- the same reason: the id cannot carry a foreign key when it points at more than one table, so the
-- CHECK on `subject_type` is what stops a row pointing at nothing.

create table outbound_message (
    id               uuid        primary key default gen_random_uuid(),
    channel          text        not null check (channel in ('whatsapp', 'sms', 'email')),
    template_id      text        references message_template (id),
    subject_type     text        not null check (subject_type in ('property')),
    subject_id       uuid        not null,
    recipient_id     uuid        not null references users (id),
    recipient_mobile text        not null,
    body             text        not null,
    status           text        not null default 'prepared' check (status in ('prepared', 'sent', 'failed')),
    prepared_by      uuid        not null references users (id),
    -- clock_timestamp(), not now(). now() returns the transaction's start time, so two chasers
    -- prepared inside one transaction would share a timestamp to the microsecond and the log would
    -- come back in an arbitrary order — the one place where order is the whole point, since the
    -- reader is a colleague asking "what was this owner told last?". clock_timestamp() reads the
    -- wall clock at insert, which is what an event ledger means by when.
    prepared_at      timestamptz not null default clock_timestamp(),
    sent_at          timestamptz,
    failure_reason   text
);

-- Every read is "the outreach for this listing, newest first" -- the Follow-up tab's timeline and
-- the reminder count on a pipeline card are the same query with a different projection.
create index idx_outbound_message_subject on outbound_message (subject_type, subject_id, prepared_at desc);

-- ---------------------------------------------------------------------------------------------
-- Seed: the ten templates the console already shipped
-- ---------------------------------------------------------------------------------------------
-- Copied verbatim, emoji included. They are not decoration -- these are WhatsApp messages to
-- consumers in Pune, and the register they are written in is the one that gets replies. Rewriting
-- them into house style during a migration would be changing the product under cover of a schema
-- change.
--
-- `{var}` placeholders are interpolated at send time. An unknown key is left standing rather than
-- blanked, so a typo shows up as a literal `{owner_nme}` in the preview the staff member reads
-- before sending, instead of silently deleting half a sentence.

insert into message_template (id, channel, category, name, body) values
('wa-onboard', 'whatsapp', 'onboarding', 'Onboarding welcome',
 E'Hi {owner_name}, welcome to PuneNest! \U0001F3E0\n\nYour property "{title}" in {locality} has been listed by our team. To make it live, please:\n\n1\uFE0F\u20E3 Open your claim link\n2\uFE0F\u20E3 Upload property photos\n3\uFE0F\u20E3 Complete Aadhaar verification\n\nNeed help? Reply here or call us.\n\u2014 {staff_name}, PuneNest Team'),
('wa-photos', 'whatsapp', 'reminder', 'Photo upload reminder',
 E'Hi {owner_name},\n\nYour listing "{title}" is almost ready! We just need property photos to publish it.\n\n\U0001F4F8 Upload 4-6 clear photos showing:\n\u2022 Living room/bedrooms\n\u2022 Kitchen & bathrooms\n\u2022 Balcony/exterior\n\nListings with photos get 3x more enquiries!\n\nUpload here: {claim_link}\n\u2014 PuneNest Team'),
('wa-aadhaar', 'whatsapp', 'reminder', 'Aadhaar verification',
 E'Hi {owner_name},\n\nOne last step! Please complete Aadhaar verification for "{title}" to go live.\n\n\U0001F512 This is a one-time identity check to build trust with buyers.\n\nVerify here: {claim_link}\n\u2014 PuneNest Team'),
('wa-gentle', 'whatsapp', 'reminder', 'Gentle follow-up',
 E'Hi {owner_name},\n\nJust checking in on "{title}" in {locality}. We have interested buyers waiting!\n\nIs there anything blocking you from completing the listing? Happy to help over call.\n\n\u2014 {staff_name}, PuneNest'),
('wa-live', 'whatsapp', 'notification', 'Listing live notification',
 E'Great news, {owner_name}! \U0001F389\n\nYour property "{title}" is now LIVE on PuneNest!\n\n\U0001F517 View: punenest.com/property/{listing_id}\n\nBuyers can now see your listing and send enquiries. We\'ll notify you when someone is interested.\n\n\u2014 PuneNest Team'),
('wa-enquiry', 'whatsapp', 'notification', 'New enquiry alert',
 E'Hi {owner_name},\n\nYou have a new enquiry for "{title}"! \U0001F4E9\n\nA buyer is interested in your property. Please check your PuneNest dashboard to approve or decline the contact request.\n\n\u2014 PuneNest Team'),
('wa-pricing', 'whatsapp', 'advice', 'Pricing suggestion',
 E'Hi {owner_name},\n\nQuick market update for {locality}:\n\n\U0001F4CA Avg rate: \u20B9{market_rate}/sqft\n\U0001F3F7\uFE0F Your listing: \u20B9{price}\n\nProperties priced within 10% of market rate get 2x more views. Would you like to adjust?\n\n\u2014 {staff_name}, PuneNest'),
('wa-docs', 'whatsapp', 'verification', 'Document request',
 E'Hi {owner_name},\n\nTo complete verification of "{title}", we need:\n\n\U0001F4C4 Property ownership proof (sale deed / society NOC)\n\U0001F4C4 Recent electricity bill\n\nPlease upload via your dashboard or share photos here.\n\n\u2014 {staff_name}, PuneNest Team'),
('wa-stale', 'whatsapp', 'reminder', 'Confirm still available (stale)',
 E'Hi {owner_name}, \U0001F44B\n\nQuick check on your listing "{title}" in {locality} \u2014 buyers are still finding it, but you haven\'t confirmed availability in a while.\n\nIs it still available?\n\u2705 Reply "YES" to confirm and keep it live & trusted\n\U0001F3E0 Reply "DONE" if it\'s already rented/sold and we\'ll close it\n\nConfirming takes one tap: \U0001F517 punenest.com/property/{listing_id}\n\n\u2014 PuneNest Team'),
('wa-dormant', 'whatsapp', 'reminder', 'Dormant listing reactivation',
 E'Hi {owner_name}, \u23F0\n\nYour listing "{title}" in {locality} has been *paused* because it hasn\'t been confirmed as available in a while \u2014 so buyers can no longer see it.\n\nIf it is still available, reactivate it in one tap:\n\U0001F517 punenest.com/property/{listing_id}\n\nJust reply "YES" and we\'ll make it live again instantly. If it\'s already rented/sold, reply "DONE" and we\'ll close it for you.\n\n\u2014 PuneNest Team');
