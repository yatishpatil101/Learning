package com.draazy.api.identity.user.erasure;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** What erasure deletes, what it keeps, and on whose authority. Statutory reasoning per category:
 * docs/system/legal-entity-and-compliance.md §11. */
public final class ErasureRetention {

    private ErasureRetention() {
    }

    /** Written into {@code erasure_requests.retained} at execution; ordered so two stored documents
     * diff cleanly. */
    public static Map<String, String> retainedWithReasons() {
        Map<String, String> reasons = new LinkedHashMap<>();

        reasons.put("payments_and_invoices",
                "Books of account. Income-tax Act 1961 s.44AA with Rule 6F requires books and "
                        + "vouchers to be kept for six years from the end of the relevant assessment "
                        + "year; CGST Act 2017 s.36 requires seventy-two months from the due date of "
                        + "the annual return; Companies Act 2013 s.128(5) requires eight years. A "
                        + "receipt with the payer erased is not a book of account, it is an "
                        + "unattributed credit -- so the identifying fields are the part the statute "
                        + "is actually asking for.");

        reasons.put("rent_agreements",
                "Evidence of a contract, and of a contract with somebody else. Limitation Act 1963 "
                        + "art.113 leaves a three-year window in which either party may sue on it, "
                        + "and the Registration Act 1908 makes a registered agreement a public "
                        + "record the platform did not create and cannot unmake. Erasing the tenant "
                        + "from an agreement would destroy the landlord's proof of the tenancy at "
                        + "exactly the moment a dispute makes it matter.");

        reasons.put("rent_receipts",
                "A tax document held for the person it was issued to. A rent receipt is the "
                        + "tenant's proof for an HRA claim under Income-tax Act 1961 s.10(13A) with "
                        + "Rule 2A, and the assessing officer may reopen that claim years later -- "
                        + "s.149 allows a notice up to five years from the end of the relevant "
                        + "assessment year, and the receipt is the only thing that answers it. The "
                        + "identifying fields are not incidental to the document, they are the "
                        + "document: a receipt that does not say who paid whom for which address "
                        + "proves nothing, so erasing them would not leave a weaker record but a "
                        + "worthless one. Note the erasing party is usually the landlord, and the "
                        + "claim it would destroy belongs to the tenant -- the same asymmetry as "
                        + "rent agreements, from the other side.");

        reasons.put("closed_deals_and_offers",
                "Same reasoning as rent agreements, plus brokerage: a closed deal is the "
                        + "consideration for a fee the platform charged and must be able to "
                        + "substantiate. The counterparty's record of who they transacted with is "
                        + "not the erasing party's to delete.");

        reasons.put("audit_log",
                "Accountability for privileged action. Rows here record what an *operator* did, "
                        + "identified by their staff id -- the subject appears as an entity id, not "
                        + "as a name or a number. Erasing it would remove the proof that moderation "
                        + "and erasure themselves were carried out properly, including the proof of "
                        + "this erasure. It is also the only table on the platform that is "
                        + "append-only by design.");

        reasons.put("abuse_reports",
                "Safety record. A report *about* the subject is another user's statement and the "
                        + "platform's record of a decision it took; a report *by* the subject is "
                        + "evidence in a case that may still be open against somebody else. "
                        + "Reporter identity is already withheld from the queue on the wire, and "
                        + "`reports.reporter_id` de-identifies with the users row like every other "
                        + "foreign key.");

        reasons.put("reviews_and_ratings",
                "Statements other people rely on. A review is about a property, is already "
                        + "displayed under a resolved author name rather than a stored one, and "
                        + "feeds a rating average other users read. It de-identifies with the users "
                        + "row; removing the text would silently move a score that a landlord and "
                        + "future tenants act on.");

        reasons.put("listings_and_property_records",
                "Commercial records with a live counterparty interest -- enquiries, visits and "
                        + "deals reference them. The owner reference de-identifies with the users "
                        + "row. One record here does carry a name of its own: the ownership "
                        + "evidence behind a listing's verified badge stores the name on the "
                        + "identity document our staff sighted, because a badge a buyer relied on "
                        + "must remain checkable after the fact. Erasing it while the badge stands "
                        + "would leave the claim with nothing behind it.");

        return reasons;
    }

    /** Personal data this sweep does not reach, disclosed to the subject alongside the retentions.
     * Derived from the schema by {@code ErasureCoverageTest}, which fails the build on any omission. */
    public static List<String> knownGaps() {
        return List.of(
                "referrals — referrer_mobile and referred_mobile are stored numbers, not references,"
                        + " so they survive pseudonymisation of the users row. The same rows also"
                        + " hold two salted digests of the address and browser the referral was"
                        + " redeemed from, used only to detect referral fraud; those are cleared"
                        + " automatically ninety days after the referral, whether or not erasure is"
                        + " ever requested.",
                "referral_codes — the referrer's half of the same two salted fraud digests, captured"
                        + " when their code was minted. Cleared automatically ninety days after"
                        + " capture. The code itself stays: it is not personal data, and it is what"
                        + " every link already shared points at.",
                "flatmate_group_members.name — a NOT NULL denormalised copy of users.name, written"
                        + " at join time.",
                "society_leads / tickets / service_requests — contact_name and mobile captured at"
                        + " intake, some of it before an account existed, so it is not always"
                        + " reachable from a user id at all.",
                "deal_parties.name / deal_parties.mobile — denormalised party contact on a record"
                        + " that is itself retained; the record must survive, the duplicated contact"
                        + " details need not.",
                "deals.counterparty_mobile — the same denormalised-number shape as deal_parties,"
                        + " on the deal row itself (V11). The deal is retained; the number need not"
                        + " be.",
                "city_waitlist.mobile / city_waitlist.email — written by an unauthenticated endpoint,"
                        + " so the row carries no user id at all. Erasing an account cannot reach it;"
                        + " it needs its own retention window.",
                "saved_searches.mobile — the number property alerts are delivered to. A stored"
                        + " number rather than a reference, so it outlives the pseudonymised users"
                        + " row that the rest of the saved search hangs off.",
                "managed_properties.tenant_name — a third party's name typed in by an owner. Erasing"
                        + " the owner does not touch it, and the tenant it names has no account here"
                        + " to erase from.",
                "flatmate_groups.owner_consent_mobile / flatmate_rooms.owner_consent_mobile / "
                        + "flatmate_owner_consents.owner_mobile — the flat owner's number, captured"
                        + " as evidence of their consent to a flatmate post. The consent record keys"
                        + " on the number itself.",
                "flatmate_seeker_posts — name, age and occupation are stored on the post rather than"
                        + " read through user_id, so the post keeps describing its author after the"
                        + " users row stops naming anybody.",
                "personal_documents — the subject's own uploaded KYC papers. Neither the row nor the"
                        + " stored object is reached by this sweep, which makes it the largest of"
                        + " these gaps by volume of personal data.");
    }
}
