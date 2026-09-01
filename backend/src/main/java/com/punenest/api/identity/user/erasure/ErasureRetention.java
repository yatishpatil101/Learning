package com.punenest.api.identity.user.erasure;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * <strong>What erasure deletes, what it keeps, and on whose authority.</strong>
 *
 * <p>This class holds no behaviour worth speaking of. It exists because the hard part of a
 * right-to-erasure implementation is not the {@code UPDATE} statements — it is the decision about
 * which data a statute forbids you to erase, and that decision is invisible in the code that acts on
 * it. A future reader can reconstruct <em>what</em> {@link ErasureService} does by reading it. They
 * cannot reconstruct <em>why</em> a rent agreement survives an erasure request and a KYC record does
 * not, and getting that wrong in either direction is a legal failure: erase too much and the
 * platform destroys evidence it is required to hold; erase too little and it has not honoured a
 * statutory right.
 *
 * <h2>The governing rule</h2>
 *
 * <p>Digital Personal Data Protection Act 2023 (India):
 *
 * <ul>
 *   <li><strong>s.12(3)</strong> — a Data Principal has the right to erasure of their personal
 *       data.</li>
 *   <li><strong>s.8(7)</strong> — the Data Fiduciary <em>shall</em> erase on withdrawal of consent
 *       or once the purpose is served, <em>"unless retention is necessary for compliance with any
 *       law for the time being in force"</em>.</li>
 * </ul>
 *
 * <p>So the question for every category below is not "is this personal?" — most of it is — but
 * "does another statute require us to keep being able to identify this person in this record?" Where
 * the answer is yes, retention is not a concession the platform grants itself; it is a competing
 * legal duty, and the record says which one.
 *
 * <h2>Two further principles that decided the harder cases</h2>
 *
 * <ol>
 *   <li><strong>A record with two subjects has two sets of rights.</strong> A rent agreement, a
 *       closed deal and a review are each a statement involving somebody who is not the person
 *       asking to be erased. One party's erasure right does not reach into the other party's
 *       evidence of a transaction they were also part of. This is the reason a rent agreement is
 *       retained even though it names the erasing subject — the counterparty's ability to prove the
 *       tenancy is not the subject's to extinguish.</li>
 *   <li><strong>Pseudonymisation of the identity root de-identifies the graph.</strong> Fifty-five
 *       tables carry a {@code user_id} foreign key into {@code users}. Almost none of them holds
 *       contact data of its own — they hold a reference. Once the {@code users} row no longer names
 *       a person, those references point at nobody, which is what "irreversibly pseudonymised" means
 *       in practice. That is why erasure is a small, explicit sweep of the tables that duplicate
 *       identity rather than a cascade over everything that mentions the id. A cascade would delete
 *       the retained categories above and could not be undone.</li>
 * </ol>
 */
public final class ErasureRetention {

    private ErasureRetention() {
    }

    /**
     * Categories deliberately kept, and the law that requires keeping them.
     *
     * <p>Written into {@code erasure_requests.retained} at execution rather than only living here,
     * so that a request decided today still carries the reasoning it was decided under after this
     * class has been edited. A retention record whose justification is "whatever the current code
     * says" is not a record of a decision.
     *
     * <p>Ordered, so the stored document reads the same way every time and a diff between two
     * requests is a real diff.
     */
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

    /**
     * <strong>Known gaps. Personal data this pass does not reach.</strong>
     *
     * <p>Recorded in code, and written into the stored request beside the retained categories,
     * because an erasure that quietly misses a table is worse than one that says it missed it: the
     * subject is told they were erased and the data is still there. Each of these is a place where
     * the platform duplicates identity outside the {@code users} row, so pseudonymising the identity
     * root does <em>not</em> de-identify it.
     *
     * <p>They are gaps rather than retentions: no statute requires any of them, and each should be
     * swept. They are listed rather than swept in this pass because each needs its exact columns
     * confirmed against the schema before an {@code UPDATE} is written, and a sweep that names a
     * column wrongly fails at runtime on the one operation that must not fail halfway.
     *
     * <p><strong>The last eight entries were not found by reading this code.</strong> They were
     * derived from the migrated schema by {@code ErasureCoverageTest}, which classifies every
     * personal-data column in {@code information_schema} and fails the build on any that is neither
     * swept nor listed here. Until that test existed, this list was a second hand-written list
     * checked against the first one, and eight tables carrying live contact details were disclosed
     * to nobody. Anything added below has to be a real disclosure, because the subject reads it.
     */
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
                "flatmate_groups.owner_consent_mobile / flatmate_owner_consents.owner_mobile — the"
                        + " flat owner's number, captured as evidence of their consent to a flatmate"
                        + " group. The consent record keys on the number itself.",
                "flatmate_seeker_posts — name, age and occupation are stored on the post rather than"
                        + " read through user_id, so the post keeps describing its author after the"
                        + " users row stops naming anybody.",
                "personal_documents — the subject's own uploaded KYC papers. Neither the row nor the"
                        + " stored object is reached by this sweep, which makes it the largest of"
                        + " these gaps by volume of personal data.");
    }
}
