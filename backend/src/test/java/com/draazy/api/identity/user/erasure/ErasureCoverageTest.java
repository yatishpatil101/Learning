package com.draazy.api.identity.user.erasure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Reads information_schema so a new table with a mobile number in it cannot arrive unnoticed.
// Rules and decisions: compliance doc §11.
@DisplayName("DPDP erasure — every personal-data column in the schema is classified and accounted for")
class ErasureCoverageTest extends AbstractApiTest {


    // Matched as bare substrings on purpose — the derivation must over-match, never under-match.
    private static final List<String> IDENTIFIER_TOKENS = List.of(
            // direct identifiers and contact routes
            "mobile", "phone", "whatsapp", "email", "name", "holder", "contact",
            // government and financial identity
            "aadhaar", "passport", "ifsc", "upi", "account", "kyc",
            // a meter number names a live connection, and matches none of the tokens above
            "meter",
            // where a person is
            "address", "pincode", "latitude", "longitude",
            // facts about a person
            "birth", "gender", "occupation", "occupant", "income", "salary",
            // likeness and device
            "avatar", "photo", "selfie", "device");

    // Matched on underscore boundaries: a bare contains("ip") hits `description` and `script`,
    // transcribing the whole schema into the maps below.
    private static final List<String> BOUNDED_TOKENS = List.of("pan", "gst", "ip", "age", "lat", "lng", "dob");


    /** How a column stops carrying personal data. */
    private enum Outcome {
        /** Reads back {@code null}, or {@code false} for a NOT NULL boolean. */
        CLEARED,
        /** Still present, but carrying a value the subject never supplied — {@code users.mobile}. */
        REPLACED,
        /** The whole row goes; the column is named so a reviewer can see what went with it. */
        ROW_REMOVED,
        // The row stays and its link to the subject is nulled — page_views.user_id. Distinct from
        // both neighbours; see docs/system/legal-entity-and-compliance.md §11.
        DETACHED
    }

    // Columns ErasureService#execute clears, and how. Every entry is proved by
    // everyErasedColumnIsActuallyCleared() seeding a value and reading it back.
    private static final Map<String, Outcome> ERASED = erased();

    private static Map<String, Outcome> erased() {
        Map<String, Outcome> map = new LinkedHashMap<>();

        // The identity root. `mobile` is NOT NULL UNIQUE with a format CHECK, so it is substituted.
        map.put("users.name", Outcome.CLEARED);
        map.put("users.email", Outcome.CLEARED);
        map.put("users.avatar", Outcome.CLEARED);
        map.put("users.city", Outcome.CLEARED);
        map.put("users.password_hash", Outcome.CLEARED);
        map.put("users.mobile_verified", Outcome.CLEARED);
        map.put("users.verified", Outcome.CLEARED);
        map.put("users.last_active", Outcome.CLEARED);
        map.put("users.mobile", Outcome.REPLACED);

        // Auth credentials: deleted outright, because a blanked row still says "this person signed
        // in on this date".
        map.put("otp_codes.mobile", Outcome.ROW_REMOVED);
        // A consent code (V33) is addressed to the flat owner, so the subject's own row is unreachable
        // from `mobile` and would outlive the sweep that deletes its siblings.
        map.put("otp_codes.requested_by", Outcome.ROW_REMOVED);
        map.put("refresh_tokens.token_hash", Outcome.ROW_REMOVED);

        // Whole row: the rest of it — landlord's name, rent, lease window — identifies one tenancy,
        // so half-erasing leaves the more revealing half. Third-party limits: §11 of the compliance doc.
        map.put("tenant_rentals.address", Outcome.ROW_REMOVED);
        map.put("tenant_rentals.landlord_name", Outcome.ROW_REMOVED);

        // Whole row, because `body` holds the rendered message naming them in free text — the
        // matched column is not the difficult one.
        map.put("outbound_message.recipient_mobile", Outcome.ROW_REMOVED);

        // Whole row: `identity_hash` is the dedup key that lets the platform recognise the person
        // on return; the object-storage ID photos cascade with it.
        map.put("identity_verifications.claimed_name", Outcome.ROW_REMOVED);
        map.put("identity_verifications.claimed_dob", Outcome.ROW_REMOVED);
        map.put("identity_verifications.holder_name", Outcome.ROW_REMOVED);
        map.put("identity_verifications.holder_dob", Outcome.ROW_REMOVED);
        map.put("identity_verifications.identity_hash", Outcome.ROW_REMOVED);
        map.put("identity_verifications.claimed_hash", Outcome.ROW_REMOVED);
        map.put("identity_verifications.person_key", Outcome.ROW_REMOVED);
        map.put("identity_verifications.doc_last4", Outcome.ROW_REMOVED);
        map.put("identity_verifications.claimed_number_last4", Outcome.ROW_REMOVED);
        map.put("owner_kyc.pan_masked", Outcome.CLEARED);
        map.put("owner_kyc.aadhaar_masked", Outcome.CLEARED);

        // Free text the subject wrote about themselves.
        map.put("tenant_profiles.name", Outcome.CLEARED);
        map.put("tenant_profiles.occupation", Outcome.CLEARED);
        map.put("tenant_profiles.income", Outcome.CLEARED);
        map.put("tenant_profiles.occupants", Outcome.CLEARED);
        map.put("tenant_profiles.move_in", Outcome.CLEARED);
        map.put("tenant_profiles.prior_landlord", Outcome.CLEARED);

        map.put("tenant_profiles.about", Outcome.CLEARED);

        // Swept but the row is kept: a claim is a shared fact about a building. `name` is NOT NULL,
        // hence REPLACED. Why it is not left to `users`: compliance doc §11.
        map.put("society_claims.name", Outcome.REPLACED);
        map.put("society_claims.email", Outcome.CLEARED);

        // Government numbers collected for a rent-agreement draft (V47).
        map.put("service_request_identities.party_name", Outcome.CLEARED);
        map.put("service_request_identities.pan", Outcome.CLEARED);
        map.put("service_request_identities.aadhaar", Outcome.CLEARED);

        // A pending row carries the mobile in place of a user id under a CHECK that exactly one is
        // set, so the schema leaves no third option.
        map.put("service_request_parties.mobile", Outcome.ROW_REMOVED);

        // Listed though the vocabulary does not match `user_id`. DETACHED because the view is
        // already in a daily aggregate naming nobody, so deleting it would falsify traffic history.
        map.put("page_views.user_id", Outcome.DETACHED);

        // Neither token matches the vocabulary, which is why the sweep misses this table. The whole
        // row goes: "what was missing?" collects phone numbers, so nulling user_id leaves those.
        map.put("help_article_feedback.user_id", Outcome.ROW_REMOVED);
        map.put("help_article_feedback.comment", Outcome.ROW_REMOVED);

        return map;
    }

    // Columns the vocabulary matched that are kept. The text says which reason applies: not a
    // natural person (the common case), or a statute requires keeping it.
    private static final Map<String, String> RETAINED = retained();

    private static Map<String, String> retained() {
        Map<String, String> map = new LinkedHashMap<>();

        // --- statutory retention: personal, kept anyway, on another law's authority -------------
        map.put("rent_agreements.tenant_mobile",
                "Evidence of a contract with somebody else. Limitation Act 1963 art.113 leaves three "
                        + "years in which either party may sue on it, and erasing the tenant would "
                        + "destroy the landlord's proof of the tenancy at the moment a dispute makes "
                        + "it matter. See ErasureRetention#retainedWithReasons, 'rent_agreements'.");

        // These three ARE the document: a receipt not saying who paid whom for which address proves
        // nothing. The asymmetry (the landlord erases, the tenant's claim dies): compliance doc §11.
        map.put("managed_property_rent_receipts.landlord_name",
                "Identifies the payee on a tax document. Income-tax Act 1961 s.10(13A) with Rule 2A; "
                        + "reopenable under s.149. See ErasureRetention#retainedWithReasons, "
                        + "'rent_receipts'.");
        map.put("managed_property_rent_receipts.tenant_name",
                "Identifies the payer on a tax document, and is the person whose HRA claim the "
                        + "receipt substantiates. Income-tax Act 1961 s.10(13A) with Rule 2A. See "
                        + "ErasureRetention#retainedWithReasons, 'rent_receipts'.");
        map.put("managed_property_rent_receipts.property_address",
                "Identifies the tenancy the payment was for. Rule 2A computes the exemption from "
                        + "rent paid for a specific residence, so a receipt without the address does "
                        + "not support the claim it exists to support. See "
                        + "ErasureRetention#retainedWithReasons, 'rent_receipts'.");

        // --- reference and catalogue data: a name, but not a person's -------------------------
        map.put("cities.name", "The name of a city. Reference data with no data subject behind it.");
        map.put("localities.name",
                "The name of a locality, shared by every listing in it. Reference data with no data "
                        + "subject behind it.");
        map.put("localities.lat", "Centroid of a locality, used to seed map views.");
        map.put("localities.lng", "Centroid of a locality, used to seed map views.");
        map.put("societies.name", "A building. Reference data, and not deleted when a resident is.");
        map.put("societies.lat", "Coordinates of a building, not of a person.");
        map.put("societies.lng", "Coordinates of a building, not of a person.");

        // Unlike a society, a group is created by a member — but it outlives them, so erasing one
        // person must not move a flat off the map for everyone still living in it.
        map.put("flatmate_groups.lat", "Coordinates of the flat a group shares, not of a member.");
        map.put("flatmate_groups.lng", "Coordinates of the flat a group shares, not of a member.");
        map.put("society_leads.society_name",
                "The building the lead is about. The person on the lead is a gap (see GAPS); the "
                        + "building is not personal data.");
        map.put("boost_packs.name", "A product name in the paid-promotion catalogue.");
        map.put("message_template.name",
                "The name of a piece of outreach copy, shown to staff in a picker (D216). Catalogue "
                        + "copy: identical for every owner it is ever sent to, and written by this "
                        + "platform rather than supplied by anybody. The messages actually prepared "
                        + "from it are personal and are deleted \u2014 see outbound_message.");
        map.put("cms_services.name", "A CMS content row. Editorial copy, not a person.");
        map.put("service_offerings.name",
                "The name of a service the platform sells. Catalogue copy, identical for every "
                        + "customer who buys it.");
        map.put("plans.name",
                "The name of a subscription plan. Catalogue copy; the subscription that points at "
                        + "it de-identifies with the users row.");
        map.put("plans.contact_limit",
                "A number of contact reveals a plan allows. Matched on 'contact'; it is a quota, not "
                        + "a contact detail.");
        map.put("plans.unlimited_contacts",
                "Whether a plan lifts the contact ceiling entirely (V91). Matched on 'contact'; it "
                        + "is a flag on a catalogue row, identical for every subscriber to that "
                        + "plan, and says nothing about any of them.");
        map.put("platform_fees.gst",
                "A tax rate on the platform's own fee schedule. Matched on 'gst'; it is a rate, not "
                        + "a GSTIN.");

        // --- listing attributes: about a property, retained with the property -------------------
        map.put("properties.address",
                "The address of a listing, which is the listing's whole point. Listings are retained "
                        + "(ErasureRetention, 'listings_and_property_records') and de-identify via "
                        + "the owner reference.");
        map.put("properties.lat", "Listing coordinates. Retained with the listing.");
        map.put("properties.address_key",
                "A normalised, token-sorted form of properties.address, derived from it and kept "
                        + "only so the duplicate probe can compare two doorways (D218). It is "
                        + "retained for exactly the reason the address it comes from is, and it "
                        + "cannot outlive it: nothing writes address_key except the derivation, so "
                        + "clearing this while retaining address would be erasing a cache and not a "
                        + "fact -- the next edit to the listing would put it straight back. It also "
                        + "describes a building rather than a person; the only route from it to a "
                        + "natural person is properties.owner_id, which de-identifies with the "
                        + "users row like every other listing attribute here.");
        map.put("properties.lng", "Listing coordinates. Retained with the listing.");
        map.put("properties.pincode", "Listing pincode. Retained with the listing.");
        map.put("properties.age_years",
                "How old the building is, in years — a fact about a structure, not about a person. "
                        + "Caught only because the column vocabulary matches 'age' as a substring "
                        + "and cannot tell a building's age from a resident's. Retained with the "
                        + "listing, like every other physical attribute of the flat.");
        map.put("properties.electricity_meter_no",
                "The unit's MSEDCL meter number (V79), collected so the duplicate probe can tell "
                        + "one flat from the one next door -- it is the one signal on a listing "
                        + "that a second poster cannot fake by retyping the address. It names a "
                        + "utility connection rather than a person: the meter belongs to the flat "
                        + "and survives every tenancy and most sales, so it does not de-identify "
                        + "when the owner does. Retained with the listing for the same reason "
                        + "address and address_key are, and reachable only by the owner and by "
                        + "staff (PrivateFieldVisibility) -- it is never on a public response. "
                        + "Clearing it on erasure would blind the detector to exactly the listings "
                        + "most worth re-checking, while leaving the address it corroborates in "
                        + "place, which erases the evidence and keeps the claim.");
        map.put("properties.electricity_meter_key",
                "A normalised form of properties.electricity_meter_no (V115), derived from it and "
                        + "kept only so the duplicate probe can tell that 'MH-12-3456', 'mh123456' "
                        + "and 'MH 12 3456' are one meter rather than three. It stands to the meter "
                        + "number exactly as address_key stands to address, and is classified the "
                        + "same way for the same reasons: it describes a utility connection on a "
                        + "flat rather than a natural person, the only route from it to a natural "
                        + "person is properties.owner_id, and nothing writes it except the "
                        + "derivation -- so clearing it while retaining the meter number it comes "
                        + "from would be erasing a cache and not a fact, and the next edit to the "
                        + "listing would put it straight back. It is never on a public response: it "
                        + "is derived from a PrivateFieldVisibility field and is projected onto no "
                        + "DTO at all.");
        map.put("documents.file_name",
                "The name of a document attached to a property or a service request, both of which "
                        + "are retained. Stripping the file name from a retained document leaves an "
                        + "unidentifiable blob that nobody can produce in a dispute.");
        map.put("managed_property_documents.file_name",
                "As documents.file_name, for the private Owner Hub vault (V93). Papers hang off a "
                        + "property, never off a person: the property is the top of the hierarchy "
                        + "and there is no such thing as a document without one — which the schema "
                        + "enforces with ON DELETE CASCADE from managed_properties, so these rows "
                        + "cannot outlive the record they describe. Erasing the owner does not "
                        + "delete that record, and the file name is an attribute of it in the same "
                        + "way address and pincode are.");
        map.put("message_attachments.file_name",
                "The name of a file sent on a chat or support thread (D49). Retained for the same "
                        + "reason the message body it hangs off is: correspondence is evidence in a "
                        + "dispute between two people, and only one of them is erasing. Clearing it "
                        + "would leave the counterparty a thread referring to an attachment nobody "
                        + "can identify, which damages their record to no one's benefit -- the "
                        + "erasing user's identity is already gone from users, and a sanitised file "
                        + "name is not a way back to it.");
        map.put("flatmate_reviews.address",
                "The flat a flatmate review is about. A property attribute on a review that is "
                        + "retained under ErasureRetention, 'reviews_and_ratings'.");
        map.put("flatmate_rooms.address_fingerprint",
                "A hash used to spot the same flat listed twice. Irreversible, and keyed to a "
                        + "property rather than a person.");
        map.put("flatmate_groups.address_fingerprint",
                "As flatmate_rooms.address_fingerprint — a duplicate-detection hash of a flat.");
        map.put("flatmate_owner_consents.address_fingerprint",
                "As flatmate_rooms.address_fingerprint. V30 copied the same hash onto the consent "
                        + "row to scope it to the flat the owner was actually asked about; it names "
                        + "a property, and the person on that row is named by owner_mobile.");
        map.put("flatmate_rooms.photos", "Photographs of a room, on a listing that is retained.");
        map.put("flatmate_rooms.lat", "Coordinates of a room listing, retained with the listing.");
        map.put("flatmate_rooms.lng", "Coordinates of a room listing, retained with the listing.");
        map.put("flatmate_seeker_posts.lat",
                "The area the poster is searching in, not where they live. No identity on its own.");
        map.put("flatmate_seeker_posts.lng",
                "The area the poster is searching in, not where they live. No identity on its own.");

        // --- the society hub: a building's facts, and a neighbour's words about it ---------------
        map.put("society_proposals.lat",
                "A corrected pin for a society's front gate, proposed by a resident who walked to it "
                        + "(V104, D241 C4). The coordinates of a building, on the same limb as "
                        + "properties.lat: they say where a block of flats stands, which is a "
                        + "published fact about the block and not a fact about the person who "
                        + "reported it. The proposer de-identifies through author_id -> users.name, "
                        + "which erasure clears, and once ops apply the fix the pin is the "
                        + "society's own anyway.");
        map.put("society_proposals.lng", "As society_proposals.lat — the same pin, second half.");
        map.put("society_contributions.photo_url",
                "A photograph shared on a society's community tab — the lobby after the monsoon, the "
                        + "new gate, the garden (V103, D240 C3). Matched on the 'photo' token, which "
                        + "is warning about a likeness; this is a picture of a place, on a post whose "
                        + "byline is users.name and therefore goes anonymous with the account. Where "
                        + "a photograph does capture somebody who did not agree to it, the remedy is "
                        + "not this sweep — it is the moderation route added in D242 C6, which any "
                        + "reader can trigger with the 'personal' reason and which stamps removed_at "
                        + "on the post itself. Erasing the photographer would have left such a "
                        + "photograph up.");
        map.put("society_contributions.referral_name",
                "The name of a plumber, a maid or an electrician a neighbour recommends (V103, D240 "
                        + "C3). Personal data — and not the subject's. It describes a third party who "
                        + "never had an account, so erasing the neighbour who wrote it neither "
                        + "removes the tradesman's interest in it nor is the mechanism by which he "
                        + "would assert one. That mechanism is the report queue added in D242 C6: "
                        + "'personal' is a reason code that exists for exactly this row, and "
                        + "upholding it stamps removed_at on the recommendation. Sweeping it with "
                        + "the author instead would have made a tradesman's takedown depend on "
                        + "whoever happened to post about him closing their account.");
        map.put("society_contributions.referral_contact",
                "The tradesman's phone number on the same recommendation. As "
                        + "society_contributions.referral_name — a third party's contact detail, "
                        + "removable through the C6 report route and not through the account "
                        + "holder's erasure. It is already withheld from readers who are not signed "
                        + "in, which is the narrower protection the open web needs.");

        // --- preference and counter columns the vocabulary caught -------------------------------
        map.put("flatmate_rooms.gender",
                "A preference vocabulary — 'any' / 'male' / 'female', defaulting to 'any' (V27). Who "
                        + "the room is offered to, not the gender of a person on file.");
        map.put("flatmate_seeker_posts.gender",
                "The same preference vocabulary as flatmate_rooms.gender (V28 migrated pref_gender "
                        + "onto it), so it records who the poster will share with, not who they are.");
        map.put("flatmate_rooms.occupants",
                "How many people currently live in the flat. A count; it names none of them.");
        map.put("flatmate_rooms.max_occupants",
                "A capacity limit on a room listing. A count, on the flat rather than on a person.");
        map.put("saved_searches.name",
                "The label the subject gave a saved search ('2BHK Kothrud'). The search row itself "
                        + "de-identifies with the users row via user_id; the alert delivery number on "
                        + "the same table does not, and is a gap.");
        map.put("users.verified_contact_only",
                "An owner preference — accept contact requests only from L2-verified users. A "
                        + "boolean on a row that, post-erasure, names nobody.");
        map.put("flatmate_seeker_posts.verified_contact_only", "The same preference on a flatmate post.");
        map.put("notification_preferences.email",
                "Matched on the column name, but it is a boolean channel switch — 'may we reach you "
                        + "by email' — and not an email address. The address itself lives on "
                        + "users.email and is erased there. The whole row is keyed by user_id with "
                        + "ON DELETE CASCADE (V73), so it names nobody once the subject is gone.");
        map.put("notification_preferences.whatsapp",
                "The same boolean channel switch as notification_preferences.email. The number it "
                        + "would be delivered to is users.mobile, which is erased there; this column "
                        + "carries no number of its own.");

        // --- evidence behind a trust claim third parties relied on -------------------------------
        map.put("property_ownership_evidence.subject_name",
                "Whose government ID ops sighted when granting the Ownership Verified badge (D202, "
                        + "V66). Personal, and kept: the badge is a statement about title made to "
                        + "buyers who acted on it, and this column is the whole of what makes that "
                        + "statement checkable afterwards. Erasing it would not remove a claim from "
                        + "the platform, only the evidence for one that stays — leaving a listing "
                        + "still asserting verified ownership with nothing behind it, which is the "
                        + "shape a fraudulent listing most wants. Same limb as "
                        + "rent_agreements.tenant_mobile: evidence of a transaction with somebody "
                        + "else, retained for the period in which either side may dispute it. It "
                        + "does not accumulate silently — a row exists only where a staff member "
                        + "recorded a document, and the badge itself can be withdrawn.");

        // --- fraud signals: derived booleans, not the underlying identifiers ---------------------
        map.put("referrals.identity_verified",
                "A boolean recording that the referred account cleared identity verification. The "
                        + "document number itself is not here; this is the outcome.");
        map.put("referrals.identity_unique",
                "A boolean recording that the referred document had not been seen before. Same "
                        + "reasoning: an outcome, not an identifier.");
        map.put("referrals.same_device",
                "A fraud signal — referrer and referred shared a device fingerprint. A boolean; no "
                        + "fingerprint is stored on the row.");
        map.put("referrals.same_ip",
                "A fraud signal — referrer and referred shared an IP. A boolean; no address is "
                        + "stored on the row.");

        // --- page view telemetry (V96) -----------------------------------------------------------
        map.put("page_views.device",
                "A viewport bucket with exactly three values — mobile, tablet or desktop — derived "
                        + "in the browser from the window width. Deliberately not the User-Agent, "
                        + "which is what the vocabulary is really warning about: three buckets "
                        + "cannot single anybody out or contribute to a fingerprint. The row's link "
                        + "to a person is user_id, which erasure nulls.");
        map.put("page_view_daily.mobile_sessions",
                "A daily count of how many sessions were on a mobile viewport. An integer in an "
                        + "identity-free aggregate: page_view_daily has no user_id, no session_id "
                        + "and no path, and is what the raw rows are rolled into before they are "
                        + "deleted at ninety days. It is caught here only because the column vocab "
                        + "matches 'mobile' as a substring and cannot tell a phone number from a "
                        + "screen size. Erasing a subject cannot change a count that never named "
                        + "them.");

        return map;
    }

    // Personal data this pass does not reach. Not a parking bay: adding a column here obliges you
    // to name its table in the disclosure the subject reads.
    private static final Map<String, String> GAPS = gaps();

    private static Map<String, String> gaps() {
        Map<String, String> map = new LinkedHashMap<>();

        map.put("referrals.referrer_mobile",
                "A stored number rather than a reference, so it survives pseudonymisation of the "
                        + "users row.");
        map.put("referrals.referred_mobile", "As referrals.referrer_mobile.");
        map.put("referrals.referred_ip_hash",
                "Salted SHA-256 of the address the referee redeemed from (V64), held only to "
                        + "compute the same_ip fraud signal. Not swept on request: the row is "
                        + "reached by mobile rather than by user id, the same reason its two "
                        + "mobiles are gaps. It expires anyway — ReferralSignalRetentionSweep "
                        + "blanks it ninety days after the referral, so the exposure is bounded "
                        + "without an erasure request. Closing it properly means giving the sweep a "
                        + "way to reach this table at all, which is one change for all four of "
                        + "these columns and both mobiles above.");
        map.put("referrals.referred_device_hash", "As referrals.referred_ip_hash, for the "
                + "User-Agent behind same_device.");
        map.put("referral_codes.referrer_ip_hash",
                "The referrer's half of the same comparison, stamped when their code was minted "
                        + "(V64). Reachable by user id, unlike the referrals rows — listed as a gap "
                        + "rather than swept because a sweep that names a column wrongly fails "
                        + "halfway through the one operation that must not, and this table has "
                        + "never been in the sweep's UPDATE. Expires ninety days after capture "
                        + "regardless.");
        map.put("referral_codes.referrer_device_hash",
                "As referral_codes.referrer_ip_hash, for the User-Agent.");

        map.put("flatmate_group_members.name",
                "A NOT NULL denormalised copy of users.name, written at join time.");

        map.put("society_leads.contact_name",
                "Captured at intake, sometimes before an account existed, so it is not always "
                        + "reachable from a user id at all.");
        map.put("society_leads.mobile", "As society_leads.contact_name.");
        map.put("tickets.mobile", "Support intake contact — the same shape as society_leads.");

        map.put("deal_parties.name",
                "Denormalised party contact on a record that is itself retained. The record must "
                        + "survive; the duplicated contact details need not.");
        map.put("deal_parties.mobile", "As deal_parties.name.");

        // --- found by this test, and disclosed here rather than left silent ---
        map.put("deals.counterparty_mobile",
                "The same denormalised-number shape as deal_parties, on the deal row itself (V11). "
                        + "It sat outside the disclosure list until this test derived it from the "
                        + "schema.");
        map.put("city_waitlist.mobile",
                "Written by an unauthenticated endpoint (V3/V15), so the row carries no user id at "
                        + "all — nothing about erasing an account can reach it.");
        map.put("city_waitlist.email", "As city_waitlist.mobile.");
        map.put("saved_searches.mobile",
                "The number property alerts are delivered to. A stored number, not a reference.");
        map.put("managed_properties.tenant_name",
                "A third party's name typed in by the owner (V33). Erasing the owner does not touch "
                        + "it, and the tenant it names has no account here to erase from.");
        map.put("flatmate_groups.owner_consent_mobile",
                "The flat owner's number, captured as evidence of their consent (V27) — a third "
                        + "party's contact detail sitting on the subject's record.");
        map.put("flatmate_rooms.owner_consent_mobile",
                "As flatmate_groups.owner_consent_mobile; V28 gave standalone rooms the same "
                        + "OTP-backed consent lookup.");
        map.put("flatmate_owner_consents.owner_mobile",
                "As flatmate_groups.owner_consent_mobile; the consent row keys on the number "
                        + "itself, NOT NULL.");
        map.put("flatmate_seeker_posts.name",
                "A denormalised copy of the poster's name on their own post.");
        map.put("flatmate_seeker_posts.age",
                "The poster's age, stored on the post rather than read through user_id.");
        map.put("flatmate_seeker_posts.occupation", "The poster's occupation, stored on the post.");
        map.put("personal_documents.file_name",
                "The subject's own uploaded KYC papers (V32). The sweep reaches neither the row nor "
                        + "the stored object, which makes this the largest of these gaps.");

        return map;
    }


    @Autowired
    UserRepository users;
    @Autowired
    EntityManager entityManager;

    /** Audit rows commit past this test's rollback ({@code REQUIRES_NEW}); clean them explicitly. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }


    @Test
    @DisplayName("every personal-data column in the migrated schema is classified as erased, retained or a disclosed gap")
    void everyPersonalDataColumnIsClassified() {
        Set<String> classified = new LinkedHashSet<>(ERASED.keySet());
        classified.addAll(RETAINED.keySet());
        classified.addAll(GAPS.keySet());

        Set<String> unclassified = new TreeSet<>();
        for (String column : schemaColumns()) {
            if (looksPersonal(columnOf(column)) && !classified.contains(column)) {
                unclassified.add(column);
            }
        }

        assertThat(unclassified)
                .withFailMessage("""
                        %d column(s) in the migrated schema look like personal data and are not \
                        classified in ErasureCoverageTest:
                        %s

                        Every one of them needs a decision, in this file:
                          ERASED  -- ErasureService clears it. Add it to ERASED with an Outcome, and \
                        make sure the sweep really does (everyErasedColumnIsActuallyCleared seeds a \
                        value and reads it back, so a wrong entry fails rather than passing quietly).
                          RETAINED -- it stays. Add it to RETAINED with the statute that requires \
                        keeping it, or the reason it does not describe a natural person. This map is \
                        the audit record; "not personal" without a reason is not an answer.
                          GAPS    -- personal data this sweep does not reach. Add it to GAPS *and* \
                        name its table in ErasureRetention#knownGaps(), which is written into every \
                        erasure record and shown to the subject. Undisclosed gaps are the failure \
                        mode this test exists to prevent: the subject is told they were erased and \
                        the data is still there.""",
                        unclassified.size(), bullets(unclassified))
                .isEmpty();

        RETAINED.forEach((column, reason) -> assertThat(reason)
                .withFailMessage("RETAINED entry '%s' has no usable justification. The map is the "
                        + "audit record for a DPDP s.8(7) decision; write the statute or the reason "
                        + "the column does not describe a person.", column)
                .isNotBlank()
                .hasSizeGreaterThan(30));
    }

    // A classification naming a column the schema lacks is one step short of the sweep doing it —
    // a 500 halfway through an irreversible operation.
    @Test
    @DisplayName("no classification names a column the schema no longer has")
    void noClassificationNamesAColumnTheSchemaNoLongerHas() {
        Set<String> schema = new LinkedHashSet<>(schemaColumns());

        Set<String> stale = new TreeSet<>();
        ERASED.keySet().stream().filter(c -> !schema.contains(c)).forEach(stale::add);
        RETAINED.keySet().stream().filter(c -> !schema.contains(c)).forEach(stale::add);
        GAPS.keySet().stream().filter(c -> !schema.contains(c)).forEach(stale::add);

        assertThat(stale)
                .withFailMessage("""
                        %d classified column(s) do not exist in the migrated schema:
                        %s

                        A migration dropped or renamed them. If one is in ERASED, ErasureService is \
                        almost certainly still naming it in an UPDATE -- that is a 500 halfway \
                        through the one operation that must not half-happen, so check the sweep \
                        before you touch this file. Then delete the entry here, or correct it to \
                        the new column name.""",
                        stale.size(), bullets(stale))
                .isEmpty();
    }

    // A gap is allowed; a silent one is not. Requiring the disclosure, serialised into
    // erasure_requests.retained and returned, makes parking a column cost something.
    @Test
    @DisplayName("every parked gap is disclosed in the record the subject receives")
    void everyGapIsDisclosedToTheSubject() {
        String disclosure = String.join("\n", ErasureRetention.knownGaps());

        Set<String> undisclosed = new TreeSet<>();
        for (String column : GAPS.keySet()) {
            if (!disclosure.contains(tableOf(column))) {
                undisclosed.add(column);
            }
        }

        assertThat(undisclosed)
                .withFailMessage("""
                        %d column(s) are parked in GAPS but their table is not named in \
                        ErasureRetention#knownGaps():
                        %s

                        knownGaps() is serialised into erasure_requests.retained and returned to the \
                        subject. A gap that is not in it means telling somebody they were erased \
                        while their personal data is still on the platform and nothing on record \
                        says so. Either sweep the column, or add its table to knownGaps() with what \
                        is left behind and why.""",
                        undisclosed.size(), bullets(undisclosed))
                .isEmpty();
    }


    // The half that cannot be faked by editing a list. The pre-check matters as much: a column never
    // seeded would pass the post-check trivially, so each is proved non-null first.
    @Test
    @DisplayName("every column claimed as erased is seeded, swept, and verifiably empty afterwards")
    void everyErasedColumnIsActuallyCleared() throws Exception {
        User subject = subject("9800000401");
        User admin = subject("9800000402");
        admin.setRole("admin");
        UUID subjectId = subject.getId();
        String oldMobile = subject.getMobile();
        seedEverySweptTable(subjectId, oldMobile);
        entityManager.flush();

        // DETACHED needs a before-count: after the sweep the rows are unreachable from the subject,
        // so there is no counting them retroactively.
        Map<String, Long> beforeCounts = new LinkedHashMap<>();
        Set<String> unseeded = new TreeSet<>();
        for (Map.Entry<String, Outcome> entry : ERASED.entrySet()) {
            String column = entry.getKey();
            if (entry.getValue() == Outcome.ROW_REMOVED) {
                if (rowCount(tableOf(column), subjectId, oldMobile) == 0) {
                    unseeded.add(column);
                }
            } else if (entry.getValue() == Outcome.DETACHED) {
                if (rowCount(tableOf(column), subjectId, oldMobile) == 0) {
                    unseeded.add(column);
                }
                beforeCounts.put(column, totalRows(tableOf(column)));
            } else if (isEmpty(read(column, subjectId, oldMobile))) {
                unseeded.add(column);
            }
        }
        assertThat(unseeded)
                .withFailMessage("""
                        This test could not put a value into %d column(s) it claims erasure clears:
                        %s

                        Until they hold something, asserting they are empty afterwards proves \
                        nothing. Fix seedEverySweptTable() -- do not delete the entries from \
                        ERASED.""", unseeded.size(), bullets(unseeded))
                .isEmpty();

        String requestId = fileRequest(subject);
        mvc.perform(patch("/admin/erasure-requests/{id}", requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"execute\",\"note\":\"schema coverage check\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));
        entityManager.flush();

        Map<String, String> survivors = new LinkedHashMap<>();
        for (Map.Entry<String, Outcome> entry : ERASED.entrySet()) {
            String column = entry.getKey();
            switch (entry.getValue()) {
                case ROW_REMOVED -> {
                    long remaining = rowCount(tableOf(column), subjectId, oldMobile);
                    if (remaining > 0) {
                        survivors.put(column, remaining + " row(s) survived the sweep");
                    }
                }
                case CLEARED -> {
                    Object value = read(column, subjectId, oldMobile);
                    if (!isEmpty(value)) {
                        survivors.put(column, "still holds " + value);
                    }
                }
                case REPLACED -> {
                    Object value = read(column, subjectId, oldMobile);
                    if (isEmpty(value) || oldMobile.equals(String.valueOf(value))) {
                        survivors.put(column, "was not substituted (reads " + value + ")");
                    }
                }
                case DETACHED -> {
                    long stillLinked = rowCount(tableOf(column), subjectId, oldMobile);
                    if (stillLinked > 0) {
                        survivors.put(column, stillLinked + " row(s) still reference the subject");
                    }
                    // A sweep that switched to `delete from page_views` would pass the check above
                    // while doing the opposite of what the classification tells an auditor.
                    long after = totalRows(tableOf(column));
                    long before = beforeCounts.getOrDefault(column, after);
                    if (after < before) {
                        survivors.put(column, "is classified DETACHED but the sweep deleted "
                                + (before - after) + " row(s) -- detaching keeps them");
                    }
                }
                default -> throw new IllegalStateException("unhandled outcome for " + column);
            }
        }

        assertThat(survivors)
                .withFailMessage("""
                        %d column(s) classified ERASED still carry the subject's data after a \
                        completed erasure:
                        %s

                        Either ErasureService stopped sweeping them -- which is a live DPDP s.12(3) \
                        failure and the account holder has been told they were erased -- or the \
                        classification in this file is wrong. Check ErasureService#execute first.""",
                        survivors.size(),
                        survivors.entrySet().stream()
                                .map(e -> "  - " + e.getKey() + ": " + e.getValue())
                                .reduce((a, b) -> a + "\n" + b).orElse(""))
                .isEmpty();
    }


    // Views are excluded because their columns are somebody else's seen twice, and
    // flyway_schema_history is a ledger.
    private List<String> schemaColumns() {
        return jdbc.queryForList("""
                select c.table_name || '.' || c.column_name
                  from information_schema.columns c
                  join information_schema.tables t
                    on t.table_schema = c.table_schema
                   and t.table_name = c.table_name
                 where c.table_schema = 'public'
                   and t.table_type = 'BASE TABLE'
                   and c.table_name <> 'flyway_schema_history'
                 order by 1
                """, String.class);
    }

    private static boolean looksPersonal(String column) {
        String name = column.toLowerCase(Locale.ROOT);
        for (String token : IDENTIFIER_TOKENS) {
            if (name.contains(token)) {
                return true;
            }
        }
        for (String token : BOUNDED_TOKENS) {
            if (name.equals(token)
                    || name.startsWith(token + "_")
                    || name.endsWith("_" + token)
                    || name.contains("_" + token + "_")) {
                return true;
            }
        }
        return false;
    }

    private static String tableOf(String qualified) {
        return qualified.substring(0, qualified.indexOf('.'));
    }

    private static String columnOf(String qualified) {
        return qualified.substring(qualified.indexOf('.') + 1);
    }

    private static String bullets(Set<String> items) {
        return items.stream().map(item -> "  - " + item).reduce((a, b) -> a + "\n" + b).orElse("");
    }

    /** {@code null}, or {@code false} for the NOT NULL booleans erasure resets rather than nulls. */
    private static boolean isEmpty(Object value) {
        return value == null || Boolean.FALSE.equals(value);
    }

    // otp_codes and service_request_parties key on the number itself, not a user id — which is
    // precisely why erasure must reach them before it substitutes the mobile.
    private static final Map<String, String> SWEPT_ROW = Map.ofEntries(
            Map.entry("users", "id = ?"),
            Map.entry("tenant_profiles", "user_id = ?"),
            Map.entry("owner_kyc", "user_id = ?"),
            Map.entry("identity_verifications", "user_id = ?"),
            Map.entry("refresh_tokens", "user_id = ?"),
            Map.entry("otp_codes", "mobile = ?"),
            Map.entry("outbound_message", "recipient_id = ?"),
            Map.entry("page_views", "user_id = ?"),
            Map.entry("society_claims", "claimed_by = ?"),
            Map.entry("service_request_parties", "mobile = ?"),
            Map.entry("tenant_rentals", "tenant_id = ?"),
            Map.entry("help_article_feedback", "user_id = ?"),
            Map.entry("service_request_identities",
                    "service_request_id in (select id from service_requests where requester_id = ?)"));

    private static final Set<String> KEYED_ON_OLD_MOBILE =
            Set.of("otp_codes", "service_request_parties");

    private Object key(String table, UUID subjectId, String oldMobile) {
        return KEYED_ON_OLD_MOBILE.contains(table) ? oldMobile : subjectId;
    }

    // The column name is concatenated because a placeholder cannot stand for one. Safe only here:
    // both halves come from ERASED, and a sibling test proves each names a real column.
    private Object read(String qualified, UUID subjectId, String oldMobile) {
        String table = tableOf(qualified);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select " + columnOf(qualified) + " as v from " + table
                        + " where " + SWEPT_ROW.get(table),
                key(table, subjectId, oldMobile));
        assertThat(rows)
                .withFailMessage("No row in %s for the subject — the fixture never created one, so "
                        + "asserting anything about %s would be vacuous.", table, qualified)
                .hasSize(1);
        return rows.get(0).get("v");
    }

    private long rowCount(String table, UUID subjectId, String oldMobile) {
        Long count = jdbc.queryForObject(
                "select count(*) from " + table + " where " + SWEPT_ROW.get(table),
                Long.class, key(table, subjectId, oldMobile));
        return count == null ? 0L : count;
    }

    /** Every row in the table, subject or not — how {@link Outcome#DETACHED} proves rows survived. */
    private long totalRows(String table) {
        Long count = jdbc.queryForObject("select count(*) from " + table, Long.class);
        return count == null ? 0L : count;
    }

    private User subject(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Erasable Person");
        u.setEmail(mobile + "@example.com");
        u.setCity("Pune");
        u.setAvatar("https://cdn.example/" + mobile + ".jpg");
        u.setPasswordHash("$2a$10$notarealhashnotarealhashnotarealhashnotarealhashno");
        u.setMobileVerified(true);
        u.setVerified(true);
        u.setLastActive(Instant.now());
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    /** One row in every table the sweep touches, with something in every column it claims to clear. */
    private void seedEverySweptTable(UUID subjectId, String mobile) {
        jdbc.update("""
                insert into otp_codes (mobile, code_hash, purpose, expires_at)
                values (?, ?, 'login', now() + interval '5 minutes')
                """, mobile, "hashed-otp");
        jdbc.update("""
                insert into refresh_tokens (user_id, token_hash, expires_at)
                values (?, ?, now() + interval '30 days')
                """, subjectId, "hashed-refresh-token");
        jdbc.update("""
                insert into identity_verifications
                       (user_id, status, doc_type, claimed_number_last4, claimed_name, claimed_dob,
                        claimed_hash, identity_hash, person_key, doc_last4, holder_name, holder_dob,
                        consent_at, submitted_at, attempt_count, attempt_window_start, decided_at)
                values (?, 'verified', 'aadhaar', '1234', 'Erasable Person', date '1990-05-01',
                        ?, ?, ?, '1234', 'Erasable Person', date '1990-05-01',
                        now(), now(), 1, now(), now())
                """, subjectId, "hmac-claimed-9001", "hmac-identity-9001", "hmac-person-9001");
        jdbc.update("""
                insert into owner_kyc (user_id, pan_masked, aadhaar_masked, status)
                values (?, ?, ?, 'verified')
                """, subjectId, "ABCDE****F", "XXXX XXXX 5678");
        jdbc.update("""
                insert into tenant_profiles
                       (user_id, name, occupation, income, occupants, move_in, prior_landlord,
                        about, score)
                values (?, ?, ?, ?, 'family', current_date + 30, ?, ?, 72)
                """, subjectId, "Erasable Person", "Architect", 180000L,
                "Mr Deshpande, 98xxxxxx01", "Quiet, non-smoker, works from home");

        // Both personal columns are filled, including the landlord's name — the third party's data
        // this table collects incidentally.
        jdbc.update("""
                insert into tenant_rentals
                       (tenant_id, address, landlord_name, monthly_rent, deposit, lease_start)
                values (?, ?, ?, 24000, 100000, current_date - interval '6 months')
                """, subjectId, "Flat 402, Sunrise Residency, Kothrud, Pune 411038",
                "Mr Deshpande");

        UUID serviceRequestId = UUID.randomUUID();
        jdbc.update("""
                insert into service_requests (id, requester_id, type, team, status)
                values (?, ?, 'rent-agreement', 'rental', 'new')
                """, serviceRequestId, subjectId);        jdbc.update("""
                insert into service_request_identities
                       (service_request_id, party_role, party_index, party_name, pan, aadhaar)
                values (?, 'tenant', 0, ?, ?, ?)
                """, serviceRequestId, "Erasable Person", "ABCDE1234F", "123412341234");

        // Deliberately pending — `user_id` null, `mobile` set — the only shape of this row holding
        // personal data. `invited_by` is the subject for want of a second account; the sweep ignores it.
        jdbc.update("""
                insert into service_request_parties
                       (request_id, mobile, invite_expires_at, role, status, invited_by)
                values (?, ?, now() + interval '90 days', 'owner', 'invited', ?)
                """, serviceRequestId, mobile, subjectId);

        // `prepared_by` is the subject only for want of a second account; the sweep keys off
        // `recipient_id`. `template_id` points at a seeded row, proving the delete is not FK-blocked.
        jdbc.update("""
                insert into outbound_message
                       (channel, template_id, subject_type, subject_id, recipient_id,
                        recipient_mobile, body, prepared_by)
                values ('whatsapp', 'wa-photos', 'property', ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), subjectId, mobile,
                "Hi Erasable Person, could you send photographs of your flat in Kothrud?", subjectId);

        // Two page views rather than one: a single row cannot distinguish "the link was nulled"
        // from "the row was deleted and another happened to remain".
        jdbc.update("""
                insert into page_views (session_id, user_id, path, referrer_host, device)
                values ('erasure-seed-session', ?, '/listings', 'google.com', 'mobile'),
                       ('erasure-seed-session', ?, '/property/:id', null, 'mobile')
                """, subjectId, subjectId);
        // Two verdicts, one with prose and one without, because a sweep that removed only the rows
        // carrying a comment would pass a check that looked at either one alone.
        jdbc.update("""
                insert into help_article_feedback (slug, lang, helpful, comment, user_id)
                values ('what-is-draazy', 'en', false,
                        'Nobody called me back on 9876543210 about the Kothrud flat.', ?),
                       ('create-account', 'mr', true, null, ?)
                """, subjectId, subjectId);
        // The society is read rather than created so the sweep's `where claimed_by` runs against a
        // real FK. Taken from the far end of the slug ordering: the engagement fixtures count up.
        jdbc.update("""
                insert into society_claims (society_id, claimed_by, name, role, email, status)
                select id, ?, 'Committee Secretary Erasable Person', 'secretary',
                       'secretary.personal@example.com', 'pending'
                  from societies
                 order by slug desc
                 limit 1
                """, subjectId);
    }

    private String fileRequest(User subject) throws Exception {
        String body = mvc.perform(post("/me/erasure")
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"schema coverage check\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return body.replaceAll("^.*\"id\":\"([^\"]+)\".*$", "$1");
    }
}
