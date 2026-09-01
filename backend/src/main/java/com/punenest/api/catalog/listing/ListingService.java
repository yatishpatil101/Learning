package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.locality.LocalityResolver;
import com.punenest.api.catalog.property.AddressKey;
import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertySort;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.ListingQuotaExhaustedException;
import com.punenest.api.common.trust.ListingAllowanceLookup;
import com.punenest.api.common.trust.ListingCaseNotes;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Owner write side of the catalogue: the {@code /me/listings} lifecycle plus archive/restore. Every
 * read/mutation is keyed by the server-resolved principal id, so a caller can only ever see or change
 * their own rows — cross-owner access returns {@code 404} (we never confirm another owner's listing
 * exists). Split from the public read service because the auth model and invariants differ.
 *
 * <p>Domain invariants enforced here, not just in the UI (ADR-019, trust): a new listing is forced
 * {@code pending} with the owner set from the token (never the body); editing a <em>foundation</em>
 * field earns a moderator's attention — how much of one depends on which field; restore-from
 * -archive resets to {@code pending}; removals are soft-deletes only.
 *
 * <p><strong>Which edits earn what is not decided here.</strong> {@link ListingEditRules} owns that
 * rule and the long argument behind it; this class owns what to <em>do</em> about the answer, and
 * the two paths below do opposite things with the same {@link EditImpact}. The split arrived when
 * this file reached the 450-line ceiling {@code ServiceSizeGuardTest} enforces, but it is along a
 * real seam: a rule that decides and a caller that acts.
 */
@Service
public class ListingService {

    private final PropertyRepository properties;
    private final UserRepository users;
    private final LocalityResolver localities;
    private final ListingEditRules editRules;
    private final PropertyMapper propertyMapper;
    private final ListingCaseNotes caseNotes;
    private final ListingDuplicateProbe duplicates;
    private final AuditService audit;
    private final ListingAllowanceLookup allowances;

    public ListingService(PropertyRepository properties, UserRepository users,
            LocalityResolver localities, ListingEditRules editRules, PropertyMapper propertyMapper,
            ListingCaseNotes caseNotes, ListingDuplicateProbe duplicates, AuditService audit,
            ListingAllowanceLookup allowances) {
        this.properties = properties;
        this.users = users;
        this.caseNotes = caseNotes;
        this.duplicates = duplicates;
        this.localities = localities;
        this.editRules = editRules;
        this.propertyMapper = propertyMapper;
        this.audit = audit;
        this.allowances = allowances;
    }

    /** The caller's own listings (all statuses incl. archived), owner-scoped; contract {@code myListings}. */
    @Transactional(readOnly = true)
    public Page<Property> myListings(UUID userId, Pageable pageable) {
        return properties.findByOwner_Id(userId, PropertySort.sanitize(pageable));
    }

    /** A single owned listing by slug-or-id; {@code 404} if it isn't the caller's (contract {@code getMyListing}). */
    @Transactional(readOnly = true)
    public Property getMine(UUID userId, String idOrSlug) {
        return resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /**
     * The owner confirms a listing is genuinely still available (V86, contract
     * {@code confirmListingAvailable}). Stamps {@code lastConfirmedAt = now}, which is the whole
     * write — the freshness state is derived from it on every read, so an owner who has gone
     * dormant is back to active the instant they answer, with nothing to sweep or recompute.
     *
     * <p><strong>What this deliberately does not touch.</strong> Not {@code status}: confirming
     * availability is not a moderation event and must not send a live listing back to {@code
     * pending}. Not {@code recheckRequestedAt}: an owner saying "still available" says nothing
     * about the price change a moderator is queued to look at, and clearing the queue entry here
     * would let any owner dismiss their own re-check with one tap. Not {@code archived}: a
     * confirmation is not a restore, and an archived listing that answers the nudge would otherwise
     * silently return to search.
     *
     * <p>No audit entry either, unlike its neighbours. Archive and restore are recorded because
     * they are contestable — somebody took a listing down and the platform may be asked who. A
     * confirmation is self-reported by the only person entitled to report it, and its own timestamp
     * is the record; an audit row would double the write volume of the single most-repeated owner
     * action on the platform to store what the column already says.
     *
     * <p>Idempotent: confirming an already-fresh listing is allowed and simply re-stamps. The owner
     * cannot see which of their listings the badge currently considers stale, and the dashboard's
     * "confirm all" would otherwise need to ask.
     */
    @Transactional
    public Property confirmAvailable(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        p.confirmAvailable(Instant.now());
        return properties.save(p);
    }

    /**
     * Take the caller's own listing down (contract {@code archiveListing}).
     *
     * <p>Soft, because the row is not only the owner's: enquiries, deals and moderation history all
     * point at it, and the catalogue already filters on the flag this sets. Idempotent — archiving
     * an archived listing is the state the caller asked for, and a second click on a slow connection
     * should not be an error.
     *
     * <p>The reason is the server's, not the client's. There is one thing this route means and a
     * free-text field would only give a client somewhere to put a string nobody reads back.
     */
    @Transactional
    public Property archive(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (!p.isArchived()) {
            p.archive("Taken down by the owner");
        }
        return properties.save(p);
    }

    /**
     * Create a listing (contract {@code createListing}). The trust-critical fields are server-set:
     * {@code status = pending}, {@code owner} = the authenticated caller (loaded, not a client id),
     * {@code postedByType = owner}, and {@code priceUnit} derived from the deal (buy → total,
     * rent → per-month). The listing therefore cannot be born approved or attributed to someone else.
     */
    @Transactional
    public Property create(UUID userId, ListingCreate in) {
        requireListingAllowance(userId);
        User owner = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("Owner"));
        Property p = new Property(owner, in.title(), in.deal(), in.propertyType(),
                in.price(), in.locality(), in.city());
        // Everything the client may say. PropertyMapper's allowlist decides what that is, so the
        // "deliberately absent" set in ListingCreate's Javadoc is enforced rather than described.
        propertyMapper.applyTo(in, p);
        p.setSocietySlug(editRules.requireSociety(in.societyId()));

        // Everything it may not. These three are why a listing cannot be born approved or
        // attributed to someone else.
        p.setStatus(PropertyStatus.PENDING);
        p.setPostedByType(Roles.Wire.OWNER);
        p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
        /* Inherited, not claimed. `owner_verified` is denormalised onto the listing because buyers
         * and the ranking read it there, so it has to be stamped at both ends: the verification
         * webhook back-fills existing listings, and this stamps new ones. Without this half, an owner
         * who verified last month and posts today gets a listing that tells buyers they are
         * unverified — and the webhook cannot fix it, because a replayed DigiLocker success is
         * deliberately a no-op on an already-verified row. Read from the owner rather than accepted
         * from the client: it is a trust signal, so the only safe source is the one the client cannot
         * reach. */
        p.setOwnerVerified(owner.isAadhaarVerified());
        // After the mapper: the resolver's geo fallback needs lat/lng, which it has just set. Null
        // is an accepted outcome — see LocalityResolver — and simply leaves the listing out of
        // locality facets until curated.
        p.setLocalitySlug(localities.resolve(in.locality(), in.lat(), in.lng()));
        duplicates.reindex(p);
        properties.saveAndFlush(p);
        duplicates.flag(p);
        return p;
    }

    /**
     * Refuse a post that would put the owner over their freemium ceiling.
     *
     * <p><strong>Until now this rule only existed in the browser, which meant it did not exist.</strong>
     * The wizard compared a count of the listings that browser's {@code localStorage} held against a
     * ceiling the same browser computed, so an owner who posted from a laptop and opened the wizard
     * on a phone was measured as having posted nothing. The client now reads both numbers from the
     * server, but a number the client reads is a number the client can skip, and this endpoint is
     * reachable without the wizard at all.
     *
     * <p>Checked before anything is loaded or written, so a refused post leaves no half-built row and
     * no duplicate-probe entry behind.
     */
    private void requireListingAllowance(UUID userId) {
        int allowance = allowances.listingAllowance(userId);
        long held = properties.countOccupyingListingSlots(userId, PropertyStatus.OCCUPIES_LISTING_SLOT);
        if (held >= allowance) {
            throw new ListingQuotaExhaustedException(
                    "You already have " + held + " of " + allowance + " listings live. "
                    + "Take one down, upgrade your plan, or refer an owner to earn another slot.");
        }
    }

    /**
     * "Have I already listed this?" (contract {@code checkOwnDuplicate}) — asked by the wizard before
     * it submits, answered against the caller's own listings only.
     *
     * <p>The comparison key is derived here, from the address as typed, by the same two calls
     * {@link #create} makes a few lines above: {@link LocalityResolver#resolve} then
     * {@link ListingDuplicateProbe#reindex}'s {@link AddressKey}. That is the point of the endpoint
     * existing at all — the client used to compute its own notion of "same property" and match it
     * against whatever listings its browser happened to be holding, so it could stop a real owner
     * over a demo fixture and then offer to edit an id the server had never issued. Deriving the key
     * on the same code path the create will take means the pre-check and the write cannot disagree.
     *
     * <p>Read-only, and it writes nothing: the {@link Property} below is a scratch value built only
     * to reach the derivation, never persisted, and it carries no owner because nothing here needs
     * one.
     */
    @Transactional(readOnly = true)
    public ListingDuplicateVerdict duplicateCheck(UUID userId, ListingDuplicateCheck in) {
        String localitySlug = localities.resolve(in.locality(), in.lat(), in.lng());
        String addressKey = AddressKey.of(in.address(), in.city(), in.locality());
        return duplicates.ownDuplicate(userId,
                // Blank to null, which is the one difference from what create stores — and it is a
                // guard rather than a normalisation. `= ''` is a match in SQL where `= null` is not,
                // so a caller that sends an empty meter would otherwise collide with every listing
                // that also has one. The http client drops the field instead of sending "", so this
                // only ever fires for a caller that is not the wizard.
                StringUtils.hasText(in.electricityMeterNo()) ? in.electricityMeterNo() : null,
                addressKey, localitySlug);
    }

    /**
     * Partial update of an owned listing (contract {@code updateListing}). Only non-null fields are
     * applied (PATCH). A foundation-field change earns a re-review either way; which one it earns is
     * the split documented on this class (Q14) — an identity change reverts to {@code pending} and
     * leaves search, an attribute change raises a re-check and stays live. Non-foundation edits
     * (photos, description, deposit, …) leave both untouched.
     *
     * <p>When one PATCH does both, the revert wins and no re-check is raised: a full re-moderation
     * looks at the whole listing, so queueing the attribute change separately would put the same
     * edit in front of a moderator twice.
     *
     * <p>Either outcome also posts a line into the owner's verification thread saying what happened
     * and why. That sentence used to be composed in the browser and written to localStorage, which
     * meant the owner's own explanation for why their listing had gone dark lived on one machine and
     * the ops desk — the people who would have to answer for it — never saw it at all.
     */
    @Transactional
    public Property update(UUID userId, String idOrSlug, ListingUpdate in) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        List<Object> signalBefore = duplicates.signalOf(p);
        EditImpact impact = editRules.apply(p, in);
        duplicates.reindex(p);
        if (impact.remoderationRequired()) {
            p.revertToPending();
            caseNotes.post(p.getId(), p.getDeal(),
                    "You changed something fundamental about this listing, so it has gone back "
                    + "for review and is off search until a moderator approves it. We usually get to "
                    + "these within a day.");
        } else if (impact.recheckOnly()) {
            String deskItemBefore = p.getRecheckReason();
            p.requestRecheck(impact.rechecked());
            /* Branch on the work item the domain actually raised, not on the impact that asked for
             * one. requestRecheck refuses on a listing that is not publicly visible, because "stays
             * live" means nothing for a listing that is already off search and already in front of a
             * moderator. Posting the note regardless told the owner of a pending listing that it was
             * live, and opened a case file with no work item behind it. Reading the outcome rather
             * than re-testing isPubliclyVisible() keeps one copy of that rule, in the entity.
             *
             * And post only when that work item actually moved. requestRecheck merges this edit's
             * fields into the set already under re-check, so an unchanged set means the desk has
             * nothing new to look at and the owner has already been told. Without this, one owner
             * looping PATCH {price: 41000} / {price: 41001} wrote a review_messages row per request
             * and bumped lastMessageAt, which is the desk queue's sort key — roughly 7k messages an
             * hour, permanently pinned at rank 1 of findAllForDesk, bounded only by the global
             * 120/min write limiter. Comparing the merged set rather than suppressing repeats
             * outright keeps the note for the case that deserves one: an owner who edited price
             * yesterday and area today is told about the area. */
            if (p.getRecheckRequestedAt() != null
                    && !Objects.equals(deskItemBefore, p.getRecheckReason())) {
                caseNotes.post(p.getId(), p.getDeal(), "You updated: "
                        + String.join(", ", impact.rechecked())
                        + ". Your listing stays live \u2014 our team is re-checking these details and will "
                        + "confirm shortly.");
            }
        }
        /* Re-probe only when the edit actually moved one of the signals. Probing on every PATCH
         * would re-post the same warning every time an owner touched their description; probing
         * never would leave the obvious evasion open, since an owner can be approved at one address
         * and then edit their way onto somebody else's.
         *
         * Last, after the status has settled, because the note quotes it. An approved listing whose
         * PATCH both moves a signal and changes an identity field is pending by the time this
         * transaction commits, and a note written before the revert would tell a moderator the
         * listing is "already live -- decide whether it should stay up" about a listing that is not.
         * The dedupe makes the ordering matter twice over: postInternalOnce compares message bodies,
         * so the same collision described once as approved and once as pending is two notes for one
         * finding. */
        if (!duplicates.signalOf(p).equals(signalBefore)) {
            duplicates.flag(p);
        }
        return p;
    }

    /**
     * Field-level correction of <em>anyone's</em> listing by staff or admin (contract
     * {@code adminUpdateProperty}, {@code PATCH /properties/&#123;id&#125;/admin}).
     *
     * <p><strong>A moderator edit does not revert the listing to pending</strong>, and that is the
     * one behavioural difference from {@link #update}. Re-moderation exists so that a change made by
     * the owner is seen by a moderator before it goes live; here the moderator <em>is</em> the
     * change. Reverting would push their own correction into their own queue, so fixing a typo in an
     * approved listing would take it off the site until somebody re-approved it — and the natural
     * response to that is to stop correcting listings.
     *
     * <p>Audited, unlike the owner path. This is a write to a row belonging to someone else who will
     * never be told it happened, so "who changed my price" needs an answer that is not "nobody knows".
     *
     * <p>Lives here rather than in {@code moderation} because the body is {@code ListingUpdate} —
     * every field of {@code ListingCreate}, made optional — and a second copy of that mapping would
     * be a second place for a field to be forgotten. The moderation controller has said so since
     * slice 6; this is that comment being honoured.
     */
    @Transactional
    public Property updateAsModerator(AuthPrincipal principal, String idOrSlug, ListingUpdate in) {
        UUID id = parseUuid(idOrSlug);
        Property p = (id != null ? properties.findById(id) : properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        editRules.apply(p, in);
        // The key is recomputed so this listing stays findable by a *later* probe, but no probe is
        // run on this edit and that asymmetry with update() is deliberate. The duplicate note exists
        // to get a human to look; here a human is already looking, and is the one making the change.
        // Filing them a work item about their own correction is the same mistake as reverting their
        // own edit into their own queue, which the paragraph above explains at length.
        duplicates.reindex(p);
        audit.record(principal, "property.adminUpdate", "property", p.getId().toString(),
                "owner", p.getOwner() == null ? null : p.getOwner().getId().toString());
        return p;
    }

    /** Owner-scoped resolve (UUID → id, else slug); empty for a row the caller doesn't own. */
    private Optional<Property> resolveOwned(UUID userId, String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        return id != null
                ? properties.findByIdAndOwner_Id(id, userId)
                : properties.findBySlugAndOwner_Id(idOrSlug, userId);
    }

    /** Slug-or-id parse, shared semantics with the public read service. */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }
}
