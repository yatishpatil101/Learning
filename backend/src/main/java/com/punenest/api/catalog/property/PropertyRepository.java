package com.punenest.api.catalog.property;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data access for {@link Property}. Extends {@link JpaSpecificationExecutor} so the public
 * search composes its facets as a {@link org.springframework.data.jpa.domain.Specification}
 * ({@link PropertySpecs}) rather than a combinatorial explosion of derived-query methods — the
 * predicate it builds (forced {@code archived=false AND status='approved'} + the equality/range
 * facets) is exactly what the partial {@code idx_properties_search} covers.
 *
 * <p>The detail/owner-scoped finders pull the owner via an {@link EntityGraph} so the owner summary
 * is initialized inside the service transaction — the DTO can be mapped at the controller edge
 * without a lazy-load blowing up, and without an N+1 across a page of listings.
 */
public interface PropertyRepository
        extends JpaRepository<Property, UUID>, JpaSpecificationExecutor<Property> {

    /** By-id with the owner eagerly attached, for the public detail projection. */
    @Override
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findById(UUID id);

    /** By-slug with the owner attached — the contract path param accepts a slug or id. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlug(String slug);

    /**
     * Does a direct link to this listing resolve for an anonymous caller? The existence-check form of
     * {@link Property#isDirectlyReachable()}, for public reads that only need 404-or-not.
     *
     * <p>Pass {@link PropertyStatus#DIRECTLY_REACHABLE}. Deliberately not {@code existsById}: that
     * answers "is there a row", which is a different and more generous question. A public endpoint
     * asking it becomes an existence oracle — someone holding a UUID from a cached page or an old
     * sitemap gets a 404 from the detail route and a 200 here, which tells them a listing moderation
     * rejected, or an owner archived, is still on file. No {@link EntityGraph}, no hydration: this is
     * an index probe, so applying the floor costs nothing over the check it replaces.
     */
    boolean existsByIdAndArchivedFalseAndStatusIn(UUID id, Collection<String> statuses);

    /** Owner-scoped single fetch by id (returns empty for another owner's row → 404, never a leak). */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findByIdAndOwner_Id(UUID id, UUID ownerId);

    /** Owner-scoped single fetch by slug. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlugAndOwner_Id(String slug, UUID ownerId);

    /**
     * Load a listing for an ops write against its verification state, holding a row lock until the
     * transaction commits (D202).
     *
     * <p>Granting the ownership badge is check-then-act: read the evidence, decide whether the gate
     * is clear, and write {@code ownership_verified*} — and the write is conditional on what the
     * read saw, including whether the listing was <em>already</em> verified. Two ops users acting at
     * the same moment both read "not yet verified", both grant, and both announce; the referral
     * credit downstream is only saved from paying twice by a second lock of its own
     * ({@code ReferralRepository#findPendingForQualification}), which is a guarantee this path
     * should not be borrowing. The lock makes the read and the write one step, so the second caller
     * sees the first one's decision.
     *
     * <p>No {@link EntityGraph} here on purpose: {@code select ... for update} and an outer join do
     * not mix in PostgreSQL, and the owner is reachable lazily inside the same transaction.
     *
     * <p><strong>Lock order: {@code properties} then {@code referrals}, never the reverse.</strong>
     * Granting the badge announces inside the same transaction, and the announcement takes a
     * pessimistic lock on {@code referrals}. Nothing today locks a referral and then reaches a
     * listing, so the order is acyclic — but it is a two-lock protocol now, and it is only visible
     * by reading three files. An ops feature that decides a referral and then touches its property
     * closes the cycle.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Property p where p.id = :id")
    Optional<Property> findForVerificationDecision(@Param("id") UUID id);

    /** The caller's own listings (all statuses incl. archived), owner-scoped; hits idx_properties_owner. */
    @EntityGraph(attributePaths = "owner")
    Page<Property> findByOwner_Id(UUID ownerId, Pageable pageable);

    /**
     * Just the ids of an owner's listings — the key set the contacts feature needs to scope an owner's
     * inbox, since {@code contact_requests} has no {@code owner_id} column of its own.
     *
     * <p>A projection rather than {@code findByOwner_Id(...).map(Property::getId)} because the caller
     * wants none of the 40-odd listing columns and none of the owner graph; this is an index-only read
     * against {@code idx_properties_owner}.
     */
    @Query("select p.id from Property p where p.owner.id = :ownerId")
    List<UUID> findIdsByOwnerId(@Param("ownerId") UUID ownerId);

    /**
     * Listings by <em>other</em> owners that look like the same unit as the one being written (V79).
     *
     * <p>Two independent signals, OR'd, because they fail in opposite directions and neither is
     * available on every listing:
     *
     * <ul>
     *   <li>the electricity meter number — near-certain when both sides have one, and most do not;</li>
     *   <li>normalised address within a locality — the one that fires when the meter is null, which
     *       is the common case. See {@link AddressKey} for what "normalised" means.</li>
     * </ul>
     *
     * <p><strong>Why there is no society arm.</strong> {@code (society_id, floor, bhk)} is the
     * highest-precision signal available for flats, and it was here, and it had to come out. The
     * reason is that {@code society_id} is <em>asserted by the client</em> on create and update.
     * There is a foreign key, so the id has to name a society that exists — but that is a check on
     * the id, not on the claim, and nothing links an owner to the society they name. Every real
     * society in Pune is an id an attacker may legitimately supply. Feed the probe one with a floor
     * and a BHK and the flag it raises tells you whether that unit is listed — including listings
     * still {@code pending}, which no public route will admit exist. Repeat, and you have a
     * unit-by-unit census of the building. A signal an attacker can supply in full is not a signal
     * about the world; it is a query. Bring it back when an owner has to prove they belong to a
     * society before naming it, and the arm becomes what its precision suggests.
     *
     * <p><strong>Absent signals match nothing, and no guard is needed to make that true.</strong>
     * The obvious worry is that a listing with no meter number matches every other listing with no
     * meter number. It does not: SQL equality against {@code NULL} is <em>unknown</em>, never true,
     * so an arm whose parameter is null simply drops out of the OR. Explicit {@code :param is not
     * null} guards were tried here and removed — they read as load-bearing while doing nothing, and
     * a guard that cannot fail is worse than no guard, because the next reader trusts it. What this
     * does depend on is every arm staying a plain {@code =}; a {@code coalesce} added later to
     * "handle nulls" would turn absence into a match. {@code ListingNoticesTest} holds that line.
     *
     * <p><strong>Only other owners, and only live listings.</strong> {@code owner.id <> :ownerId}
     * because the same person listing their own flat twice is a housekeeping mistake, not fraud, and
     * flagging it to ops teaches them to ignore the flag. Rejected and archived listings are
     * excluded because a duplicate of something already taken down is not a live conflict.
     *
     * <p>Capped by the caller via {@link Pageable}: the answer to "is this a duplicate" needs one
     * row, and the ops note names a couple. An unbounded {@code List} here is one bad address key
     * away from loading a locality into memory.
     *
     * <p><strong>Deliberately unordered.</strong> Both OR arms are backed by their own partial index
     * (V79), which Postgres combines with a bitmap OR — but only while it is free to return rows in
     * whatever order it finds them. Adding {@code order by p.created_at} makes an ordered walk of
     * {@code properties} the cheapest way to produce the first two rows, so the common case, a
     * create that matches nothing, scans the whole table before answering "no". Every create and
     * every signal-changing edit would pay it. The caller sorts the couple of rows it gets back,
     * which is where sorting two things belongs.
     */
    @Query("""
            select p from Property p
            where p.owner.id <> :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    p.electricityMeterKey = :meter
                 or (p.addressKey = :addressKey and p.localitySlug = :localitySlug)
              )
            """)
    List<Property> findDuplicateCandidates(
            @Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses,
            @Param("meter") String meter,
            @Param("addressKey") String addressKey,
            @Param("localitySlug") String localitySlug,
            Pageable pageable);

    /**
     * The same question turned around: listings by <em>this</em> owner that look like the same unit.
     * Answers "have I already listed this?" for the wizard, before it lets an owner post the flat
     * they posted last month.
     *
     * <p>Every clause is deliberately identical to {@link #findDuplicateCandidates} except the
     * direction of the owner comparison — same two OR'd arms, same plain {@code =} on each (a
     * {@code coalesce} would make absence match absence here too), same {@code archived = false},
     * same caller-supplied status set, same absence of an {@code ORDER BY} so the partial indexes
     * keep their bitmap-OR plan. Two readings of one rule about what counts as the same doorway; if
     * they ever disagree, the platform blocks owners on a definition it does not flag strangers on.
     *
     * <p>Both live behind the same {@code owner_id} predicate the caller is authenticated as, so
     * unlike its sibling this one can be answered <em>to</em> the person asking: every row it can
     * possibly return is already on their own dashboard.
     */
    @Query("""
            select p from Property p
            where p.owner.id = :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    p.electricityMeterKey = :meter
                 or (p.addressKey = :addressKey and p.localitySlug = :localitySlug)
              )
            """)
    List<Property> findOwnDuplicateCandidates(
            @Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses,
            @Param("meter") String meter,
            @Param("addressKey") String addressKey,
            @Param("localitySlug") String localitySlug,
            Pageable pageable);

    /**
     * Recently created listings that carry something for the duplicate probe to compare — the input
     * to the catch-up sweep.
     *
     * <p><strong>Why a sweep exists at all.</strong> {@link #findDuplicateCandidates} runs inside
     * the transaction that creates the listing, under {@code READ COMMITTED}, so it cannot see a
     * sibling submission that has not committed yet. Two identical listings posted in the same
     * second therefore each read a world without the other and neither is flagged — which is the
     * precise shape of the abuse the probe exists to catch, since a broker uploading one flat twice
     * does it from a script, not by hand a day apart.
     *
     * <p>The window is deliberately generous relative to the sweep's period, so that a listing is
     * re-read a couple of times rather than exactly once: a sweep tick that dies mid-run, or a
     * deploy that lands between two ticks, would otherwise leave a permanent hole in coverage at a
     * cost of one indexed range scan.
     *
     * <p>The signal predicate is the same early-out {@code ListingDuplicateProbe#flag} applies for
     * itself, hoisted into SQL: most listings carry none of the three signals, and fetching them
     * only to return immediately would make the sweep's cost the create rate rather than the rate of
     * listings it can actually say something about. It is {@code electricity_meter_key} rather than
     * {@code electricity_meter_no} (V115) because the key is what the arm compares — a meter too
     * short to normalise leaves the raw column set and the key null, and such a listing is not
     * something the sweep can say anything about. The photo clause is V116's: a listing whose only
     * signal is its photographs is exactly the pair this sweep exists for, since two owners posting
     * the same pictures in the same second is the race, and without it those listings would never be
     * re-read.
     *
     * <p><strong>The ordering is load-bearing, unlike {@link #findDuplicateCandidates}'s absence of
     * one.</strong> There the result is capped at two rows and order is genuinely irrelevant. Here
     * the caller passes a per-tick ceiling, and an unordered page under a stable plan returns the
     * <em>same</em> arbitrary subset every tick — so once the window holds more listings than the
     * ceiling (a bulk import, a seed backfill, a launch-day spike) the remainder is never swept and
     * then ages out of the window forever. Oldest-first makes the overflow a backlog the next tick
     * inherits rather than rows that are silently dropped, and the only symptom of getting this
     * wrong would have been a log line that reads like a queue catching up.
     *
     * <p>There is no index on {@code created_at}; the plan is a bitmap-OR over the signal indexes
     * with the window applied as a filter, so cost tracks the total number of signal-carrying
     * listings rather than the window. That is fine at this size and is the thing to look at first
     * if this ever shows up in slow-query logs.
     */
    @Query("""
            select p from Property p
            where p.createdAt >= :since
              and p.archived = false
              and p.status in :statuses
              and (p.electricityMeterKey is not null
                or p.addressKey is not null
                or exists (select 1 from PropertyPhotoHash h where h.propertyId = p.id))
            order by p.createdAt asc
            """)
    List<Property> findRecentSignalCarrying(
            @Param("since") Instant since,
            @Param("statuses") Collection<String> statuses,
            Pageable pageable);

    /**
     * Every listing that carries a duplicate signal at all — the input to the ops desk's clustering
     * read (D255).
     *
     * <p>{@link #findRecentSignalCarrying} without the window. The two exist separately rather than
     * one calling the other with {@code Instant.EPOCH} because they are asked different questions:
     * the sweep asks "what has changed lately", this asks "what does the whole catalogue currently
     * look like". Sharing a method would mean the sweep's ordering and this one's could never differ,
     * and they must — see below.
     *
     * <p>The signal predicate is copied verbatim from the sweep on purpose. Both are the SQL form of
     * {@code ListingDuplicateProbe#flag}'s early-out, and if they ever disagree the desk would be
     * clustering a different population than the probe flags, which is the failure the probe's own
     * javadoc warns about in a different register: two readings of one rule.
     *
     * <p><strong>Newest-first, and the caller must treat a full page as truncation.</strong> The
     * sweep orders oldest-first so its overflow becomes the next tick's backlog. Nothing inherits
     * this read's overflow — an operator runs it, sees what it returns, and acts. Newest-first is
     * the desk's own reading order, so the rows that fall off the end are the oldest.
     *
     * <p>That cut is more dangerous here than a truncated list normally is, because clustering is
     * <em>pairwise</em>: if the ceiling falls between two members of a genuine pair, the survivor is
     * not shown as a partial cluster, it is shown as nothing at all. A silently-dropped duplicate
     * looks exactly like a clean catalogue. {@link com.punenest.api.moderation.duplicate
     * .ListingDuplicateClusterService} therefore reads one row past its own ceiling and reports the
     * overflow to the operator rather than deciding on their behalf that it did not matter.
     */
    @Query("""
            select p from Property p
            where p.archived = false
              and p.status in :statuses
              and (p.electricityMeterKey is not null
                or p.addressKey is not null
                or exists (select 1 from PropertyPhotoHash h where h.propertyId = p.id))
            order by p.createdAt desc
            """)
    List<Property> findSignalCarrying(
            @Param("statuses") Collection<String> statuses,
            Pageable pageable);

    /**
     * Stamp {@code owner_verified} onto every listing an owner holds — the write that makes the
     * identity badge visible to buyers, called when DigiLocker confirms.
     *
     * <p><strong>Every listing, deliberately.</strong> No {@code status} filter and no
     * {@code archived} filter: the badge belongs to the <em>owner</em>, not to any one listing's
     * lifecycle. A pending listing owned by a verified person has a verified owner, and an archived
     * one must not come back from restore claiming otherwise.
     *
     * <p>A bulk update rather than a read-modify-write loop because the caller wants none of the
     * forty-odd listing columns and none of the owner graph; it is also the only form that stays one
     * statement for an owner with a large portfolio.
     *
     * <p><strong>{@code clearAutomatically} is not optional here.</strong> A bulk update runs as SQL
     * and the persistence context never hears about it, so any {@link Property} already managed in
     * the same transaction keeps serving the pre-update value from the first-level cache. That is
     * invisible in production, where the webhook transaction has no listing attached — and fatal in
     * the tests, which are {@code @Transactional} and hold the very rows they are about to assert on.
     * A version without this reads {@code false} straight after a successful write. {@code flush}
     * pairs with it so pending changes are not lost to the clear.
     *
     * @return how many listings were stamped — zero for a verified user who owns nothing
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = true where p.owner.id = :ownerId and p.ownerVerified = false")
    int markOwnerVerified(@Param("ownerId") UUID ownerId);

    /**
     * Withdraw the denormalised owner badge from every listing this owner holds.
     *
     * <p>The exact mirror of {@link #markOwnerVerified}, down to the absence of a {@code status} or
     * {@code archived} filter and the {@code clearAutomatically}/{@code flushAutomatically} pair —
     * both are load-bearing for the same reasons documented there, and diverging them would leave
     * one direction correct and the other subtly not.
     *
     * @return how many listings were cleared — zero for an owner who owns nothing
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Property p set p.ownerVerified = false where p.owner.id = :ownerId and p.ownerVerified = true")
    int markOwnerUnverified(@Param("ownerId") UUID ownerId);

    /**
     * Featured-first live listings for the homepage strip. Featured desc puts {@code true} ahead of
     * {@code false}; the {@link Pageable} caps the result (the contract endpoint takes no limit).
     * Summary projection only, so no owner graph.
     */
    List<Property> findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
            String status, Pageable limit);

    /**
     * Live listings for one society, newest first — the {@code homes} array on the society hub.
     * Summary projection, so no owner graph and no contact data.
     */
    List<Property> findBySocietyIdAndStatusAndArchivedFalseOrderByCreatedAtDesc(
            UUID societyId, String status, Pageable limit);

    /**
     * The same, over a society and everything an operator merged into it (V111).
     *
     * <p>A merge moves nothing: a listing filed under the duplicate keeps pointing at the duplicate,
     * so the survivor's hub finds it only by asking for the whole family. Without this the merge
     * would take those listings off both pages — the duplicate's, because it is no longer reachable,
     * and the survivor's, because it never referenced them — which is a worse outcome than the
     * duplicate the operator merged to fix.
     *
     * <p>The single-society method above is kept rather than replaced. Its callers pass one id and
     * mean one id, and widening them all to a singleton list to save a derived-query declaration
     * would make every call site read as though it might be doing something it is not.
     */
    List<Property> findBySocietyIdInAndStatusAndArchivedFalseOrderByCreatedAtDesc(
            Collection<UUID> societyIds, String status, Pageable limit);

    /**
     * Live-listing counts grouped by locality slug — the whole catalogue in one query.
     *
     * <p><strong>Why counts are computed and not stored.</strong> {@code localities.listing_count}
     * (and its siblings on {@code societies} and {@code cities}) exists in the schema and has never
     * had a writer. At the time slice 7 was planned, three of fifteen rows already disagreed with
     * reality — and the disagreement was not drift: the stored number counts <em>every</em>
     * property, while every surface that displays it means approved and unarchived ones. A stale
     * counter can be refreshed; a counter that measures the wrong thing was wrong the day it was
     * written.
     *
     * <p>One grouped aggregate per list endpoint, never one count per row. On a catalogue of tens of
     * localities this is cheaper than the join it replaces, and — unlike a stored column — it cannot
     * be wrong.
     *
     * @return rows of {@code [localitySlug, count]}; localities with no live listing are absent
     */
    @Query("""
            select p.localitySlug, count(p)
            from Property p
            where p.status = :status and p.archived = false and p.localitySlug is not null
            group by p.localitySlug""")
    List<Object[]> countLiveByLocalitySlug(@Param("status") String status);

    /** Live-listing counts grouped by society id. See {@link #countLiveByLocalitySlug}. */
    @Query("""
            select p.societyId, count(p)
            from Property p
            where p.status = :status and p.archived = false and p.societyId is not null
            group by p.societyId""")
    List<Object[]> countLiveBySocietyId(@Param("status") String status);

    /** Live-listing counts grouped by city name. See {@link #countLiveByLocalitySlug}. */
    @Query("""
            select lower(p.city), count(p)
            from Property p
            where p.status = :status and p.archived = false
            group by lower(p.city)""")
    List<Object[]> countLiveByCity(@Param("status") String status);

    /**
     * Live-listing count for a single locality.
     *
     * <p>The grouped queries above are right for a list endpoint and wrong for a detail one: a
     * detail read needs one number, and aggregating the whole catalogue to find it does work
     * proportional to the catalogue rather than to the answer.
     */
    long countByLocalitySlugAndStatusAndArchivedFalse(String localitySlug, String status);

    /** Live-listing count for a single society. See {@link #countByLocalitySlugAndStatusAndArchivedFalse}. */
    long countBySocietyIdAndStatusAndArchivedFalse(UUID societyId, String status);

    /**
     * Listings the resolver could not place — the curation queue (register item 24).
     *
     * <p>The exact complement of {@link #countLiveByLocalitySlug}, which filters these out. That is
     * the point: every read on the platform that groups, facets or routes by locality skips a null
     * slug, so these listings are invisible to locality search, {@code /locality/{slug}},
     * saved-search alerts and the society join. Nothing else in the codebase selects them, which is
     * why the queue that was supposed to clear them ran on one operator's {@code localStorage} and
     * nobody noticed it was empty.
     *
     * <p>{@code archived = false} because a soft-deleted listing needs no locality — curating one
     * would be work with no reader. Statuses are the caller's to choose so the two cases stay
     * distinguishable: {@code pending} is a listing a moderator is about to be stopped from
     * approving, {@code approved} is one that already went live invisible and is the more urgent
     * repair.
     *
     * <p>Oldest first, and capped by the caller: this queue is unbounded by nature — a geocoding
     * outage puts a day's listings in it at once — and a console that renders every row of an
     * unbounded set is one that stops loading on exactly the day it is needed.
     */
    @Query("""
            select p from Property p
            where p.localitySlug is null and p.archived = false and p.status in :statuses
            order by p.createdAt asc""")
    List<Property> findAwaitingLocality(@Param("statuses") Collection<String> statuses,
            Pageable limit);

    /** How many listings {@link #findAwaitingLocality} would return uncapped, for honest truncation. */
    @Query("""
            select count(p) from Property p
            where p.localitySlug is null and p.archived = false and p.status in :statuses""")
    long countAwaitingLocality(@Param("statuses") Collection<String> statuses);

    /**
     * How many listings this owner currently has live.
     *
     * <p>Counted rather than read from {@code users.listings_count}, which is the same trap as the
     * stored locality counters: that column counts every row this person has ever posted, including
     * the rejected and the archived, while every surface that shows the number means the ones a
     * visitor can actually open. The two have to disagree the moment a listing is taken down, and
     * the stored one disagrees silently.
     */
    long countByOwnerIdAndStatusAndArchivedFalse(UUID ownerId, String status);

    /**
     * How many of this owner's listings occupy a freemium slot.
     *
     * <p>Separate from {@link #countByOwnerIdAndStatusAndArchivedFalse} because the two answer
     * different questions and must be allowed to differ: that one counts what a visitor can open,
     * which is the number an owner profile shows; this one counts what the quota charges for, which
     * includes a listing still in the moderation queue. See
     * {@link PropertyStatus#OCCUPIES_LISTING_SLOT} for why each status is on the list.
     */
    @Query("""
            select count(p) from Property p
            where p.owner.id = :ownerId and p.archived = false and p.status in :statuses""")
    long countOccupyingListingSlots(@Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses);

    /**
     * The three homepage trust numbers over the live catalogue, optionally narrowed to one locality.
     *
     * <p><strong>Why one query rather than three counts.</strong> Unlike the admin scorecard, where
     * seven independent figures are deliberately left unbatched so each line can be read on its own,
     * these three are read together and are only meaningful together: a visitor is being told what
     * share of what they are looking at is verified. Three round trips could straddle a moderation
     * write and produce a "verified" count larger than the total it is a share of, which is the one
     * arithmetic a trust counter must never show.
     *
     * <p><strong>The ownership clause spells out the badge rather than reading the column.</strong>
     * {@link Property#isOwnershipVerified()} is derived — an ops verdict that lapses when its
     * evidence expires, with no write to the row — so {@code ownership_verified = true} alone counts
     * listings whose proof has run out and whose badge is already gone from the page. That is
     * exactly the divergence {@code Property} warns about, and the fix it prescribes: add
     * {@code ownershipVerifiedUntil > now} to the predicate, which is the same rule in the same
     * words. A null expiry means "does not lapse", not "lapsed", and is honoured here too.
     *
     * <p><strong>{@code verifiedOwners} counts people, not listings</strong> — hence
     * {@code count(distinct)} over the owner id. One owner with nine verified flats is one verified
     * owner, and counting rows instead would inflate the number precisely for the prolific poster a
     * visitor has least reason to trust on volume alone.
     *
     * @param status  the live status, always {@link PropertyStatus#APPROVED}
     * @param now     one reading of the clock, so the badge and the total cannot straddle an expiry
     * @param all     {@code true} for the whole catalogue; when {@code false}, {@code slug} narrows
     * @param slug    locality slug, ignored when {@code all}
     * @return exactly one row — an aggregate with no {@code group by} always returns one, even over
     *     no matches, so an unknown locality answers zeroes rather than nothing
     */
    @Query("""
            select new com.punenest.api.catalog.property.TrustTally(
                count(p),
                count(case when p.ownerVerified = true
                             or (p.ownershipVerified = true
                                 and (p.ownershipVerifiedUntil is null
                                      or p.ownershipVerifiedUntil > :now))
                           then 1 end),
                count(distinct case when p.ownerVerified = true then p.owner.id end))
            from Property p
            where p.status = :status
              and p.archived = false
              and (:all = true or p.localitySlug = :slug)""")
    TrustTally tallyTrust(
            @Param("status") String status,
            @Param("now") Instant now,
            @Param("all") boolean all,
            @Param("slug") String slug);

    /**
     * Count live listings matching a saved search's facets, optionally only those newer than a
     * baseline.
     *
     * <p>Two questions share one query on purpose. The sweep asks "how many are <em>new</em>?"
     * (D7) by passing the alert row's last update; the saved-search list asks "how many match
     * <em>now</em>?" (D227) by passing {@code null}. They are the same search read at two
     * moments, and a user who is told "3 new" on one screen and "14 match" on another is owed the
     * guarantee that the 3 are among the 14. Two queries would drift the moment either facet set
     * grew a field — and the facets are read out of a free-form jsonb blob, so nothing would fail
     * loudly when they did.
     *
     * <p>Counts rather than loads: neither caller wants the rows, and the sweep touches every alert
     * on the platform every thirty minutes.
     *
     * @param unbounded {@code true} drops the recency predicate entirely — that is what turns this
     *     into a live match count. A boolean flag rather than a null {@code baseline} because
     *     Postgres cannot infer the type of a bare {@code ? is null} and refuses to prepare the
     *     statement; the query already uses the same flag idiom for the two list facets. Callers
     *     must still pass a non-null {@code baseline}; it is simply not read when unbounded.
     * @param baseline exclusive lower bound on {@code createdAt}, read only when
     *     {@code unbounded} is false. A row with a null {@code createdAt} is excluded from the
     *     bounded reading (it cannot be shown to be newer) and counted by the unbounded one (it is
     *     still a live listing).
     */
    @Query("""
            select count(p)
            from Property p
            where p.status = :status
              and p.archived = false
              and (:unbounded = true
                   or (p.createdAt is not null and p.createdAt > :baseline))
              and (:deal is null or lower(p.deal) = :deal)
              and (:localitiesEmpty = true
                   or lower(coalesce(p.localitySlug, p.locality)) in :localities)
              and (:bhkEmpty = true or cast(p.bhk as integer) in :bhkValues)
            """)
    long countVisibleWithFilters(
            @Param("status") String status,
            @Param("unbounded") boolean unbounded,
            @Param("baseline") Instant baseline,
            @Param("deal") String deal,
            @Param("localitiesEmpty") boolean localitiesEmpty,
            @Param("localities") List<String> localities,
            @Param("bhkEmpty") boolean bhkEmpty,
            @Param("bhkValues") List<Integer> bhkValues);
}
