package com.draazy.api.catalog.listing;

import static com.draazy.api.common.PlatformTime.IST;

import com.draazy.api.catalog.property.AddressKey;
import com.draazy.api.catalog.property.MeterKey;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPhotoHash;
import com.draazy.api.catalog.property.PropertyPhotoHashRepository;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.trust.ListingCaseNotes;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Notices when a listing looks like a unit somebody else has already listed, and tells the ops desk
 * (D218).
 *
 * <p><strong>Why this is its own service and not three methods on {@code ListingService}.</strong>
 * It is a different use case with a different reason to change: {@code ListingService} answers "may
 * this owner write this listing, and what does the edit cost them", while this answers "does the
 * platform already know about this doorway". The signals it compares, the wording of its finding and
 * the desk that reads it will all move without the write path moving — and it owns its own columns
 * ({@code address_key}, and the derivation that fills it) rather than borrowing the listing's.
 *
 * <p><strong>What it deliberately does not do: refuse the listing.</strong> A collision is a
 * suspicion, not a finding. Two owners genuinely share an address key when a bungalow is split into
 * two tenancies, when a society reuses flat numbers across wings, and every time {@link AddressKey}'s
 * normaliser is a little too eager. Refusing the submission would make an honest owner argue with a
 * string comparison, having been told by an error message that they are lying. Flagging it puts a
 * human in the loop before the listing is approved, which is the only party that can tell the two
 * cases apart.
 *
 * <p><strong>Why the finding is staff-only.</strong> The note names the other listing, because
 * "possible duplicate" with nothing to compare against is a work item that costs a moderator a
 * search before they can start. But the submitter can read their own verification thread, so an
 * owner-visible finding would answer the question the probe asks: submit a listing carrying a
 * guessed meter number, read the thread, and a note back means that meter is on the platform — and
 * says whose listing it is, including listings still pending that no public route will admit exist.
 * Hence {@link ListingCaseNotes#postInternalOnce}, and hence the owner seeing nothing but the
 * ordinary pending status every new listing gets.
 *
 * <p><strong>The society branch is designed and not built.</strong> {@code V79}'s comment says, in
 * the present tense, that "the society branch of the rule matches on (society, floor, bhk)" and
 * creates {@code idx_properties_society_unit} to serve it. No such branch exists: {@link #signalOf}
 * compares meter, address key and locality, and {@link #flag} queries on those three alone. Reading
 * V79 will tell you otherwise, which is the trap this paragraph exists to spring safely; {@code
 * V113} has since dropped the index, so the only thing left to mislead you is V79's prose.
 *
 * <p>The branch itself is still unbuilt rather than rejected, because choosing is a product call: a
 * society-scoped match on floor and BHK is a <em>much</em> looser signal than a meter number, so it
 * would file case notes on ordinary same-floor neighbours in any tower with more than one 2 BHK per
 * floor, and what that costs is moderator time. Written up in {@code tasks/todo.md} with both
 * options. If it is ever built it needs its index back.
 */
@Service
public class ListingDuplicateProbe {

    /**
     * A listing only conflicts with one that still occupies the address. Rejected, archived, sold
     * and rented ones have let it go.
     */
    private static final List<String> OCCUPYING =
            List.of(PropertyStatus.PENDING, PropertyStatus.APPROVED);

    /**
     * How many band hits one create is willing to look at.
     *
     * <p>Larger than the two the doorway arm takes, because these are candidates rather than
     * findings: most of what band equality returns is not a duplicate, and a cap of two would let a
     * pair of chance collisions hide the real one. Small enough that a hash sharing a band with
     * something popular cannot pull a catalogue into memory on an unrelated owner's submission.
     */
    private static final int PHOTO_CANDIDATE_CAP = 200;

    private final PropertyRepository properties;
    private final PropertyPhotoHashRepository photoHashes;
    private final ListingCaseNotes caseNotes;

    public ListingDuplicateProbe(PropertyRepository properties,
            PropertyPhotoHashRepository photoHashes, ListingCaseNotes caseNotes) {
        this.properties = properties;
        this.photoHashes = photoHashes;
        this.caseNotes = caseNotes;
    }

    /**
     * Re-derive the comparison keys from the address and meter as they now stand.
     *
     * <p>Called on every write rather than only when the address field is in the patch, because the
     * key is also built from the city and locality columns — an edit that moves the listing to
     * another locality changes what its address means without touching the address text.
     *
     * <p>Both keys are derived here, in one method, because this is the only place either of them is
     * allowed to be written and having one hook is what makes that checkable. The callers already
     * bracket their edits with {@link #signalOf} on both sides of this call, so a key added here is
     * automatically covered by the "did the signal move" test that decides whether to re-probe.
     */
    public void reindex(Property p) {
        p.setAddressKey(AddressKey.of(p.getAddress(), p.getCity(), p.getLocality()));
        p.setElectricityMeterKey(MeterKey.of(p.getElectricityMeterNo()));
    }

    /**
     * Everything the probe compares, as one value that can be held across an edit.
     *
     * <p>A {@code List} of the typed values rather than a joined string, because a {@code |}
     * occurring inside a meter number or an address key let two genuinely different states compare
     * equal, silently skipping the probe. {@code List.equals} is element-wise and typed, so that is
     * not expressible — and it stays true if a numeric signal is ever added, where a joined string
     * would also have made {@code 2} and {@code 2.0} two different signals for one unchanged value.
     */
    public List<Object> signalOf(Property p) {
        return Arrays.asList(p.getElectricityMeterKey(), p.getAddressKey(), p.getLocalitySlug());
    }

    /**
     * Look for an active listing by another owner at what looks like the same doorway, and open a
     * staff-only case note if there is one.
     *
     * <p>{@code MANDATORY}: the finding must commit with the listing write that provoked it. A work
     * item pointing at a submission that rolled back is worse than no work item, because a moderator
     * cannot tell the difference from the queue.
     *
     * <p>The caller must have flushed first, so the new row has an id and cannot match itself. The
     * query already filters {@code owner.id <> :ownerId}, which covers the same-owner case; the
     * flush is for the case file, which is keyed by property id.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void flag(Property p) {
        flagSameDoorway(p);
        flagSamePhotos(p);
    }

    /**
     * Replace the stored perceptual hashes of a listing's photographs.
     *
     * <p>Separate from {@link #reindex} even though both derive comparison keys, because the two run
     * at different moments and from different inputs. {@code reindex} works off columns already on
     * the entity and is called on every write; this needs the hashes off the request body, and a
     * request that does not mention photographs must leave the stored ones alone rather than clear
     * them — a PATCH that changes the rent is not a statement about the pictures.
     *
     * <p>Malformed hashes are dropped rather than rejected; see {@link PhotoHash#parse}. Duplicates
     * within one submission are collapsed, because the primary key is (property, hash) and the same
     * photograph uploaded twice is one piece of evidence.
     *
     * @return whether the stored set actually moved, which is what tells {@code update} to re-probe.
     *     Swapping the photographs is exactly how a listing becomes a duplicate without any of the
     *     values in {@link #signalOf} changing, so the address arm's "did the signal move" test
     *     cannot see it. Returning false on an unchanged set also keeps a PATCH that merely resends
     *     the same photographs from churning the rows and re-running the probe.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean reindexPhotos(Property p, List<String> hexes) {
        if (hexes == null) {
            return false;
        }
        Set<Long> parsed = new LinkedHashSet<>();
        for (String hex : hexes) {
            Long h = PhotoHash.parse(hex);
            if (h != null) {
                parsed.add(h);
            }
            if (parsed.size() >= PhotoHash.MAX_PER_LISTING) {
                break;
            }
        }
        Set<Long> stored = photoHashes.findByPropertyId(p.getId()).stream()
                .map(PropertyPhotoHash::getHash).collect(Collectors.toSet());
        if (stored.equals(parsed)) {
            return false;
        }
        photoHashes.deleteByPropertyId(p.getId());
        // Flushed before the inserts because the two statements touch the same primary key: a
        // photograph kept across an edit is deleted and re-inserted, and Hibernate orders inserts
        // before deletes within a flush unless told otherwise.
        photoHashes.flush();
        List<PropertyPhotoHash> rows = new ArrayList<>();
        for (Long h : parsed) {
            rows.add(new PropertyPhotoHash(p.getId(), h));
        }
        photoHashes.saveAll(rows);
        return true;
    }

    /** The certain arm: the same meter, or the same address in the same locality. */
    private void flagSameDoorway(Property p) {
        /* No signal, no query. Both arms are `= :param`, so a listing carrying neither a meter nor
         * an address key matches nothing by construction -- but it still costs a scan to prove it,
         * and neither partial index is usable with both parameters null. V79's own comment says most
         * listings carry no meter, so this is the common path, and it runs on every create and on
         * every signal-moving edit. */
        if (p.getElectricityMeterKey() == null && p.getAddressKey() == null) {
            return;
        }
        List<Property> hits = properties.findDuplicateCandidates(
                p.getOwner().getId(), OCCUPYING,
                p.getElectricityMeterKey(), p.getAddressKey(), p.getLocalitySlug(),
                // Two is enough to make the point. A third identical listing is the same finding,
                // and an unbounded read here is one over-eager address key away from loading a
                // locality into memory.
                PageRequest.of(0, 2));
        if (hits.isEmpty()) {
            return;
        }
        // Sorted, and that is load-bearing rather than tidy. The query deliberately carries no
        // ORDER BY — an ordered read on an uncovered column would cost the partial indexes their
        // bitmap-OR plan — so with three or more candidates Postgres may return a different pair
        // each time. Unsorted, the same finding renders as a different sentence per run, and
        // postInternalOnce, which dedupes on the sentence, would file it again on every edit.
        String others = hits.stream().map(ListingDuplicateProbe::describe).sorted()
                .collect(Collectors.joining("; "));
        caseNotes.postInternalOnce(p.getId(), p.getDeal(),
                "Possible duplicate. This listing (" + describe(p) + ") matches an active listing by"
                        + " another owner: " + others + ". " + nextStep(p));
    }

    /**
     * The fuzzy arm: somebody else's live listing is showing the same photographs.
     *
     * <p>This is the case the doorway arm is built to miss. A broker re-listing a flat retypes the
     * address — that is the entire point of retyping it — so the address key differs, the meter is
     * absent, and the two listings look unrelated to every exact comparison the platform has. What
     * they cannot easily change is the photographs, because the photographs are why the listing gets
     * clicks.
     *
     * <p><strong>It flags and never blocks, and that asymmetry is the design.</strong> A perceptual
     * hash match is evidence about pixels, not about who holds the mandate: two honest listings in
     * the same building genuinely do share a photograph of the lobby, the gym and the gate, and a
     * stock amenity image supplied by the builder can appear on every flat in the society. Refusing
     * a submission on that would refuse honest owners with no way to argue, which is the mistake the
     * whole class exists to avoid — see {@link #sweep}'s note on why there is no unique index.
     *
     * <p>Both the query and the verification are needed. The query is an index lookup over 16-bit
     * bands, which is fast and approximate; {@link PhotoHash#sameShot} is exact and would be a scan.
     * Skipping the second would flag on a chance band collision, and one false duplicate note costs
     * more than the several true ones it arrives with, because it is what teaches the desk that the
     * flag is noise.
     */
    private void flagSamePhotos(Property p) {
        List<PropertyPhotoHash> mine = photoHashes.findByPropertyId(p.getId());
        if (mine.isEmpty()) {
            return;
        }
        Set<Integer> bands0 = new LinkedHashSet<>();
        Set<Integer> bands1 = new LinkedHashSet<>();
        Set<Integer> bands2 = new LinkedHashSet<>();
        Set<Integer> bands3 = new LinkedHashSet<>();
        for (PropertyPhotoHash h : mine) {
            int[] b = PhotoHash.bands(h.getHash());
            bands0.add(b[0]);
            bands1.add(b[1]);
            bands2.add(b[2]);
            bands3.add(b[3]);
        }
        List<PropertyPhotoHash> candidates = photoHashes.findBandCandidates(
                p.getOwner().getId(), OCCUPYING, bands0, bands1, bands2, bands3,
                PageRequest.of(0, PHOTO_CANDIDATE_CAP));
        Set<UUID> matched = new LinkedHashSet<>();
        for (PropertyPhotoHash c : candidates) {
            for (PropertyPhotoHash m : mine) {
                if (PhotoHash.sameShot(m.getHash(), c.getHash())) {
                    matched.add(c.getPropertyId());
                    break;
                }
            }
        }
        if (matched.isEmpty()) {
            return;
        }
        // Sorted and capped for the same reason the doorway arm sorts: postInternalOnce dedupes on
        // the message body, so a finding that renders in a different order per run gets filed again
        // on every edit. Here the ordering is doubly unstable — the band query has no ORDER BY and
        // the match set is built from whatever order it returned.
        String others = properties.findAllById(matched).stream()
                .map(ListingDuplicateProbe::describe).sorted().limit(2)
                .collect(Collectors.joining("; "));
        caseNotes.postInternalOnce(p.getId(), p.getDeal(),
                "Possible duplicate. This listing (" + describe(p) + ") reuses photographs from an"
                        + " active listing by another owner: " + others + "."
                        + " Photographs are a weaker signal than an address — the same lobby or"
                        + " amenity shot can honestly appear on two listings. " + nextStep(p));
    }

    /**
     * How one side of a collision is named in the note.
     *
     * <p>Everything after the reference is there because the first version of this note said only
     * "possible duplicate" and named the other listing, which is a suspicion rather than a work
     * item: it gives a moderator no way to tell an honest collision from a hijack, and no way to
     * tell which of the two listings is the one to doubt. Submitting a throwaway listing carrying a
     * competitor's meter number then costs nothing and manufactures an investigation of <em>their</em>
     * listing. Age and the owner's verification state are what break the tie \u2014 the listing that has
     * been live for eight months under a verified owner is not the one that moved.
     */
    private static String describe(Property p) {
        String ref = p.getSlug() == null ? p.getId().toString() : p.getSlug();
        return ref + " [" + p.getStatus()
                + (p.isOwnerVerified() ? ", owner verified" : ", owner unverified")
                + (p.getCreatedAt() == null ? ""
                        // IST, not UTC: the note is read by a desk in Pune, and a listing created at
                        // 3am local would otherwise be dated to the previous day for the one reader
                        // it has.
                        : ", listed " + p.getCreatedAt().atZone(IST).toLocalDate())
                + "]";
    }

    /**
     * What the desk is being asked to do, which differs by the flagged listing's own status.
     *
     * <p>On a pending listing this is something to settle before approving. On one that is already
     * live \u2014 an owner who edited their way onto somebody else's address \u2014 there is no approval step
     * left to attach it to, and telling a moderator to check "before approving" describes a decision
     * they already made. It stays live either way: a collision is a suspicion, and taking a live
     * listing down on a suspicion is the same mistake as refusing the submission, made later and
     * more expensively.
     */
    private static String nextStep(Property p) {
        return PropertyStatus.PENDING.equals(p.getStatus())
                ? "Confirm who holds the mandate before approving."
                : "This listing is already live — it moved onto this address by edit. Decide whether"
                        + " it should stay up.";
    }
    /**
     * Re-run the probe over listings created since {@code since}, catching the pair that raced.
     *
     * <p><strong>The hole this fills.</strong> {@link #flag} reads inside the writer's transaction
     * under {@code READ COMMITTED}, so two submissions in flight at the same moment each see a world
     * without the other and neither is flagged. That is not a rare interleaving to shrug at — it is
     * the shape the abuse actually takes, because a broker listing one flat twice does it from a
     * script in the same second, not by hand on consecutive days. The synchronous probe catches the
     * careless; without this it would miss the deliberate.
     *
     * <p><strong>Why a sweep rather than a unique index.</strong> A partial unique constraint on the
     * meter number would make the race impossible instead of merely detected, but it converts the
     * probe from a suspicion into a refusal, and the whole design of this class is that a collision
     * is not evidence: a genuine re-let by a new owner, a bungalow split into two tenancies and an
     * over-eager address key all collide honestly. A constraint would refuse those at the door, with
     * an error message, and no human in the loop. The sweep keeps the human.
     *
     * <p>Re-flagging a listing the synchronous probe already flagged costs nothing, because
     * {@link ListingCaseNotes#postInternalOnce} compares message bodies. The one case that files a
     * second note is a listing whose status moved between the two runs, since {@link #nextStep}
     * reads it — and that note is not noise: it says the collision outlived a moderation decision.
     *
     * <p><strong>The whole tick is one transaction, and that is a deliberate trade.</strong> A
     * concurrent {@code ListingService.update} opening the same case file between this
     * transaction's read and its write is a unique-constraint violation on
     * {@code property_reviews.property_id}, and JPA cannot continue a transaction after one — so a
     * single unlucky row discards every collision found alongside it. The alternative, a
     * {@code REQUIRES_NEW} per listing, costs more than it buys here: the failure is transient by
     * construction (a lost race, not a poisoned row), the sweep's window is twice its period
     * precisely so a dead tick is retried rather than lost, and a self-committing inner transaction
     * cannot be exercised at all from this suite, whose tests roll back and would leave the inner
     * transaction unable to see the fixture it is meant to sweep. An untestable mitigation for a
     * self-healing fault is a worse position than a documented one. Revisit if the sweep ever grows
     * a write that is <em>not</em> idempotent across ticks.
     *
     * <p>{@code this::flag} is a self-invocation, so {@code flag}'s {@code MANDATORY} propagation is
     * inert on this path — the annotation is not what supplies the transaction here, this method's
     * own {@code @Transactional} is. The requirement it states still holds; it is simply enforced by
     * the caller rather than by the proxy.
     *
     * @return how many listings were re-read, for the caller's log line
     */
    @Transactional
    public int resweepRecent(Instant since, int limit) {
        List<Property> recent =
                properties.findRecentSignalCarrying(since, OCCUPYING, PageRequest.of(0, limit));
        recent.forEach(this::flag);
        return recent.size();
    }

    /**
     * The same comparison pointed at the caller's own listings: "have I already listed this?" (D226).
     *
     * <p><strong>Why this belongs here and not on {@code ListingService}.</strong> It is the same
     * rule about what counts as one doorway, read in the other direction, and the value of it being
     * one rule is that an owner can never be stopped by a definition of "duplicate" that ops is not
     * flagging strangers on. Splitting the two readings across two classes is how they drift.
     *
     * <p><strong>Why it may answer and {@link #flag} may not.</strong> Everything this can return is
     * a listing the caller owns and can already read from their own dashboard, so there is nothing to
     * disclose. {@code flag}'s findings are staff-only precisely because they are about somebody
     * else, which is what would turn a guessed meter number into a lookup.
     *
     * <p>The address arm needs a resolved locality slug, so an unfiled listing (D225's queue) matches
     * nothing on address. That is correct rather than a gap: two listings the catalogue could not
     * place are not known to be in the same place.
     */
    @Transactional(readOnly = true)
    public ListingDuplicateVerdict ownDuplicate(UUID ownerId, String meter,
            String addressKey, String localitySlug) {
        // Same short-circuit as flag(), for the same reason: with both arms null the query is
        // provably empty and neither partial index is usable, so it is a scan to prove nothing. This
        // is the common path — a wizard reaches it on every submission, most carrying no meter.
        if (meter == null && addressKey == null) {
            return ListingDuplicateVerdict.NONE;
        }
        // One row is the whole answer. The caller is deciding whether to stop a submission, not
        // describing a collision, so a second hit would change nothing it does.
        List<Property> hits = properties.findOwnDuplicateCandidates(
                ownerId, OCCUPYING, meter, addressKey, localitySlug, PageRequest.of(0, 1));
        if (hits.isEmpty()) {
            return ListingDuplicateVerdict.NONE;
        }
        Property hit = hits.get(0);
        return new ListingDuplicateVerdict(true, hit.getId().toString());
    }
}
