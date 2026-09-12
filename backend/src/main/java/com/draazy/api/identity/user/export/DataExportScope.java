package com.draazy.api.identity.user.export;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <strong>What the data export contains, what it leaves out, and how the second person on a shared
 * record is protected.</strong>
 *
 * <p>This class is to {@link DataExportService} what {@link
 * com.draazy.api.identity.user.erasure.ErasureRetention} is to {@code ErasureService}: it holds
 * almost no behaviour, and exists because the hard part of a right-to-access implementation is not
 * the {@code SELECT} statements. It is deciding <em>which</em> rows are the subject's to see, and
 * that decision is invisible in the code that acts on it. A future reader can reconstruct what the
 * service does by reading it. They cannot reconstruct why a landlord's export of a tenancy carries
 * the rent but not the tenant's mobile, and getting that wrong in either direction is a legal
 * failure: disclose too little and the platform has not honoured a statutory right; disclose too
 * much and it has committed a personal-data breach against somebody who never asked for anything.
 *
 * <h2>The governing rule</h2>
 *
 * <p>Digital Personal Data Protection Act 2023 (India), <strong>s.11(1)</strong> — a Data Principal
 * has the right to obtain from the Data Fiduciary a summary of the personal data being processed
 * about them, the processing activities, and the identities of anybody it has been shared with.
 * <strong>s.11(2)</strong> is the limit that makes the rest of this file necessary: nothing in
 * s.11(1) requires disclosure that would <em>"reveal the identity of any other Data Principal"</em>.
 * That is not a courtesy the platform extends to counterparties. It is the statute, and it says the
 * export must stop at exactly the boundary this class draws.
 *
 * <h2>Where the scope came from — and why it is not a fresh list</h2>
 *
 * <p>Every table below was taken from the erasure coverage map, not enumerated afresh. {@code
 * ErasureCoverageTest} classifies every personal-data column in the migrated schema as swept,
 * retained, or a disclosed gap; between them those three maps <em>are</em> the platform's inventory
 * of where it keeps personal data, and they are already proved against {@code information_schema}
 * rather than against a second hand-written list. Deriving the export from them means the two
 * features cannot silently drift: {@code DataExportCoverageTest} fails the build if a table named in
 * {@link com.draazy.api.identity.user.erasure.ErasureRetention#knownGaps()} is neither exported
 * nor explicitly excluded here.
 *
 * <p>The principle behind that coupling is simple and worth stating plainly: <strong>if the platform
 * is willing to destroy a table's rows on the subject's say-so, it cannot claim those rows are none
 * of the subject's business.</strong> The erasure gaps matter most of all. Those are the places
 * where personal data survives an erasure request, and the subject is entitled to see them
 * <em>more</em> urgently than the rest, not less — so {@code saved_searches
 * .mobile}, {@code flatmate_group_members.name}, {@code society_leads}, {@code city_waitlist},
 * {@code deal_parties}, {@code personal_documents}, {@code flatmate_seeker_posts} and the referral
 * tables are all in the export even though the erasure sweep does not reach them.
 *
 * <h2>The redaction rule</h2>
 *
 * <p>A tenancy, a deal, a chat thread, a contact request, an offer and a flatmate group each involve
 * a second person. The rule applied uniformly to every one of them is:
 *
 * <ol>
 *   <li><strong>The record is the subject's.</strong> That it happened, when, its status, its money,
 *       and the property it concerns are exported in full. Those facts are as much the subject's
 *       history as the counterparty's, and withholding them would leave an export that says a
 *       tenancy existed without saying what its rent was.</li>
 *   <li><strong>The subject's own contribution is exported in full</strong> — every word they wrote,
 *       every number they supplied, including free text in which they happened to name somebody else
 *       ({@code tenant_profiles.prior_landlord}, {@code managed_properties.tenant_name}). They typed
 *       it, they can already read it back in the product, and returning it to them discloses nothing
 *       new.</li>
 *   <li><strong>The counterparty is reduced to {@code partyRef}</strong> — see {@link
 *       DataExportRedaction}. Stable across this subject's exports so they can see that the same
 *       person appears on three records; meaningless outside them, because the digest is salted with
 *       the subject's own id.</li>
 *   <li><strong>The counterparty's own contribution is exported only where the product already shows
 *       it to the subject.</strong> A message in their chat thread, the note on an enquiry they
 *       received, the name on a referral they made — the subject is looking at all of these on
 *       screen right now, and an export that hid them would be a worse record of the correspondence
 *       than the inbox it came from.</li>
 *   <li><strong>The counterparty's contact details, government identifiers, documents, KYC and
 *       verification state are never exported, in any dataset, under any framing.</strong> This is
 *       the line that does not move. It is why {@code deals.counterparty_mobile} appears when the
 *       subject <em>is</em> the counterparty and is absent from the same table when they are the
 *       owner, and why {@code rent_agreements} is two datasets rather than one.</li>
 * </ol>
 *
 * <p><strong>The mechanical form of the rule, which is what the test actually checks:</strong> no
 * query in this file reads a second person's {@code users} row. {@code users} appears exactly once
 * in the whole scope, in the {@code account} dataset, keyed on {@code id = :subjectId}. Everything
 * else about another person would have to arrive either through that join — which does not exist —
 * or through a denormalised column, and every such column is either omitted from its select list or
 * routed through {@code party_ref_src}. Stating the rule this way makes it checkable by reading the
 * SQL rather than by trusting a paragraph, which is the only kind of rule that survives a year of
 * edits.
 *
 * <h2>The staff rule</h2>
 *
 * <p>A second and much smaller rule, applied just as uniformly: <strong>free text a staff member
 * wrote about the subject is not exported, and the staff member is never named.</strong> That covers
 * {@code users.flag_reason}, {@code properties.flag_reason} and {@code archive_reason}, {@code
 * internal_notes}, {@code ticket_notes}, {@code property_reviews} and the {@code decided_by} /
 * {@code recorded_by} / {@code assignee_id} / {@code handled_by} columns. Two reasons, and the
 * second is the load-bearing one: a moderator's assessment is a statement by an identifiable
 * employee, and a fraud investigation that hands its subject the investigator's notes is not an
 * investigation. The single deliberate exception is {@code erasure_requests.decision_note}, which
 * {@code GET /me/erasure} already returns to the subject on purpose — a refusal they cannot
 * understand is a refusal they cannot act on — so withholding it here would make the two endpoints
 * disagree about the same row.
 *
 * <h2>Named columns, not {@code select *}</h2>
 *
 * <p>Every query below lists its columns. This is the same choice {@code ErasureService} made for
 * its {@code UPDATE}s and for the same reason inverted: a named-column {@code SELECT} is the form in
 * which a reviewer can see exactly what leaves the building, and it is the only form under which a
 * migration adding a column to a table cannot silently start exporting it. {@code select *} on
 * {@code deals} would have begun disclosing {@code counterparty_mobile} to landlords the day V11
 * shipped, with no diff anywhere to notice.
 */
public final class DataExportScope {

    private DataExportScope() {
    }

    /**
     * The alias that marks a column as another person's identifier.
     *
     * <p><strong>Every value selected under this alias is hashed before it reaches the wire</strong>
     * — see {@link DataExportRedaction#partyRef}. That is deliberately a property of the alias and
     * not of the column, because it makes the mechanism safe against being wrong: {@code
     * offer_history.by} and {@code service_request_timeline.by} are {@code text}, and nothing in the
     * schema says whether they hold a user id, a staff email or a display name. Routing them through
     * here means a wrong guess about their contents costs an unhelpfully opaque field rather than a
     * disclosure.
     */
    static final String PARTY_REF_SOURCE = "party_ref_src";

    /** What {@link #PARTY_REF_SOURCE} becomes on the wire. */
    static final String PARTY_REF = "partyRef";

    /**
     * One table's contribution to the export.
     *
     * @param domain   the group this appears under in the document, so a person reading it can find
     *                 "my listings" without knowing that listings live in {@code properties}
     * @param name     the dataset's name on the wire. Usually the table name — the export is a
     *                 disclosure document and naming the actual table is part of being honest about
     *                 what is held — but split into {@code _sent} / {@code _received} halves where
     *                 the two directions have different redaction, because one name over two column
     *                 lists would hide exactly the difference that matters
     * @param describes one sentence a non-technical reader can understand. Written for the data
     *                 subject, who is the only guaranteed reader of this document
     * @param sql      a named-column {@code SELECT} over {@code :subjectId}, {@code :subjectIdText}
     *                 and {@code :subjectMobile}. Must be wrappable in {@code select * from (…) d
     *                 limit ?}, so no trailing semicolon and no CTE that would break the wrap
     * @param withheld columns present in the table and deliberately absent from {@code sql}, with
     *                 the reason. Serialised into the response: a dataset that quietly dropped a
     *                 column would be the silent-omission failure this whole feature is built to
     *                 avoid
     */
    record Dataset(String domain, String name, String describes, String sql,
            Map<String, String> withheld) {
    }

    /** A whole table left out of the export, and why. Serialised into the response. */
    record Exclusion(String name, String reason) {
    }

    // ------------------------------------------------------------------ the datasets

    private static final List<Dataset> DATASETS = datasets();

    static List<Dataset> datasets() {
        List<Dataset> out = new ArrayList<>();
        account(out);
        identity(out);
        listings(out);
        enquiries(out);
        agreements(out);
        messaging(out);
        support(out);
        community(out);
        flatmate(out);
        return List.copyOf(out);
    }

    // --- account ----------------------------------------------------------------------------

    private static void account(List<Dataset> out) {
        out.add(new Dataset("account", "users",
                "Your account: the name, number, email and city you gave us, and the trust flags we "
                        + "derived from them.",
                """
                select id, name, mobile, email, role, team, status, city,
                       mobile_verified, verified, aadhaar_verified, verified_contact_only,
                       hide_number, listings_count, avatar, joined_at, last_active,
                       flagged, flagged_at, archived, archived_at, created_at, updated_at
                  from users
                 where id = :subjectId
                """,
                withheld(
                        "password_hash", "A credential, not a fact about you. Returning it would "
                                + "turn a document people forward to their lawyer into a way into "
                                + "the account, and it tells you nothing you did not already choose.",
                        "flag_reason", "Free text written by a staff member during a safety review. "
                                + "See the staff rule in this class's Javadoc.",
                        "flagged_by", "Identifies the staff member who raised the flag.",
                        "archive_reason", "As flag_reason.")));

        out.add(new Dataset("account", "notification_preferences",
                "Which channels you agreed to be contacted on, and your quiet hours.",
                """
                select email, sms, whatsapp, match_alerts, quiet_hours_enabled,
                       quiet_start, quiet_end, language, created_at, updated_at
                  from notification_preferences
                 where user_id = :subjectId
                """,
                Map.of()));

        out.add(new Dataset("account", "back_office_permissions",
                "If you hold a staff account, the permission atoms it resolves to. Empty for "
                        + "everybody else.",
                """
                select permissions, updated_at
                  from back_office_permissions
                 where user_id = :subjectId
                """,
                withheld("updated_by", "Identifies the administrator who last changed your "
                        + "permissions.")));

        out.add(new Dataset("account", "refresh_tokens",
                "Your signed-in sessions — when each began and when it expires. The tokens "
                        + "themselves are not included.",
                """
                select id, revoked, expires_at, created_at
                  from refresh_tokens
                 where user_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "token_hash", "A live credential. Anybody holding the hash cannot use it, "
                                + "but including secrets in a document whose whole purpose is to be "
                                + "downloaded and forwarded is a habit worth not starting.",
                        "rotated_from", "An internal chain pointer between tokens; it identifies "
                                + "nobody and means nothing outside the refresh implementation.")));

        out.add(new Dataset("account", "otp_codes",
                "One-time codes sent to your number that have not yet expired, and how many attempts "
                        + "each saw.",
                """
                select purpose, attempts, consumed, expires_at, created_at
                  from otp_codes
                 where mobile = :subjectMobile
                 order by created_at desc
                """,
                withheld("code_hash", "A live credential; see refresh_tokens.token_hash.")));

        out.add(new Dataset("account", "erasure_requests",
                "Requests you have made to have your data erased, and what we decided.",
                """
                select id, status, reason, requested_at, decided_at, decision_note,
                       erased, retained, created_at
                  from erasure_requests
                 where subject_id = :subjectId
                 order by requested_at desc
                """,
                withheld(
                        "subject_digest", "The one-way reference that survives a completed erasure. "
                                + "It is derived from your id, which is already the first field of "
                                + "this export, and GET /me/erasure returns it.",
                        "decided_by", "Identifies the administrator who decided the request. The "
                                + "note they wrote is included; who wrote it is not.")));
    }

    // --- identity ---------------------------------------------------------------------------

    private static void identity(List<Dataset> out) {
        out.add(new Dataset("identity", "identity_verifications",
                "Your Aadhaar-based identity check: its outcome, and the masked number we kept.",
                """
                select id, ref, badge, status, source, masked_aadhaar, mobile_match,
                       expires_at, verified_at, created_at, updated_at
                  from identity_verifications
                 where user_id = :subjectId
                """,
                withheld(
                        "identity_hash", "An irreversible digest of your Aadhaar, held only so that "
                                + "one document cannot open two accounts. It is not readable, it "
                                + "tells you nothing about yourself that masked_aadhaar does not, "
                                + "and putting it in a portable document would create a token by "
                                + "which two services could confirm they hold the same person.",
                        "verification_url", "A provider callback link from the verification "
                                + "session. It is a route into a third-party flow rather than a "
                                + "fact about you.")));

        out.add(new Dataset("identity", "owner_kyc",
                "The masked PAN and Aadhaar recorded when you were verified as an owner.",
                """
                select pan_masked, aadhaar_masked, bank_verified, status, created_at, updated_at
                  from owner_kyc
                 where user_id = :subjectId
                """,
                Map.of()));

        out.add(new Dataset("identity", "personal_documents",
                "Identity papers you uploaded to your own vault. The files are not in this document; "
                        + "this is the list of what we hold.",
                """
                select id, category, file_name, size_bytes, mime_type, uploaded_at,
                       created_at, updated_at
                  from personal_documents
                 where owner_id = :subjectId
                 order by uploaded_at desc
                """,
                withheld("storage_key", "The object-store path. It is a capability — a way to fetch "
                        + "the file — rather than information about you, and the product has its own "
                        + "authorised route to the same document.")));

        out.add(new Dataset("identity", "tenant_profiles",
                "The renter profile you wrote about yourself.",
                """
                select name, occupation, score, verified, income, occupants, move_in,
                       prior_landlord, about, created_at, updated_at
                  from tenant_profiles
                 where user_id = :subjectId
                """,
                Map.of()));

        out.add(new Dataset("identity", "tenant_rentals",
                "Homes you rent that you recorded yourself, including ones the platform was "
                        + "never involved in.",
                """
                select address, landlord_name, monthly_rent, deposit, lease_start, lease_end,
                       status, archived, created_at, updated_at
                  from tenant_rentals
                 where tenant_id = :subjectId
                """,
                Map.of()));
    }

    // --- listings ---------------------------------------------------------------------------

    private static void listings(List<Dataset> out) {
        out.add(new Dataset("listings", "properties",
                "Every listing you have posted, including ones you later archived.",
                """
                select id, slug, title, deal, property_type, bhk, price, price_unit, deposit,
                       maintenance, negotiable, area, area_unit, carpet_area, built_up_area,
                       super_built_up_area, furnishing, floor, total_floors, facing, possession,
                       locality, locality_slug, society_id, city, lat, lng, address, pincode,
                       rera_id, description, amenities, images, cover_image, floor_plan, video,
                       posted_by_type, status, featured, verified, owner_verified,
                       ownership_verified, society_verified, conveyance_done, docs_count, views,
                       enquiries, archived, archived_at, deal_status, boosted_until,
                       ownership_verified_at, ownership_verified_until, electricity_meter_no,
                       address_key, last_confirmed_at, handback_milestone, quality_score, land_use,
                       age_years, room, tenants, available_from, pets, sharing, property_type_key,
                       commercial_use_key, share_type, created_at, updated_at
                  from properties
                 where owner_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "flag_reason", "Staff free text from a moderation review.",
                        "archive_reason", "As flag_reason.",
                        "recheck_reason", "As flag_reason.",
                        "pipeline_stage", "Internal ops workflow state, written by staff about how "
                                + "they are handling the listing rather than about you.",
                        "admin_pipeline", "As pipeline_stage.",
                        "posted_by_admin", "Whether a staff member posted on your behalf; it names "
                                + "the operating model, not you.")));

        out.add(new Dataset("listings", "ownership_basis",
                "What you told us you paid for a property, and what you think it is worth now. "
                        + "Visible only to you.",
                """
                select property_id, purchase_price, purchase_date, loan_outstanding, emi,
                       current_value, created_at, updated_at
                  from ownership_basis
                 where owner_id = :subjectId
                """,
                Map.of()));

        out.add(new Dataset("listings", "property_ownership_evidence",
                "The identity document our staff sighted before granting a listing its Ownership "
                        + "Verified badge.",
                """
                select e.id, e.property_id, e.doc_type, e.issued_at, e.expires_at, e.subject_name,
                       e.created_at, e.updated_at
                  from property_ownership_evidence e
                  join properties p on p.id = e.property_id
                 where p.owner_id = :subjectId
                 order by e.created_at desc
                """,
                withheld(
                        "recorded_by", "Identifies the staff member who sighted the document.",
                        "document_id", "A pointer to the stored file; see personal_documents"
                                + ".storage_key.")));

        out.add(new Dataset("listings", "documents",
                "Files attached to your listings or to service requests you raised.",
                """
                select d.id, d.property_id, d.service_request_id, d.category, d.file_name,
                       d.size_bytes, d.mime_type, d.uploaded_at, d.created_at
                  from documents d
                  left join properties p on p.id = d.property_id
                  left join service_requests sr on sr.id = d.service_request_id
                 where p.owner_id = :subjectId or sr.requester_id = :subjectId
                 order by d.uploaded_at desc
                """,
                withheld("storage_key", "See personal_documents.storage_key.")));

        out.add(new Dataset("listings", "managed_properties",
                "Properties in your private Owner Hub, whether or not you ever published them.",
                """
                select id, title, deal, property_type, bhk, price, locality, locality_slug,
                       society, area, area_unit, furnishing, visibility, status, rented,
                       tenant_name, monthly_rent, due_day, valuation, published_listing_id,
                       created_at, updated_at
                  from managed_properties
                 where owner_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("listings", "managed_property_documents",
                "Papers you filed against a property in your Owner Hub.",
                """
                select d.id, d.managed_property_id, d.category, d.file_name, d.size_bytes,
                       d.mime_type, d.uploaded_at, d.created_at
                  from managed_property_documents d
                  join managed_properties m on m.id = d.managed_property_id
                 where m.owner_id = :subjectId
                 order by d.uploaded_at desc
                """,
                withheld("storage_key", "See personal_documents.storage_key.")));

        out.add(new Dataset("listings", "transactions",
                "Income and expenses you recorded against your properties.",
                """
                select id, property_id, type, category, amount, "date", note, recurring,
                       archived, archived_at, created_at, updated_at
                  from transactions
                 where owner_id = :subjectId
                 order by "date" desc
                """,
                withheld("archive_reason", "Staff free text.")));

        out.add(new Dataset("listings", "boosts",
                "Paid promotions you bought for a listing.",
                """
                select id, property_id, pack_id, starts_at, ends_at, status, payment_ref,
                       paid_at, created_at, updated_at
                  from boosts
                 where buyer_id = :subjectId
                 order by created_at desc
                """,
                withheld("idempotency_key", "A client-supplied token that stops a double tap "
                        + "charging you twice. Internal plumbing, not information about you.")));

        out.add(new Dataset("listings", "subscriptions",
                "Subscription plans you have held.",
                """
                select id, plan_id, status, started_at, renews_at, payment_ref,
                       created_at, updated_at
                  from subscriptions
                 where user_id = :subjectId
                 order by created_at desc
                """,
                withheld("idempotency_key", "See boosts.idempotency_key.")));

        out.add(new Dataset("listings", "saved_properties",
                "Listings you shortlisted.",
                """
                select property_id, created_at
                  from saved_properties
                 where user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("listings", "saved_searches",
                "Searches you saved, and the number we send the alerts to.",
                """
                select id, name, "query", filters, alert_frequency, channel, new_count, kind,
                       criteria, label, mobile, last_alerted_at, created_at, updated_at
                  from saved_searches
                 where user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("listings", "society_follows",
                "Buildings you follow.",
                """
                select society_id, created_at
                  from society_follows
                 where user_id = :subjectId
                """,
                Map.of()));

        out.add(new Dataset("listings", "demand_signals",
                "What you searched for, kept in aggregate form to tell owners where demand is.",
                """
                select id, kind, locality_slug, deal, bhk, property_id, created_at
                  from demand_signals
                 where user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("listings", "page_views",
                "Pages you viewed while signed in, for the ninety days we keep them. This is usually "
                        + "the largest dataset here and the most likely to be truncated.",
                """
                select session_id, path, referrer_host, device, occurred_at
                  from page_views
                 where user_id = :subjectId
                 order by occurred_at desc
                """,
                Map.of()));
    }

    // --- enquiries: the two-party read surfaces ----------------------------------------------

    private static void enquiries(List<Dataset> out) {
        out.add(new Dataset("enquiries", "contact_requests_sent",
                "Owners whose contact details you asked to see.",
                """
                select id, property_id, status, message, created_at, updated_at
                  from contact_requests
                 where requester_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("enquiries", "contact_requests_received",
                "People who asked for your contact details. Their message is included because the "
                        + "product already shows it to you; who they are is reduced to a reference.",
                """
                select c.id, c.property_id, c.status, c.message, c.created_at, c.updated_at,
                       c.requester_id as party_ref_src
                  from contact_requests c
                  join properties p on p.id = c.property_id
                 where p.owner_id = :subjectId
                 order by c.created_at desc
                """,
                withheld("requester_id", "Replaced by partyRef. The enquirer is another data "
                        + "principal and DPDP s.11(2) stops this export identifying them.")));

        out.add(new Dataset("enquiries", "visits_requested",
                "Viewings you asked for.",
                """
                select id, property_id, slot, mode, status, note, created_at, updated_at
                  from visits
                 where visitor_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("enquiries", "visits_received",
                "Viewings people asked for at your properties.",
                """
                select v.id, v.property_id, v.slot, v.mode, v.status, v.note, v.created_at,
                       v.updated_at, v.visitor_id as party_ref_src
                  from visits v
                  join properties p on p.id = v.property_id
                 where p.owner_id = :subjectId
                 order by v.created_at desc
                """,
                withheld("visitor_id", "Replaced by partyRef.")));

        out.add(new Dataset("enquiries", "offers_made",
                "Offers you made on other people's listings.",
                """
                select id, property_id, amount, status, message, move_in, created_at, updated_at
                  from offers
                 where from_user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("enquiries", "offers_received",
                "Offers made on your listings.",
                """
                select o.id, o.property_id, o.amount, o.status, o.message, o.move_in,
                       o.created_at, o.updated_at, o.from_user_id as party_ref_src
                  from offers o
                  join properties p on p.id = o.property_id
                 where p.owner_id = :subjectId
                 order by o.created_at desc
                """,
                withheld("from_user_id", "Replaced by partyRef.")));

        out.add(new Dataset("enquiries", "offer_history",
                "Every amount an offer moved through, on offers you made or received.",
                """
                select h.id, h.offer_id, h.amount, h.at, h."by" as party_ref_src
                  from offer_history h
                  join offers o on o.id = h.offer_id
                  left join properties p on p.id = o.property_id
                 where o.from_user_id = :subjectId or p.owner_id = :subjectId
                 order by h.at desc
                """,
                withheld("by", "Replaced by partyRef. The column is free text and the schema does "
                        + "not say whether it holds an id or a name, so it is hashed either way — "
                        + "see PARTY_REF_SOURCE.")));

        out.add(new Dataset("enquiries", "document_requests_sent",
                "Requests you made to see an owner's paperwork.",
                """
                select id, property_id, categories, status, acknowledged_disclaimer, message,
                       expires_at, created_at, updated_at
                  from document_requests
                 where requester_id = :subjectId
                 order by created_at desc
                """,
                withheld("share_token", "The unguessable token that opens the shared folder. It is "
                        + "a live capability and anybody holding this document would hold it too.")));

        out.add(new Dataset("enquiries", "document_requests_received",
                "Requests to see the paperwork on your properties.",
                """
                select d.id, d.property_id, d.categories, d.status, d.message, d.expires_at,
                       d.created_at, d.updated_at, d.requester_id as party_ref_src
                  from document_requests d
                  join properties p on p.id = d.property_id
                 where p.owner_id = :subjectId
                 order by d.created_at desc
                """,
                withheld(
                        "requester_id", "Replaced by partyRef.",
                        "share_token", "See document_requests_sent.share_token.")));
    }

    // --- agreements, deals and money ---------------------------------------------------------

    private static void agreements(List<Dataset> out) {
        out.add(new Dataset("agreements", "finalization_requests",
                "Deals either side asked to close, with you as initiator or as the other party.",
                """
                select f.id, f.property_id, f.agreed_price, f.status, f.created_at, f.updated_at,
                       case when f.initiator_id = :subjectId then 'initiator' else 'counterparty' end
                           as subject_role,
                       case when f.initiator_id = :subjectId then f.counterparty_id
                            else f.initiator_id end as party_ref_src
                  from finalization_requests f
                 where f.initiator_id = :subjectId or f.counterparty_id = :subjectId
                 order by f.created_at desc
                """,
                withheld("initiator_id / counterparty_id", "Whichever of the two is not you is "
                        + "replaced by partyRef.")));

        out.add(new Dataset("agreements", "deals_as_counterparty",
                "Deals where you were the buyer or tenant. The number on the row is yours.",
                """
                select id, property_id, deal, agreed_price, status, closed_at, note,
                       counterparty_mobile, created_at, updated_at
                  from deals
                 where counterparty_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("agreements", "deals_on_my_properties",
                "Deals on listings you own. Deliberately a separate dataset from "
                        + "deals_as_counterparty, because here the number on the row belongs to "
                        + "somebody else and is left out.",
                """
                select d.id, d.property_id, d.deal, d.agreed_price, d.status, d.closed_at,
                       d.note, d.created_at, d.updated_at, d.counterparty_id as party_ref_src
                  from deals d
                  join properties p on p.id = d.property_id
                 where p.owner_id = :subjectId
                   and (d.counterparty_id is null or d.counterparty_id <> :subjectId)
                 order by d.created_at desc
                """,
                withheld(
                        "counterparty_mobile", "The other party's phone number, denormalised onto "
                                + "the deal. The line that does not move: a closed deal is the "
                                + "single most valuable row on this platform to a broker who wants "
                                + "a list of people who are buying.",
                        "counterparty_id", "Replaced by partyRef.")));

        out.add(new Dataset("agreements", "deal_parties",
                "Your own party record on a deal, matched by your phone number. Other parties on "
                        + "the same deals are not listed.",
                """
                select dp.id, dp.deal_id, dp.name, dp.mobile, dp.note, dp.created_at, dp.updated_at
                  from deal_parties dp
                 where dp.mobile = :subjectMobile
                   and dp.deleted_at is null
                 order by dp.created_at desc
                """,
                withheld("every other party row", "deal_parties carries a denormalised name and "
                        + "mobile per party and no user id, so the only reliable way to tell your "
                        + "row from the other side's is to match your number. Rows that are not "
                        + "yours are not returned at all rather than returned redacted, because a "
                        + "redacted row here would consist of nothing but a note somebody else "
                        + "wrote.")));

        out.add(new Dataset("agreements", "tenancies",
                "Tenancies you are part of, as tenant or as owner.",
                """
                select id, property_id, rent, deposit, start_date, end_date, status,
                       created_at, updated_at,
                       case when tenant_id = :subjectId then 'tenant' else 'owner' end
                           as subject_role,
                       case when tenant_id = :subjectId then owner_id else tenant_id end
                           as party_ref_src
                  from tenancies
                 where tenant_id = :subjectId or owner_id = :subjectId
                 order by created_at desc
                """,
                withheld("tenant_id / owner_id", "Whichever is not you is replaced by partyRef.")));

        out.add(new Dataset("agreements", "tenancy_declarations",
                "Claims that somebody lived at a property, where you declared or were the owner.",
                """
                select id, property_id, status, lived_from, lived_to, decided_at,
                       created_at, updated_at,
                       case when declarant_id = :subjectId then 'declarant' else 'owner' end
                           as subject_role,
                       case when declarant_id = :subjectId then owner_id else declarant_id end
                           as party_ref_src
                  from tenancy_declarations
                 where declarant_id = :subjectId or owner_id = :subjectId
                 order by created_at desc
                """,
                withheld("declarant_id / owner_id", "Whichever is not you is replaced by "
                        + "partyRef.")));

        out.add(new Dataset("agreements", "rent_agreements_as_owner",
                "Rent agreements on your properties.",
                """
                select id, property_id, rent, deposit, start_date, duration_months, status,
                       document_url, created_at, updated_at
                  from rent_agreements
                 where owner_id = :subjectId
                 order by created_at desc
                """,
                withheld("tenant_mobile", "Your tenant's phone number. Retained by the platform "
                        + "under the Limitation Act as evidence of the tenancy — which is a reason "
                        + "to keep it, never a reason to hand it to the other side of the "
                        + "agreement.")));

        out.add(new Dataset("agreements", "rent_agreements_as_tenant",
                "Rent agreements where the tenant's number is yours.",
                """
                select id, property_id, tenant_mobile, rent, deposit, start_date, duration_months,
                       status, document_url, created_at, updated_at,
                       owner_id as party_ref_src
                  from rent_agreements
                 where tenant_mobile = :subjectMobile
                 order by created_at desc
                """,
                withheld("owner_id", "Replaced by partyRef.")));
    }

    // --- messaging --------------------------------------------------------------------------

    private static void messaging(List<Dataset> out) {
        out.add(new Dataset("messaging", "conversations",
                "Chat threads you are in.",
                """
                select id, property_id, last_message, created_at, updated_at,
                       case when user_a_id = :subjectId then user_b_id else user_a_id end
                           as party_ref_src
                  from conversations
                 where user_a_id = :subjectId or user_b_id = :subjectId
                 order by updated_at desc
                """,
                withheld("user_a_id / user_b_id", "Whichever is not you is replaced by partyRef.")));

        out.add(new Dataset("messaging", "messages",
                "Every message in those threads, yours and theirs. partyRef is 'self' on the ones "
                        + "you wrote.",
                """
                select m.id, m.conversation_id, m.author_role, m.body, m.attachments, m.read,
                       m.created_at, m.author_id as party_ref_src
                  from messages m
                  join conversations c on c.id = m.conversation_id
                 where c.user_a_id = :subjectId or c.user_b_id = :subjectId
                 order by m.created_at desc
                """,
                withheld("author_id", "Replaced by partyRef. The bodies of the other side's "
                        + "messages are included: this is your correspondence, you are reading it "
                        + "in the product today, and an export that returned only your half would "
                        + "be a worse record than the inbox it came from.")));

        out.add(new Dataset("messaging", "message_attachments",
                "Files you attached to a chat or support thread.",
                """
                select id, surface, thread_id, message_id, content_type, size_bytes, file_name,
                       created_at
                  from message_attachments
                 where uploaded_by = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "storage_key", "See personal_documents.storage_key.",
                        "attachments uploaded by the other party", "Scoped to your own uploads "
                                + "rather than to the whole thread. The file name is the other "
                                + "side's contribution and can carry their name; the message it "
                                + "hangs off is already exported.")));

        out.add(new Dataset("messaging", "outbound_message",
                "Messages the platform prepared to send you on WhatsApp or SMS.",
                """
                select id, channel, template_id, subject_type, subject_id, recipient_mobile,
                       body, status, prepared_at, sent_at, failure_reason
                  from outbound_message
                 where recipient_id = :subjectId
                 order by prepared_at desc
                """,
                withheld("prepared_by", "Identifies the staff member who queued the message.")));

        out.add(new Dataset("messaging", "notifications",
                "In-app notifications sent to you.",
                """
                select id, type, title, body, read, link, created_at, deliver_after
                  from notifications
                 where user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));
    }

    // --- support and services -----------------------------------------------------------------

    private static void support(List<Dataset> out) {
        out.add(new Dataset("support", "service_requests",
                "Services you asked us to arrange — rent agreements, painting, packers and so on.",
                """
                select id, type, status, property_id, details, amount, payment_ref, team,
                       ticket_id, created_at, updated_at
                  from service_requests
                 where requester_id = :subjectId
                 order by created_at desc
                """,
                withheld("assignee_id", "Identifies the staff member handling the request.")));

        out.add(new Dataset("support", "service_request_parties",
                "Service requests you were named on, and in what role.",
                """
                select p.id, p.request_id, p.role, p.status, p.created_at, p.updated_at,
                       p.invited_by as party_ref_src
                  from service_request_parties p
                 where p.user_id = :subjectId
                 order by p.created_at desc
                """,
                withheld(
                        "invited_by", "Replaced by partyRef.",
                        "the other parties on the same request", "Scoped to your own party rows. "
                                + "The other side of a rent agreement is another data principal.")));

        out.add(new Dataset("support", "service_request_messages",
                "Messages on service requests you raised.",
                """
                select m.id, m.request_id, m.author_role, m.body, m.created_at, m.read_at,
                       m.author_id as party_ref_src
                  from service_request_messages m
                  join service_requests r on r.id = m.request_id
                 where r.requester_id = :subjectId
                 order by m.created_at desc
                """,
                withheld("author_id", "Replaced by partyRef.")));

        out.add(new Dataset("support", "service_request_timeline",
                "What happened, and when, on service requests you raised.",
                """
                select t.id, t.request_id, t.at, t.event, t."by" as party_ref_src
                  from service_request_timeline t
                  join service_requests r on r.id = t.request_id
                 where r.requester_id = :subjectId
                 order by t.at desc
                """,
                withheld("by", "Replaced by partyRef; see offer_history.by.")));

        out.add(new Dataset("support", "service_orders",
                "Services you ordered from the catalogue.",
                """
                select id, offering_id, property_id, status, amount, scheduled_for, notes,
                       created_at, updated_at
                  from service_orders
                 where user_id = :subjectId
                 order by created_at desc
                """,
                withheld("idempotency_key", "See boosts.idempotency_key.")));

        out.add(new Dataset("support", "support_tickets",
                "Support conversations you opened.",
                """
                select id, subject, category, status, created_at, updated_at
                  from support_tickets
                 where user_id = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("support", "support_ticket_messages",
                "Messages on your support tickets, including our replies.",
                """
                select m.id, m.ticket_id, m.author_role, m.body, m.attachments, m.created_at,
                       m.author_id as party_ref_src
                  from support_ticket_messages m
                  join support_tickets t on t.id = m.ticket_id
                 where t.user_id = :subjectId
                 order by m.created_at desc
                """,
                withheld("author_id", "Replaced by partyRef. Where the author was a staff member "
                        + "the role is still returned, so you can tell our replies from your own; "
                        + "which employee wrote it is not.")));

        out.add(new Dataset("support", "tickets",
                "Ops tickets raised about something you asked for, matched by your account or your "
                        + "phone number.",
                """
                select id, subject, team, priority, status, property_id, service, customer,
                       mobile, value, quoted_value, detail, created_at, updated_at
                  from tickets
                 where requester_id = :subjectId or mobile = :subjectMobile
                 order by created_at desc
                """,
                withheld("assignee_id", "Identifies the staff member handling the ticket.")));

        out.add(new Dataset("support", "society_leads",
                "Enquiries you submitted about getting your building onto the platform.",
                """
                select id, society_name, contact_name, mobile, units, interest, status,
                       created_at, updated_at
                  from society_leads
                 where mobile = :subjectMobile
                 order by created_at desc
                """,
                withheld("note", "Staff free text about how the lead is being worked.")));

        out.add(new Dataset("support", "city_waitlist",
                "Requests you made for us to launch in a city, matched by your phone number. These "
                        + "rows are written by a signed-out form and carry no account id, so this is "
                        + "the only way to find them.",
                """
                select id, mobile, city, email, created_at
                  from city_waitlist
                 where mobile = :subjectMobile
                 order by created_at desc
                """,
                Map.of()));
    }

    // --- community --------------------------------------------------------------------------

    private static void community(List<Dataset> out) {
        // target_id is polymorphic: a property, locality or society id for most reviews, and a
        // *person's* id when target_type = 'owner'. Selecting it raw would have handed back the
        // reviewed person's primary key — the one identifier the whole redaction rule exists to keep
        // out — through a column whose name gives no hint that it sometimes holds one. So it is
        // split: the personal case is routed through party_ref_src like every other counterparty
        // reference, and the impersonal case keeps the real id, which the subject needs in order to
        // know which flat they were writing about. Neither is populated at the same time as the
        // other.
        //
        // The discriminator is 'owner', not 'user'. Worth stating because the neighbouring `reports`
        // table spells the same concept 'user', and the first draft of this file used that value in
        // both places — which compiles, runs, returns rows and redacts nothing, because a CASE whose
        // condition is never true simply passes the id through. Only the check constraint in V7
        // distinguishes them, so any change here should be read against the migration rather than
        // against the sibling dataset below.
        out.add(new Dataset("community", "reviews_written",
                "Reviews you wrote. Where you reviewed a person rather than a place, their id is "
                        + "replaced by the same reference used everywhere else in this document.",
                """
                select id, target_type,
                       case when target_type = 'owner' then null else target_id end as target_id,
                       case when target_type = 'owner' then target_id end as party_ref_src,
                       rating, title, body, status, context, categories, recommend,
                       created_at, updated_at
                  from reviews
                 where author_id = :subjectId
                 order by created_at desc
                """,
                withheld("target_id (when the target is a person)",
                        "Replaced by partyRef. See the redaction rule.")));

        out.add(new Dataset("community", "reviews_about_me",
                "Reviews other people wrote about you. The product shows you the author's name; "
                        + "this document deliberately does not, because it is a machine-readable "
                        + "file that outlives the screen it was read on.",
                """
                select id, rating, title, body, status, context, categories, recommend,
                       created_at, updated_at, author_id as party_ref_src
                  from reviews
                 where target_type = 'owner' and target_id = :subjectIdText
                 order by created_at desc
                """,
                withheld("author_id", "Replaced by partyRef.")));

        out.add(new Dataset("community", "flatmate_reviews",
                "Moderation reviews of flatmate listings you host, and their outcome.",
                """
                select id, kind, room_id, group_id, address, tier, owner_consent, status,
                       created_at, updated_at
                  from flatmate_reviews
                 where host_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "reason", "Staff free text explaining a moderation decision.",
                        "decided_by", "Identifies the staff member who decided it.",
                        "flag_for_review", "An internal triage flag rather than an outcome; status "
                                + "is the decision you are entitled to.")));

        // Split for the same reason as reviews_written, and the rule is applied here even though
        // the subject obviously already knows who they reported. Uniformity is the point: the moment
        // the redaction has an "unless they already know" branch, every future dataset has to be
        // argued individually, and one of those arguments will eventually be wrong. It also matters
        // that "already knows the person" is not the same as "should be handed their primary key in
        // a file" — the id is a durable global identifier the product never shows, and it is exactly
        // what would let two exports be joined together.
        out.add(new Dataset("community", "reports_filed",
                "Reports you filed about a listing or another user. Where you reported a person, "
                        + "their id is replaced by a reference.",
                """
                select id, target_type,
                       case when target_type = 'user' then null else target_id end as target_id,
                       case when target_type = 'user' then target_id end as party_ref_src,
                       reason, details, status, created_at, updated_at
                  from reports
                 where reporter_id = :subjectId
                 order by created_at desc
                """,
                withheld("target_id (when the target is a person)",
                        "Replaced by partyRef. See the redaction rule.")));
    }

    // --- flatmate ---------------------------------------------------------------------------

    private static void flatmate(List<Dataset> out) {
        out.add(new Dataset("flatmate", "flatmate_rooms",
                "Rooms you listed.",
                """
                select id, property_id, room_kind, room_type, attached_bath, price_basis, budget,
                       deposit, occupants, max_occupants, seats_total, seats_open, host_role,
                       verification_tier, verified, agreement_declared, society_id, society,
                       flat_number, locality, localities, lat, lng, bhk, flat_type,
                       home_type_label, gated_community, furnishing, move_in, available_from,
                       gender, food, tags, note, photos, status, archived, archived_at,
                       created_at, updated_at
                  from flatmate_rooms
                 where host_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "address_fingerprint", "An irreversible hash of the flat's address, held to "
                                + "spot the same flat listed twice. The address itself is on the "
                                + "listing; the hash is a detection artefact.",
                        "mod_status", "Internal moderation state.",
                        "flag_for_review", "An internal triage flag.",
                        "archive_reason", "Staff free text.")));

        out.add(new Dataset("flatmate", "flatmate_groups",
                "Flatmate groups you host.",
                """
                select id, title, locality, policy, rent, seats_total, seats_open, property_id,
                       host_role, verification_tier, agreement_declared, owner_consent, tags,
                       note, archived, archived_at, created_at, updated_at
                  from flatmate_groups
                 where host_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "owner_consent_mobile", "The flat owner's phone number, captured as "
                                + "evidence that they consented to the group. It belongs to a third "
                                + "party who is very often not a user of this platform at all and "
                                + "therefore has no way to object to it being handed out.",
                        "address_fingerprint", "See flatmate_rooms.address_fingerprint.",
                        "mod_status", "Internal moderation state.",
                        "flag_for_review", "An internal triage flag.",
                        "archive_reason", "Staff free text.")));

        out.add(new Dataset("flatmate", "flatmate_group_memberships",
                "Groups you are a member of, and the name shown to the rest of the group.",
                """
                select id, group_id, name, initials, verified, created_at, updated_at
                  from flatmate_group_members
                 where user_id = :subjectId
                 order by created_at desc
                """,
                withheld("your co-members", "Only your own membership rows are returned. Every "
                        + "other row in a group you host carries another person's name.")));

        out.add(new Dataset("flatmate", "flatmate_group_applications",
                "Applications you made to join a group.",
                """
                select a.id, a.listing_id, a.group_id, a.status, a.note, a.decided_at,
                       a.created_at, a.updated_at
                  from flatmate_group_applications a
                 where a.applicant_id = :subjectId
                 order by a.created_at desc
                """,
                withheld("mod_status", "Internal moderation state.")));

        out.add(new Dataset("flatmate", "flatmate_requests",
                "Interest you expressed in a room or group, and interest others expressed in yours.",
                """
                select id, kind, target_id, action, share, message, status, requested_at,
                       decided_at, created_at, updated_at,
                       case when requester_id = :subjectId then 'requester' else 'host' end
                           as subject_role,
                       case when requester_id = :subjectId then host_id else requester_id end
                           as party_ref_src
                  from flatmate_requests
                 where requester_id = :subjectId or host_id = :subjectId
                 order by requested_at desc
                """,
                withheld("requester_id / host_id", "Whichever is not you is replaced by partyRef.")));

        out.add(new Dataset("flatmate", "flatmate_seeker_posts",
                "Posts you made looking for a flat or a flatmate.",
                """
                select id, name, gender, age, occupation, budget, localities, move_in, move_in_at,
                       flat_pref, room_pref, tags, note, verified_contact_only, verified, lat,
                       lng, archived, archived_at, created_at, updated_at
                  from flatmate_seeker_posts
                 where user_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "mod_status", "Internal moderation state.",
                        "archive_reason", "Staff free text.")));

        out.add(new Dataset("flatmate", "flatmate_owner_consents",
                "Consents you granted as a flat owner for a flatmate group to operate.",
                """
                select id, owner_mobile, group_id, granted_at, created_at, updated_at
                  from flatmate_owner_consents
                 where granted_by = :subjectId
                 order by created_at desc
                """,
                Map.of()));

        out.add(new Dataset("flatmate", "referrals_made",
                "People you referred. Their name is included because the referrals screen already "
                        + "shows it to you; their phone number is not, because that screen masks it.",
                """
                select id, referred, channel, reward, reward_amount, status, risk,
                       aadhaar_verified, aadhaar_unique, same_device, same_ip, velocity_high,
                       activated, at, qualified_at, qualified_property_id, share_channel,
                       referrer_mobile, created_at, updated_at
                  from referrals
                 where referrer_id = :subjectId
                 order by created_at desc
                """,
                withheld(
                        "referred_mobile", "The referred person's phone number. The product masks "
                                + "it on screen; an export that unmasked it would be a way to turn "
                                + "a referral link into a contact list.",
                        "referred_ip_hash / referred_device_hash", "Salted digests of the address "
                                + "and browser the referral was redeemed from, held only to detect "
                                + "referral fraud and cleared automatically after ninety days. They "
                                + "describe the person you referred, not you.",
                        "handled_by / handled_reason", "Which staff member reviewed a flagged "
                                + "referral, and their note.")));

        out.add(new Dataset("flatmate", "referrals_received",
                "The referral you joined under, matched by your phone number.",
                """
                select id, referred, referred_mobile, channel, reward, status, activated, at,
                       created_at, updated_at, referrer_id as party_ref_src
                  from referrals
                 where referred_mobile = :subjectMobile
                 order by created_at desc
                """,
                withheld(
                        "referrer_mobile", "The referrer's phone number.",
                        "referrer_id", "Replaced by partyRef.",
                        "risk, same_device, same_ip, velocity_high, handled_by",
                        "Fraud-detection signals and the staff review of them. Returning a "
                                + "would-be fraudster the exact list of signals that caught them is "
                                + "how a detection system gets tuned against itself.")));

        out.add(new Dataset("flatmate", "referral_codes",
                "Your own referral code.",
                """
                select code, created_at, updated_at
                  from referral_codes
                 where user_id = :subjectId
                """,
                withheld("referrer_ip_hash / referrer_device_hash", "Salted digests of the address "
                        + "and browser your code was minted from. Irreversible, cleared "
                        + "automatically after ninety days, and readable by nobody including you — "
                        + "returning them would create a correlation token and disclose nothing.")));
    }

    // ------------------------------------------------------------------ the exclusions

    /**
     * <strong>Whole tables holding data about the subject that this export does not return.</strong>
     *
     * <p>Serialised into every response, for the same reason {@link
     * com.draazy.api.identity.user.erasure.ErasureRetention#knownGaps()} is serialised into every
     * erasure record: a document that quietly omits a category is worse than one that names it. The
     * subject is told what we hold and can then ask about it specifically; a silent omission leaves
     * them believing this is everything.
     *
     * <p>Three of these are the interesting ones and the rest are bookkeeping. {@code reports} about
     * the subject and {@code service_request_identities} are excluded because <em>no</em> redaction
     * of them is safe — see their reasons. {@code audit_log} is excluded because it is a record of
     * what staff did, indexed by the subject rather than about them.
     */
    static List<Exclusion> exclusions() {
        return List.of(
                new Exclusion("reports_about_me",
                        "Reports other users filed about you. Excluded entirely, including the "
                                + "partyRef that every other two-party dataset here carries: the "
                                + "reporting queue already withholds reporter identity, and a "
                                + "reference that is stable across this export would undo that in "
                                + "one step — you could match the ref on the report against the ref "
                                + "on a chat thread and learn who reported you. A safety report has "
                                + "to survive being read by its subject, and the only version that "
                                + "does is one that is not returned at all."),
                new Exclusion("service_request_identities",
                        "The PAN and Aadhaar numbers collected from every party to a rent-agreement "
                                + "draft. Excluded because the table has no user id: it keys on the "
                                + "request and a party index, so there is no reliable way to tell "
                                + "your row from your landlord's. Returning the request's rows "
                                + "would hand one party the other's unmasked government "
                                + "identifiers, and no amount of redaction fixes a row whose entire "
                                + "content is the identifier. Your own copies are in owner_kyc and "
                                + "identity_verifications, masked, and this table purges itself "
                                + "after the agreement is drafted."),
                new Exclusion("audit_log",
                        "The record of privileged actions taken on the platform. Rows naming you "
                                + "record what a staff member did, identified by their staff id — "
                                + "so the personal data in them is theirs, and the table is "
                                + "append-only accountability rather than a profile of you. The "
                                + "outcomes it records reach you through the tables above."),
                new Exclusion("internal_notes",
                        "Notes staff wrote about a listing, a ticket or an account while working "
                                + "it. Staff free text; see the staff rule."),
                new Exclusion("ticket_notes", "As internal_notes, on ops tickets."),
                new Exclusion("property_reviews / property_review_checklist",
                        "Our internal moderation review of a listing, item by item, with the "
                                + "reviewer named. The decision reaches you as the listing's "
                                + "status."),
                new Exclusion("review_messages",
                        "The moderation thread behind a listing review, which mixes staff-only "
                                + "notes with messages to you. It carries an `internal` flag, and "
                                + "an export that had to get one boolean right to avoid disclosing "
                                + "staff deliberation is an export one migration away from getting "
                                + "it wrong."),
                new Exclusion("staff_invites / staff_account_approvals",
                        "The paperwork behind a staff account, naming the administrator who "
                                + "invited and approved it."),
                new Exclusion("page_view_daily and its path/referrer rollups",
                        "Daily traffic totals. They carry no user id, no session id and no path "
                                + "attributable to a person — they are what the raw page_views "
                                + "rows are counted into before deletion. There is nothing in them "
                                + "that is about you rather than about the site."),
                new Exclusion("reference and catalogue tables",
                        "cities, localities, societies, plans, boost_packs, service_offerings, "
                                + "cms_services, faqs, banners, announcements, reels, "
                                + "message_template, platform_fees and settings. Reference data "
                                + "with no data subject behind it, identical for every user."),
                new Exclusion("other people's rows",
                        "Members of groups you host, parties to your deals and service requests, "
                                + "and the second side of every conversation. The record is "
                                + "returned; the other person is a reference. This is DPDP s.11(2) "
                                + "and it is the whole design of this endpoint."));
    }

    // ------------------------------------------------------------------ accessors and plumbing

    static List<Dataset> all() {
        return DATASETS;
    }

    /**
     * The redaction rule, in the response, in the subject's own document.
     *
     * <p>Not decoration. Two of the datasets return a record with the other side removed, and a
     * reader who does not know that is entitled to conclude the platform holds nothing more. Saying
     * so in the payload rather than only in the API documentation means the statement travels with
     * the data to whoever the subject sends it to.
     */
    static String redactionRule() {
        return "Records you share with somebody else are included in full — that they happened, "
                + "when, their status, the money, the property — together with everything you "
                + "wrote, and everything the other person wrote that the product already shows "
                + "you. The other person themselves appears only as `partyRef`: a reference that "
                + "is stable across your own export, so you can tell that the same person appears "
                + "on several records, and meaningless to anybody else, because it is derived "
                + "from your account id. Their phone number, email, address, government "
                + "identifiers, documents and verification state are never included, in any "
                + "dataset. Where a value is `self`, that row was yours. This follows DPDP Act "
                + "2023 s.11(2): your right of access does not extend to revealing the identity "
                + "of another data principal.";
    }

    /**
     * Ordered map literal, because {@link Map#of} is not.
     *
     * <p>The withheld list is read by a person deciding whether to complain about what is missing,
     * and a list that shuffles between two calls is a list nobody can diff.
     */
    private static Map<String, String> withheld(String... pairs) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put(pairs[i], pairs[i + 1]);
        }
        // Not Map.copyOf: its iteration order is deliberately unspecified, which would defeat the
        // point of building the map in a LinkedHashMap in the first place.
        return Collections.unmodifiableMap(map);
    }
}
