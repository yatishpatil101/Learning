package com.punenest.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Full listing detail (contract {@code Property} = {@code PropertySummary} + detail + owner). The
 * entity↔wire boundary for the detail path; the JPA entity never crosses the wire.
 *
 * <p>Trust rule (ADR-019, badge-not-gate): the owner's mobile is <em>always emitted masked</em>
 * (e.g. {@code 98XXXXX210}) on this shape. Unmasking is a separate contact-gate slice — there is no
 * {@code 403} here, only a masked number, so the UI can render the "request contact" affordance
 * without ever seeing the raw digits until the gate is passed. The masking is applied server-side by
 * {@code PropertyMapper.toOwner} (hand-written, never generated), never in the client.
 *
 * <p>{@code adminPipeline} (staff post-on-behalf onboarding) is intentionally omitted — it belongs
 * to the moderation slice and is not needed by the consumer/owner surfaces this slice serves.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyResponse(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        String priceUnit,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String locality,
        String localitySlug,
        /**
         * The society this home is actually in, keyed by slug, or {@code null} when the owner never
         * named one (D19).
         *
         * <p>The detail page's Society section — builder, towers, units, year, occupancy,
         * conveyance, and a link to the hub — renders from this. It used to render from a society
         * picked by {@code fnvHash(listing.id) % pool.length}, so a page could print one real
         * building's paperwork under another building's listing, and every figure on it was a
         * checkable claim about a named third party.
         *
         * <p>Slug rather than id because that is the society's public key: it is what
         * {@code GET /societies/{slug}} takes, what the hub link routes on, and what the client's
         * own catalogue is indexed by. Absent (NON_NULL) when unbound, and the client renders no
         * Society section at all rather than an emptied one — a section with nothing in it still
         * asserts that this listing belongs to a society.
         */
        String societySlug,
        String city,
        Double lat,
        Double lng,
        String coverImage,
        boolean verified,
        String postedByType,
        String status,
        // Deal outcome (active|reserved|closed), D110. On detail this is redundant with a terminal
        // `status` (sold/rented also imply closed) but carries the one state `status` cannot:
        // `reserved`, an under-offer listing whose moderation status is still `approved`.
        String dealStatus,
        // Paid-placement disclosure (D59). Carried on detail as well as the card because `Property`
        // is `allOf: [PropertySummary, ...]` in the contract -- omitting it here would make the
        // spec claim a field the detail read does not return.
        boolean boosted,
        Instant createdAt,
        // When the owner last confirmed the listing is still available (V86). Null until somebody
        // confirms, and the client falls back to `createdAt` -- the same fallback the freshness
        // model has always used, kept in the reader rather than baked into the column so that a
        // never-confirmed listing stays distinguishable from a confirmed-on-day-one one.
        //
        // Public, and on the summary, because the freshness badge is a buyer-facing transparency
        // signal: the whole point is that a stranger can see how recently anyone vouched for this
        // listing being real. Withholding it would leave the badge to be computed from `createdAt`
        // alone, which is what it already did, badly.
        Instant lastConfirmedAt,
        // The freshness tier derived from `lastConfirmedAt` above, and the generated completeness
        // score (V94). Both moved off the browser in D26: the tier because `isDormant` was a
        // visibility decision the client had no business making, the score because it orders
        // search results and an ordering the database cannot see cannot be paged.
        // `qualityScore` is absent rather than zero when the instance has not been read back since
        // it was written -- a generated column has no value on the row a write just built.
        Integer qualityScore,
        String freshness,
        // ---- search facets the browser used to invent (V95) ----
        // Six fields the listings page has filtered on since it was written, none of which had a
        // column: against the live API they compared against `undefined`, so selecting any of them
        // returned an empty page. On detail rather than on the card because their job is to be
        // filtered on -- which now happens in SQL -- and to be shown to the owner who declared
        // them. See V95 for why they were built rather than deleted.
        String landUse,
        Integer ageYears,
        String room,
        List<String> tenants,
        String availableFrom,
        boolean pets,
        List<String> sharing,
        // ---- detail ----
        String description,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        String reraId,
        BigDecimal carpetArea,
        BigDecimal builtUpArea,
        BigDecimal superBuiltUpArea,
        Integer floor,
        Integer totalFloors,
        String facing,
        // Two more tiles the detail page has always rendered and never had a source for (V114).
        // `bathrooms` is the one that mattered: the browser fell back to `bhk - 1` and printed the
        // result as a fact, so a 3 BHK claimed two bathrooms on the strength of arithmetic. Absent
        // here now means the owner did not say, and the page must show nothing rather than guess.
        Integer bathrooms,
        Integer parking,
        Integer balconies,
        String possession,
        List<String> amenities,
        List<String> images,
        String floorPlan,
        String video,
        /**
         * The street address <em>including the unit</em> — owner and staff only, absent for
         * everyone else ({@link com.punenest.api.common.trust.PrivateFieldVisibility}).
         *
         * <p>This field carries the flat number because {@link
         * com.punenest.api.catalog.listing.AddressKey} needs the unit token to tell one flat from
         * its neighbour — an address that stops at the building flags a whole tower, which is a
         * flag nobody can act on. That makes the value useful to a duplicate probe and dangerous
         * to publish: the contact gate exists so a stranger cannot reach an owner uninvited, and a
         * stranger holding "A-902, Rohan Nilay" does not need a phone number, they can knock. The
         * exposure is worst for exactly the listings this platform carries most of — PG and shared
         * accommodation, where the occupant is often a single woman living alone in that unit.
         *
         * <p>Nothing renders it: the public detail page is built from {@code society},
         * {@code locality} and {@code pincode}, and the frontend's {@code toViewModel} does not
         * read this field at all. It is emitted only so the owner's edit form can round-trip what
         * the owner typed, and so the desk can adjudicate a duplicate.
         *
         * <p>Absent (NON_NULL) rather than null for the public, so the shape of the response does
         * not advertise that a field is being withheld.
         */
        String address,
        String pincode,
        /**
         * The unit's electricity meter number — owner and staff only, absent for everyone else
         * (V79, {@link com.punenest.api.common.trust.PrivateFieldVisibility}).
         *
         * <p>Emitted at all only because the owner typed it and must be able to correct it, and
         * because it is the evidence behind a duplicate flag the desk has to adjudicate. It is not
         * a listing attribute in the sense the rest of this record is: nothing renders it, nothing
         * searches on it, and its one consumer is a server-side probe. A meter number names a live
         * utility account, which makes it one of the few things here a stranger could <em>act</em>
         * on rather than merely read.
         *
         * <p>Absent (NON_NULL) rather than null for the public, so the shape of the response does
         * not advertise that a field is being withheld.
         */
        String electricityMeterNo,
        int views,
        int enquiries,
        boolean featured,
        /**
         * Why a moderator took this listing down — <strong>back office only</strong>, absent for
         * every other audience ({@link com.punenest.api.common.trust.BackOfficeVisibility}).
         *
         * <p>Gated rather than left mechanical because its absence from consumer responses was
         * otherwise an accident of housekeeping rather than a property of the projection. Three
         * separate places clear the column — approving through {@code setStatus}, lowering a flag,
         * and the verification service — and a public listing carries no reason only for as long as
         * all three keep doing so. The column is a moderator's private note about a listing, often
         * quoting a report or naming a suspicion about the person who posted it; one missed
         * {@code setFlagReason(null)} and it is on the public detail read, where nothing renders it
         * and nobody would notice.
         *
         * <p>Withheld from the owner too, which is the less obvious half. It reads like something
         * they are owed, but the moderator's shorthand ("looks like the Baner listing again",
         * "reporter says photos are from a hotel") is written to be read by the desk, and handing
         * it back also hands back whatever the reporter said about them. What an owner is owed is
         * an explanation, and that has its own surface: the verification thread, where the note is
         * addressed to them and an internal one is filed on the staff-only lane instead.
         *
         * <p>Absent (NON_NULL) rather than null, so the shape of the response does not advertise
         * that a field is being withheld.
         */
        String flagReason,
        /**
         * Is a stays-live moderation re-check queued on this listing? (Q14)
         *
         * <p>True when the owner has edited {@code price}, {@code furnishing} or {@code possession}
         * on an approved listing: the edit is waiting for a moderator, but — unlike the identity
         * fields, which revert {@code status} to {@code pending} — the listing is still approved and
         * still in search. Without this field the two outcomes are indistinguishable on the wire,
         * because the only thing that changes for the second is a column nobody can read.
         */
        boolean recheckPending,
        /** Which fields raised the pending re-check, e.g. {@code "price, furnishing"} (Q14). */
        String recheckReason,
        /**
         * When the re-check was first queued — the queue's <em>age</em>, and the only thing that
         * makes the stays-live outcome auditable (Q14).
         *
         * <p>Emitted because {@code recheckPending} alone cannot answer the question a re-check
         * queue exists to answer. A listing that stays live and earning while it waits is only a
         * rebalanced control if somebody drains the queue; a boolean says a re-check is owed but
         * not that it has been owed for eleven days, so an undrained queue looks exactly like an
         * empty one. {@link Property#requestRecheck} deliberately does not refresh this on later
         * edits, so the age is honest and an owner cannot edit their way back to the front.
         *
         * <p>Absent (NON_NULL) when nothing is queued, matching {@code recheckReason}.
         */
        Instant recheckRequestedAt,
        /**
         * The soft-delete flag. Always {@code false} on the public detail read — {@code getPublic}
         * filters archived rows out — and meaningful only on the two status-complete reads,
         * {@code GET /me/listings} and {@code GET /admin/properties}.
         *
         * <p>Emitted because {@code archived} is a <em>separate axis</em> from {@code status}, not a
         * sixth status value: archiving preserves the moderation state it was archived from, and
         * restoring resets to {@code pending}. Without this field a client reading either
         * status-complete list has no way to tell a live pending listing from an archived one, and
         * the only safe assumption — "not archived" — is wrong for exactly the rows that matter.
         */
        boolean archived,
        boolean ownerVerified,
        boolean ownershipVerified,
        boolean societyVerified,
        boolean conveyanceDone,
        int docsCount,
        Owner owner,

        /**
         * The post-on-behalf onboarding funnel, or null for every audience but the back office.
         *
         * <p>Null rather than an empty object when hidden, so {@code NON_NULL} removes the key
         * entirely: a consumer response that carried {@code "adminPipeline": {}} would still be
         * telling anyone reading it that such a thing exists and that this listing has none of it,
         * which is most of what the field was worth concealing.
         */
        AdminPipeline adminPipeline) {

    /**
     * Post-on-behalf onboarding state (contract {@code Property.adminPipeline}).
     *
     * <p>Only {@code postedByAdmin}, {@code pipelineStage}, {@code handbackMilestone} and
     * {@code postedByStaff} are stored. The three booleans are derived from the milestone by
     * {@link PipelineStage#reached} — they ask "has the hand-back got this far", which the
     * milestone already answers, and keeping a second copy would only create the opportunity for
     * the two to disagree.
     *
     * @param pipelineStage      where the listing is on the acquisition funnel: {@code contacted},
     *                           {@code info_collected}, {@code listed} or {@code docs_submitted}.
     * @param handbackMilestone  where it is on the hand-back axis, or null if that has not started.
     *                           A second field rather than more values on {@code pipelineStage},
     *                           because a listing sits on both axes at once — see D27 and
     *                           {@link PipelineStage}.
     * @param reminderCount how many chasers have gone to this owner. This said "always 0 until
     *                      there is a messaging surface to count"; there is one now, and this is a
     *                      live count over the {@code outbound_message} ledger, supplied by
     *                      {@link com.punenest.api.common.trust.OutreachCounts}. Still deliberately
     *                      not a column, for the reason the original note gave: counted from the
     *                      messages themselves, it cannot drift from the messages actually sent.
     *                      Reads 0 for a listing staff have never chased — and, because this whole
     *                      object is null for owner-posted listings, a chaser sent to an owner on
     *                      their own listing is written to the ledger and has nowhere here to
     *                      appear. That is the funnel's scope rather than an omission: the count
     *                      lives on a record of a listing the platform manufactured, and
     *                      {@code GET /properties/&#123;id&#125;/outreach} is where the full history
     *                      is asked for regardless of who posted it.
     */
    public record AdminPipeline(
            boolean postedByAdmin,
            String postedByStaff,
            String pipelineStage,
            String handbackMilestone,
            boolean claimLinkSent,
            boolean photosUploaded,
            boolean aadhaarVerified,
            int reminderCount) {
    }

    /**
     * Owner summary embedded in the detail (contract {@code Property.owner}). {@code mobile} is the
     * masked form; the raw number is never placed here on this slice.
     *
     * @param id       owner user id
     * @param mobile   masked mobile (e.g. {@code 98XXXXX210})
     * @param verified owner's identity "Verified" badge
     */
    public record Owner(String id, String name, String mobile, boolean verified) {
    }
}
